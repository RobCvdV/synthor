#pragma once

#include <elem/GraphNode.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <memory>
#include <mutex>
#include <vector>


namespace elem
{

    // wtosc: band-limited wavetable oscillator for the built-in shapes.
    //
    // Inputs: [0] frequency in Hz (negative runs backwards: through-zero FM),
    //         [1] optional phase offset in cycles (phase modulation / offset).
    // Props:  shape (int, see WtShape — the order is the contract with
    //         src/engine/wavetableShapes.ts).
    //
    // Each shape is defined once in the time domain, analysed into its first
    // MAX_HARMONICS harmonics and resynthesized into one table per octave
    // (mip level L keeps MAX_HARMONICS >> L harmonics). Playback crossfades
    // the two levels around the current pitch, both of which stay below
    // Nyquist, so nothing aliases. Banks are built lazily, once per shape per
    // process, and shared by every node.
    namespace wt
    {
        constexpr int TABLE_SIZE = 2048;
        constexpr int MAX_HARMONICS = 512;
        constexpr int NUM_LEVELS = 10; // 512, 256, … 1 harmonics

        enum WtShape {
            Sine = 0, Saw, Square, Triangle, Pulse25, Pulse12, HalfSine, AbsSine,
            Organ, Trapezoid, SyncSaw, Stairs, SoftSaw, Hollow, SharkFin, DoubleSaw,
            NumShapes
        };

        // Each level has a guard sample at TABLE_SIZE so reads can interpolate without wrapping.
        using Bank = std::array<std::array<float, TABLE_SIZE + 1>, NUM_LEVELS>;

        inline double frac(double x) { return x - std::floor(x); }

        inline double shapeAt(int shape, double t)
        {
            constexpr double twoPi = 2.0 * M_PI;
            switch (shape) {
                case Sine: return std::sin(twoPi * t);
                case Saw: return 2.0 * t - 1.0;
                case Square: return t < 0.5 ? 1.0 : -1.0;
                case Triangle: return 1.0 - 4.0 * std::abs(t - 0.5);
                case Pulse25: return t < 0.25 ? 1.0 : -1.0;
                case Pulse12: return t < 0.125 ? 1.0 : -1.0;
                case HalfSine: return std::max(0.0, std::sin(twoPi * t));
                case AbsSine: return std::abs(std::sin(twoPi * t));
                case Organ: {
                    // Drawbar-ish: 16' 8' 5⅓' 4' 2⅔' 2'.
                    static constexpr double h[] = { 1.0, 0.8, 0.6, 0.5, 0.0, 0.35, 0.0, 0.25 };
                    double y = 0;
                    for (int n = 0; n < 8; ++n) y += h[n] * std::sin(twoPi * (n + 1) * t);
                    return y;
                }
                case Trapezoid: return std::clamp(3.0 * (1.0 - 4.0 * std::abs(t - 0.5)), -1.0, 1.0);
                case SyncSaw: return 2.0 * frac(2.5 * t) - 1.0;
                case Stairs: return (std::floor(t * 4.0) / 3.0) * 2.0 - 1.0;
                case SoftSaw: {
                    // Saw with a 1/n^1.6 roll-off: rounder, less buzzy.
                    double y = 0;
                    for (int n = 1; n <= 64; ++n) y += std::sin(twoPi * n * t) / std::pow(n, 1.6);
                    return y;
                }
                case Hollow: {
                    // Odd harmonics only, the 3rd and 5th pulled back: reedy, clarinet-like.
                    double y = 0;
                    for (int n = 1; n <= 63; n += 2) {
                        double const a = n == 3 ? 0.15 : n == 5 ? 0.3 : 1.0;
                        y += a * std::sin(twoPi * n * t) / n;
                    }
                    return y;
                }
                case SharkFin: return t < 0.5 ? 2.0 * std::sin(M_PI * t) - 1.0 : 1.0 - 4.0 * (t - 0.5);
                case DoubleSaw: return (2.0 * t - 1.0) * 0.6 + (2.0 * frac(2.0 * t) - 1.0) * 0.4;
                default: return 0.0;
            }
        }

        inline std::unique_ptr<Bank> buildBank(int shape)
        {
            constexpr int N = TABLE_SIZE;
            // Oversample the time-domain shape so the analysis sees its edges sharply.
            constexpr int OS = 4;
            std::vector<double> src(N * OS);
            for (int k = 0; k < N * OS; ++k) src[k] = shapeAt(shape, (k + 0.5) / (N * OS));

            // Harmonic n: y += re[n]·cos + im[n]·sin. A plain DFT via a rotating phasor.
            std::vector<double> re(MAX_HARMONICS + 1, 0.0), im(MAX_HARMONICS + 1, 0.0);
            for (int n = 1; n <= MAX_HARMONICS; ++n) {
                double const w = 2.0 * M_PI * n / (N * OS);
                double c = std::cos(w * 0.5), s = std::sin(w * 0.5);
                double const dc = std::cos(w), ds = std::sin(w);
                double accC = 0, accS = 0;
                for (int k = 0; k < N * OS; ++k) {
                    accC += src[k] * c;
                    accS += src[k] * s;
                    double const nc = c * dc - s * ds;
                    s = s * dc + c * ds;
                    c = nc;
                }
                re[n] = 2.0 * accC / (N * OS);
                im[n] = 2.0 * accS / (N * OS);
            }

            // Resynthesize: add harmonics in octave bands, snapshotting each level
            // (levels nest, so the work is one pass over all harmonics).
            auto bank = std::make_unique<Bank>();
            std::vector<double> acc(N, 0.0);
            int added = 0;
            double peak = 0;
            std::array<std::vector<double>, NUM_LEVELS> levels;
            for (int level = NUM_LEVELS - 1; level >= 0; --level) {
                int const upTo = MAX_HARMONICS >> level;
                for (int n = added + 1; n <= upTo; ++n) {
                    double const w = 2.0 * M_PI * n / N;
                    double c = 1.0, s = 0.0;
                    double const dc = std::cos(w), ds = std::sin(w);
                    for (int k = 0; k < N; ++k) {
                        acc[k] += re[n] * c + im[n] * s;
                        double const nc = c * dc - s * ds;
                        s = s * dc + c * ds;
                        c = nc;
                    }
                }
                added = upTo;
                levels[level] = acc;
            }
            for (double v : levels[0]) peak = std::max(peak, std::abs(v));
            double const gain = peak > 1e-9 ? 1.0 / peak : 0.0;
            for (int level = 0; level < NUM_LEVELS; ++level) {
                for (int k = 0; k < N; ++k) (*bank)[level][k] = float(levels[level][k] * gain);
                (*bank)[level][N] = (*bank)[level][0];
            }
            return bank;
        }

        /** The shared bank for a shape, built on first use. Never freed. */
        inline Bank const* bankFor(int shape)
        {
            static std::array<std::atomic<Bank const*>, NumShapes> banks {};
            static std::mutex buildLock;
            if (shape < 0 || shape >= NumShapes) return nullptr;
            if (auto const* b = banks[shape].load(std::memory_order_acquire)) return b;
            std::lock_guard<std::mutex> guard(buildLock);
            if (auto const* b = banks[shape].load(std::memory_order_acquire)) return b;
            auto const* built = buildBank(shape).release();
            banks[shape].store(built, std::memory_order_release);
            return built;
        }
    }

    template <typename FloatType>
    struct WtOscNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;

        int setProperty(std::string const& key, js::Value const& val) override
        {
            if (key == "shape") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                // Built here, off the audio callback where the runtime allows it.
                // An unknown shape (a newer song in an older app) plays silence
                // rather than failing the whole render.
                bank.store(wt::bankFor(static_cast<int>((js::Number) val)), std::memory_order_release);
            }
            return GraphNode<FloatType>::setProperty(key, val);
        }

        void process (BlockContext<FloatType> const& ctx) override {
            auto** inputData = ctx.inputData;
            auto* out = ctx.outputData[0];
            auto const numSamples = ctx.numSamples;
            auto const* b = bank.load(std::memory_order_acquire);

            if (ctx.numInputChannels < 1 || b == nullptr)
                return (void) std::fill_n(out, numSamples, FloatType(0));

            double const sr = GraphNode<FloatType>::getSampleRate();
            FloatType const* pm = ctx.numInputChannels > 1 ? inputData[1] : nullptr;

            auto const& tables = *b;
            for (size_t i = 0; i < numSamples; ++i) {
                double const inc = double(inputData[0][i]) / sr;
                if (inc != lastInc) pickLevels(inc);

                double const t = pm == nullptr ? phase : wt::frac(phase + double(pm[i]));
                double const pos = t * wt::TABLE_SIZE;
                int const idx = std::min(int(pos), wt::TABLE_SIZE - 1);
                float const f = float(pos - idx);
                float const* lo = tables[level].data() + idx;
                float y = lo[0] + (lo[1] - lo[0]) * f;
                if (mix > 0.0f) {
                    float const* hi = tables[nextLevel].data() + idx;
                    float const z = hi[0] + (hi[1] - hi[0]) * f;
                    y += (z - y) * mix;
                }
                out[i] = FloatType(y);

                // |inc| < 1 below Nyquist, so one step wraps at most once.
                phase += inc;
                if (phase >= 1.0) phase -= 1.0;
                else if (phase < 0.0) phase += 1.0;
            }
            // Guard against a huge FM step leaving the phase out of range.
            if (!(phase >= 0.0 && phase < 1.0)) phase = std::isfinite(phase) ? wt::frac(phase) : 0.0;
        }

    private:
        // Level L keeps 512 >> L harmonics; it is alias-free while 2^L ≥ 1024·|inc|.
        // floor(log2(2048·|inc|)) is the richest such level; fade toward the next.
        void pickLevels(double inc)
        {
            lastInc = inc;
            double const x = std::log2(std::max(1e-9, 2048.0 * std::abs(inc)));
            if (x <= 0) { level = 0; nextLevel = 0; mix = 0; return; }
            if (x >= wt::NUM_LEVELS - 1) { level = nextLevel = wt::NUM_LEVELS - 1; mix = 0; return; }
            level = int(x);
            nextLevel = level + 1;
            mix = float(x - level);
        }

        std::atomic<wt::Bank const*> bank { nullptr };
        double phase = 0;
        double lastInc = -1e9;
        int level = 0;
        int nextLevel = 0;
        float mix = 0;
    };

} // namespace elem
