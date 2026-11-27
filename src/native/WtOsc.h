#pragma once

#include <elem/GraphNode.h>
#include <elem/SingleWriterSingleReaderQueue.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <memory>
#include <mutex>
#include <vector>


namespace elem
{

    // wtosc: band-limited wavetable oscillator — built-in shapes, or uploaded
    // tables (the wave module's sample cycles).
    //
    // Inputs: [0] frequency in Hz (negative runs backwards: through-zero FM),
    //         [1] optional phase offset in cycles (phase modulation / offset),
    //         [2] optional reset: a rising edge (a jump up by more than 0.5,
    //             as el.syncphasor) restarts the cycle at phase 0,
    //         [3] optional position 0..1 across an uploaded table's frames
    //             (neighbouring frames are crossfaded).
    // Props:  shape (int, see WtShape — the order is the contract with
    //         src/engine/wavetableShapes.ts); bandlimit (bool, default true —
    //         false plays the exact shape, for LFOs); or path (a shared
    //         resource of uploaded tables, one per audio channel).
    //
    // Uploaded tables (src/engine/wavetableMips.ts builds them) are one float
    // array: [1 (version), frames, NUM_LEVELS, size per level…],
    // then per frame, per level, `size` samples plus a guard sample (= the
    // first). Level L holds the frame's first 512 >> L harmonics.
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

        // Level RAW_LEVEL is the shape itself, unfiltered (for LFOs, where the
        // band-limited edges would ring). Each level has a guard sample at
        // TABLE_SIZE so reads can interpolate without wrapping.
        constexpr int RAW_LEVEL = NUM_LEVELS;
        using Bank = std::array<std::array<float, TABLE_SIZE + 1>, NUM_LEVELS + 1>;

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
            double rawPeak = 0;
            std::vector<double> raw(N);
            for (int k = 0; k < N; ++k) {
                raw[k] = shapeAt(shape, double(k) / N);
                rawPeak = std::max(rawPeak, std::abs(raw[k]));
            }
            for (int k = 0; k < N; ++k) (*bank)[RAW_LEVEL][k] = float(rawPeak > 1e-9 ? raw[k] / rawPeak : 0.0);
            (*bank)[RAW_LEVEL][N] = (*bank)[RAW_LEVEL][0];
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
            /** Where a node reads its tables: one flat float array of frames × levels,
         *  each level its own size with a guard sample (see the header layout of
         *  uploaded tables above). Built-in banks are one frame of equal levels. */
        struct TableView {
            float const* data = nullptr;
            int frames = 0;
            int frameStride = 0;
            int rawLevel = -1; // the unfiltered level, built-in shapes only
            std::array<int, NUM_LEVELS + 1> sizes {};
            std::array<int, NUM_LEVELS + 1> offsets {};
        };

        inline TableView viewOf(Bank const& bank)
        {
            TableView v;
            v.data = bank[0].data();
            v.frames = 1;
            v.frameStride = (NUM_LEVELS + 1) * (TABLE_SIZE + 1);
            v.rawLevel = RAW_LEVEL;
            for (int l = 0; l <= NUM_LEVELS; ++l) {
                v.sizes[l] = TABLE_SIZE;
                v.offsets[l] = l * (TABLE_SIZE + 1);
            }
            return v;
        }

        /** Parses an uploaded table set; frames = 0 when the header doesn't fit. */
        inline TableView viewOf(float const* data, size_t length)
        {
            TableView v;
            if (length < 3 || data[0] != 1.0f) return v;
            int const frames = int(data[1]);
            int const levels = int(data[2]);
            if (frames < 1 || levels != NUM_LEVELS || length < size_t(3 + levels)) return v;
            int offset = 0;
            for (int l = 0; l < levels; ++l) {
                v.sizes[l] = int(data[3 + l]);
                if (v.sizes[l] < 2) return v;
                v.offsets[l] = offset;
                offset += v.sizes[l] + 1;
            }
            if (length < size_t(3 + levels) + size_t(offset) * size_t(frames)) return v;
            v.data = data + 3 + levels;
            v.frameStride = offset;
            v.frames = frames;
            return v;
        }

        inline float readLevel(TableView const& v, int frame, int level, double t)
        {
            int const n = v.sizes[level];
            float const* table = v.data + size_t(frame) * size_t(v.frameStride) + size_t(v.offsets[level]);
            double const pos = t * n;
            int const idx = std::min(int(pos), n - 1);
            float const f = float(pos - idx);
            return table[idx] + (table[idx + 1] - table[idx]) * f;
        }
    }

    template <typename FloatType>
    struct WtOscNode : public GraphNode<FloatType> {
        using GraphNode<FloatType>::GraphNode;

        struct Source {
            SharedResourcePtr resource; // keeps uploaded tables alive; null for built-ins
            wt::TableView view;
        };

        int setProperty(std::string const& key, js::Value const& val) override
        {
            if (key == "shape") {
                if (!val.isNumber()) return ReturnCode::InvalidPropertyType();
                // Built here, off the audio callback where the runtime allows it.
                // An unknown shape (a newer song in an older app) plays silence
                // rather than failing the whole render.
                auto const* bank = wt::bankFor(static_cast<int>((js::Number) val));
                sourceQueue.push(Source { nullptr, bank ? wt::viewOf(*bank) : wt::TableView {} });
            }
            if (key == "bandlimit") {
                if (!val.isBool()) return ReturnCode::InvalidPropertyType();
                raw.store(!static_cast<js::Boolean>(val), std::memory_order_relaxed);
            }
            return GraphNode<FloatType>::setProperty(key, val);
        }

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap& resources) override
        {
            if (key == "path") {
                if (!val.isString()) return ReturnCode::InvalidPropertyType();
                // A missing resource (pruned before this render) plays silence
                // instead of failing the render; the host uploads it again.
                auto resource = resources.get((js::String) val);
                if (!resource) {
                    sourceQueue.push(Source {});
                } else {
                    auto const data = resource->getChannelData(0);
                    sourceQueue.push(Source { resource, wt::viewOf(data.data(), data.size()) });
                }
            }
            return setProperty(key, val);
        }

        void process (BlockContext<FloatType> const& ctx) override {
            auto** inputData = ctx.inputData;
            auto* out = ctx.outputData[0];
            auto const numSamples = ctx.numSamples;

            while (sourceQueue.size() > 0) {
                sourceQueue.pop(source);
                lastInc = -1e9; // re-pick levels for the new tables
            }
            auto const& v = source.view;

            if (ctx.numInputChannels < 1 || v.frames < 1)
                return (void) std::fill_n(out, numSamples, FloatType(0));

            double const sr = GraphNode<FloatType>::getSampleRate();
            FloatType const* pm = ctx.numInputChannels > 1 ? inputData[1] : nullptr;
            FloatType const* reset = ctx.numInputChannels > 2 ? inputData[2] : nullptr;
            FloatType const* position = ctx.numInputChannels > 3 && v.frames > 1 ? inputData[3] : nullptr;

            bool const unfiltered = raw.load(std::memory_order_relaxed) && v.rawLevel >= 0;
            if (unfiltered) { level = nextLevel = v.rawLevel; mix = 0; lastInc = -1e9; }

            for (size_t i = 0; i < numSamples; ++i) {
                double const inc = double(inputData[0][i]) / sr;
                if (!unfiltered && inc != lastInc) pickLevels(inc);
                if (reset != nullptr) {
                    double const r = double(reset[i]);
                    if (r - lastReset > 0.5) phase = 0.0;
                    lastReset = r;
                }

                double const t = pm == nullptr ? phase : wt::frac(phase + double(pm[i]));
                int frameA = 0, frameB = 0;
                float morph = 0;
                if (position != nullptr) {
                    double const at = std::clamp(double(position[i]), 0.0, 1.0) * (v.frames - 1);
                    frameA = std::min(int(at), v.frames - 1);
                    frameB = std::min(frameA + 1, v.frames - 1);
                    morph = float(at - frameA);
                }

                float y = wt::readLevel(v, frameA, level, t);
                if (mix > 0.0f) y += (wt::readLevel(v, frameA, nextLevel, t) - y) * mix;
                if (morph > 0.0f) {
                    float z = wt::readLevel(v, frameB, level, t);
                    if (mix > 0.0f) z += (wt::readLevel(v, frameB, nextLevel, t) - z) * mix;
                    y += (z - y) * morph;
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

        SingleWriterSingleReaderQueue<Source> sourceQueue;
        Source source;
        std::atomic<bool> raw { false };
        double phase = 0;
        double lastInc = -1e9;
        double lastReset = 0;
        int level = 0;
        int nextLevel = 0;
        float mix = 0;
    };

} // namespace elem
