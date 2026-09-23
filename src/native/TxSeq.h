#pragma once

#include <elem/AudioBufferResource.h>
#include <elem/GraphNode.h>
#include <array>
#include <cmath>
#include <vector>


namespace elem
{

    // txSeq: block-accurate tracker sequencer inside the Elementary runtime.
    //
    // Uploaded data is one Float32Array shared resource (packed on the TS side,
    // see buildTxSeqData in src/player/txSeqData.ts):
    //   [0] = version (1), [1] = totalRows, [2] = numSlots
    //   per slot s: [3+3s] signalCount, [4+3s] drumGateCount, [5+3s] signalOffset
    //   headerSize = 3 + 3*numSlots
    //   data: row r, slot s, signal c →
    //     headerSize + r * totalSignals + signalOffset[s] + c
    // Output channel for slot s signal c = s * MAX_SLOT_SIGNALS + c.
    //
    // Commands arrive as the "cmd" property (single atomic prop update, applied
    // on the non-realtime thread): {type: "play"|"stop"|"panic", sessionId,
    // rowsPerSec, startRow, totalRows, dataPath}. "rowsPerSec" as a plain
    // property sets live tempo. "testOut" (internal channel index) mirrors one
    // channel onto output 0 for tests. Row feedback: "txseq" events every
    // `emitEvery` blocks ({row, loop, sessionId}).
    //
    // Live notes: {type: "live", slot, gates, values} replaces slot's output
    // channels with `values` (first `gates` are gate channels), also while
    // stopped. A released override yields to the sequence on its next gate.
    // "liveClear" drops all overrides (also implied by play and panic).
    template <typename FloatType>
    struct TxSeqNode : public GraphNode<FloatType> {
        static constexpr int MAX_SLOT_SIGNALS = 32;
        static constexpr int MAX_LIVE_SLOTS = 128;

        struct LiveEvent {
            int64_t slot = -1; // -1 = clear all overrides
            int64_t gates = 0;
            int64_t count = 0;
            std::array<float, MAX_SLOT_SIGNALS> values {};
        };

        struct LiveSlot {
            bool active = false;
            bool retrigger = false;
            int64_t gates = 0;
            int64_t count = 0;
            std::array<float, MAX_SLOT_SIGNALS> values {};
        };

        TxSeqNode(NodeId id, FloatType const sr, int const bs)
            : GraphNode<FloatType>::GraphNode(id, sr, bs)
        {
            setProperty("emitEvery", js::Value((js::Number) 4.0));
            setProperty("testOut", js::Value((js::Number) -1.0));
        }

        // ── property updates (non-realtime thread) ─────────────────────

        int setProperty(std::string const& key, js::Value const& val) override
        {
            if (key == "cmd" && val.isObject()) {
                auto const& cmd = val.getObject();

                if (cmd.count("type") && !cmd.at("type").isString()) return ReturnCode::InvalidPropertyType();
                if (cmd.count("sessionId") && !cmd.at("sessionId").isNumber()) return ReturnCode::InvalidPropertyType();

                auto const type = cmd.count("type") ? (js::String) cmd.at("type") : std::string("");
                auto const sid = cmd.count("sessionId") ? (int64_t) (js::Number) cmd.at("sessionId") : 0;

                if (type == "play") {
                    sessionId.store(sid);
                    if (cmd.count("rowsPerSec") && cmd.at("rowsPerSec").isNumber())
                        rowsPerSec.store((js::Number) cmd.at("rowsPerSec"));
                    if (cmd.count("totalRows") && cmd.at("totalRows").isNumber())
                        totalRows.store((int64_t) (js::Number) cmd.at("totalRows"));
                    startRow.store(cmd.count("startRow") ? (js::Number) cmd.at("startRow") : 0.0);
                    startRowPending.store(true);
                    playing.store(true);
                    liveQueue.push(LiveEvent {});
                    return GraphNode<FloatType>::setProperty(key, val);
                }

                if (type == "update") {
                    // New data + totals while playing; the row keeps advancing.
                    sessionId.store(sid);
                    if (cmd.count("rowsPerSec") && cmd.at("rowsPerSec").isNumber())
                        rowsPerSec.store((js::Number) cmd.at("rowsPerSec"));
                    if (cmd.count("totalRows") && cmd.at("totalRows").isNumber())
                        totalRows.store((int64_t) (js::Number) cmd.at("totalRows"));
                    return GraphNode<FloatType>::setProperty(key, val);
                }

                if (type == "stop") {
                    sessionId.store(sid);
                    playing.store(false);
                    startRowPending.store(false);
                    return GraphNode<FloatType>::setProperty(key, val);
                }

                if (type == "panic") {
                    playing.store(false);
                    startRowPending.store(false);
                    liveQueue.push(LiveEvent {});
                    return GraphNode<FloatType>::setProperty(key, val);
                }

                if (type == "liveClear") {
                    liveQueue.push(LiveEvent {});
                    return GraphNode<FloatType>::setProperty(key, val);
                }

                if (type == "live") {
                    if (!cmd.count("slot") || !cmd.at("slot").isNumber()) return ReturnCode::InvalidPropertyType();
                    if (!cmd.count("values") || !cmd.at("values").isArray()) return ReturnCode::InvalidPropertyType();

                    LiveEvent ev;
                    ev.slot = (int64_t) (js::Number) cmd.at("slot");
                    if (ev.slot < 0 || ev.slot >= MAX_LIVE_SLOTS) return ReturnCode::InvalidPropertyValue();
                    ev.gates = cmd.count("gates") && cmd.at("gates").isNumber() ? (int64_t) (js::Number) cmd.at("gates") : 1;

                    auto const& vals = cmd.at("values").getArray();
                    ev.count = std::min((int64_t) vals.size(), (int64_t) MAX_SLOT_SIGNALS);
                    for (int64_t c = 0; c < ev.count; ++c)
                        ev.values[c] = vals[c].isNumber() ? (float) (js::Number) vals[c] : 0.0f;

                    liveQueue.push(std::move(ev));
                    return GraphNode<FloatType>::setProperty(key, val);
                }
            }

            if (key == "rowsPerSec" && val.isNumber())
                rowsPerSec.store((js::Number) val);
            else if (key == "emitEvery" && val.isNumber())
                emitEvery.store(std::max(1.0, (js::Number) val));
            else if (key == "testOut" && val.isNumber())
                testOut.store((int64_t) (js::Number) val);

            return GraphNode<FloatType>::setProperty(key, val);
        }

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap& resources) override
        {
            // Any uploaded dataPath resource is candidate sequence data; the
            // most recently queued one wins at the next block boundary.
            if (key == "dataPath" && val.isString())
                bufferQueue.push(resources.get((js::String) val));

            return setProperty(key, val);
        }

        // ── realtime processing ─────────────────────────────────────────

        void process (BlockContext<FloatType> const& ctx) override {
            auto** outputData = ctx.outputData;
            auto const numOutputChannels = (int64_t) ctx.numOutputChannels;
            auto const numSamples = ctx.numSamples;

            for (size_t ch = 0; ch < ctx.numOutputChannels; ++ch)
                std::fill_n(outputData[ch], numSamples, FloatType(0));

            // Grab the newest sequence upload if one arrived.
            while (bufferQueue.size() > 0)
                bufferQueue.pop(activeBuffer);

            applyLiveEvents();

            if (activeBuffer != nullptr && playing.load()) {
                // Parse the header once per upload, never inside the sample loop.
                if (activeBuffer != parsedBuffer) {
                    parsedBuffer = activeBuffer;
                    parseHeader();
                }

                if (dataRows > 0)
                    processSequence(ctx);
            }

            writeLiveOverrides(outputData, numOutputChannels, numSamples);
        }

    private:
        void processSequence(BlockContext<FloatType> const& ctx) {
            auto** outputData = ctx.outputData;
            auto const numOutputChannels = (int64_t) ctx.numOutputChannels;
            auto const numSamples = ctx.numSamples;

            if (startRowPending.exchange(false))
                currentRow = startRow.load();

            auto const rowsPerSample = (double) rowsPerSec.load() / GraphNode<FloatType>::getSampleRate();
            auto const rowsPerBlock = rowsPerSample * (double) numSamples;

            auto const rowFloat = currentRow;
            auto const row = (int64_t) std::floor(rowFloat);
            auto const rowFraction = rowFloat - (double) row;
            auto const wrappedRow = ((row % dataRows) + dataRows) % dataRows;

            auto const* data = activeBuffer->getChannelData(0).data() + headerSize;
            auto const rowBase = wrappedRow * totalSignals;
            auto const testCh = testOut.load();

            for (int64_t s = 0; s < numSlots; ++s) {
                auto const staccatoIdx = drumGateCount[s] > 0 ? 2 * drumGateCount[s] + 8 : 10;
                auto const staccato = staccatoIdx < signalCount[s]
                    ? (double) data[rowBase + signalOffset[s] + staccatoIdx]
                    : 1.0;

                // A released live note hands the slot back once the sequence gates it.
                if (s < MAX_LIVE_SLOTS && live[s].active && !liveGateOn(live[s])) {
                    auto const gates = drumGateCount[s] > 0 ? drumGateCount[s] : 1;
                    for (int64_t c = 0; c < gates && c < signalCount[s]; ++c) {
                        if (data[rowBase + signalOffset[s] + c] == 1.0f) {
                            live[s].active = false;
                            break;
                        }
                    }
                }

                for (int64_t c = 0; c < signalCount[s]; ++c) {
                    auto const outCh = s * MAX_SLOT_SIGNALS + c;
                    auto val = (FloatType) data[rowBase + signalOffset[s] + c];

                    // Sub-row staccato truncates gate channels.
                    auto const isGate = drumGateCount[s] > 0 ? c < drumGateCount[s] : c == 0;
                    if (isGate && val == (FloatType) 1.0 && rowFraction >= staccato)
                        val = FloatType(0);

                    if (testCh == outCh)
                        std::fill_n(outputData[0], numSamples, val);
                    else if (outCh < numOutputChannels)
                        std::fill_n(outputData[outCh], numSamples, val);
                }
            }

            lastRow = (double) wrappedRow;

            blocksSinceEvent += 1;
            if ((double) blocksSinceEvent >= emitEvery.load())
                eventFlag.store(true);

            currentRow += rowsPerBlock;

            if (currentRow >= (double) dataRows) {
                currentRow -= (double) dataRows;
                loopFlag.store(true);
            }
        }

        static bool liveGateOn(LiveSlot const& ls) {
            for (int64_t c = 0; c < ls.gates && c < ls.count; ++c)
                if (ls.values[c] > 0.0f) return true;
            return false;
        }

        void applyLiveEvents() {
            LiveEvent ev;
            while (liveQueue.size() > 0) {
                liveQueue.pop(ev);

                if (ev.slot < 0) {
                    for (auto& ls : live) ls.active = false;
                    continue;
                }

                auto& ls = live[ev.slot];
                // A note-on over a still-gated override needs a 0 block for a fresh edge.
                auto const wasOn = ls.active && liveGateOn(ls);
                ls.gates = ev.gates;
                ls.count = ev.count;
                ls.values = ev.values;
                ls.retrigger = wasOn && liveGateOn(ls);
                ls.active = true;
            }
        }

        void writeLiveOverrides(FloatType** outputData, int64_t numOutputChannels, size_t numSamples) {
            for (int64_t s = 0; s < MAX_LIVE_SLOTS; ++s) {
                auto& ls = live[s];
                if (!ls.active) continue;

                for (int64_t c = 0; c < ls.count; ++c) {
                    auto const outCh = s * MAX_SLOT_SIGNALS + c;
                    auto const val = (c < ls.gates && ls.retrigger) ? FloatType(0) : (FloatType) ls.values[c];

                    if (testOut.load() == outCh)
                        std::fill_n(outputData[0], numSamples, val);
                    else if (outCh < numOutputChannels)
                        std::fill_n(outputData[outCh], numSamples, val);
                }
                ls.retrigger = false;
            }
        }

    public:
        void processEvents(std::function<void(std::string const&, js::Value)>& eventHandler) override {
            auto const ev = eventFlag.exchange(false);
            auto const lp = loopFlag.exchange(false);

            if (ev || lp) {
                eventHandler("txseq", js::Object({
                    {"name", GraphNode<FloatType>::getPropertyWithDefault("name", js::Value((js::String) ""))},
                    {"row", js::Value((js::Number) lastRow)},
                    {"loop", js::Value((js::Boolean) lp)},
                    {"sessionId", js::Value((js::Number) (double) sessionId.load())},
                }));
                blocksSinceEvent = 0;
            }
        }

    private:
        void parseHeader() {
            auto const* header = activeBuffer->getChannelData(0).data();
            auto const hSize = (int64_t) activeBuffer->numSamples();

            dataRows = 0;
            numSlots = 0;
            totalSignals = 0;
            headerSize = 0;
            signalCount.clear();
            drumGateCount.clear();
            signalOffset.clear();

            if (hSize < 3 || (int64_t) header[0] != 1)
                return;

            auto const r = (int64_t) header[1];
            auto const n = (int64_t) header[2];
            if (3 + 3 * n > hSize)
                return;

            headerSize = 3 + 3 * n;

            signalCount.reserve(n);
            drumGateCount.reserve(n);
            signalOffset.reserve(n);

            for (int64_t s = 0; s < n; ++s) {
                auto const sc = (int64_t) header[3 + 3 * s];
                auto const dg = (int64_t) header[4 + 3 * s];
                auto const so = (int64_t) header[5 + 3 * s];
                signalCount.push_back(sc);
                drumGateCount.push_back(dg);
                signalOffset.push_back(so);
                totalSignals = std::max(totalSignals, so + sc);
            }

            dataRows = r;
            numSlots = n;
        }

    public:
        // ── state ───────────────────────────────────────────────────────

        std::atomic<bool> playing = false;
        std::atomic<bool> startRowPending = false;
        std::atomic<bool> eventFlag = false;
        std::atomic<bool> loopFlag = false;
        std::atomic<double> rowsPerSec = 8.0;
        std::atomic<double> startRow = 0.0;
        std::atomic<int64_t> totalRows = 64;
        std::atomic<int64_t> sessionId = 0;
        std::atomic<double> emitEvery = 4.0;
        std::atomic<int64_t> testOut = -1;
        std::atomic<int64_t> blocksSinceEvent = 0;

        SingleWriterSingleReaderQueue<SharedResourcePtr> bufferQueue;
        SingleWriterSingleReaderQueue<LiveEvent> liveQueue { 256 };
        std::array<LiveSlot, MAX_LIVE_SLOTS> live {};
        SharedResourcePtr activeBuffer;
        SharedResourcePtr parsedBuffer;

        int64_t dataRows = 0;
        int64_t numSlots = 0;
        int64_t totalSignals = 0;
        int64_t headerSize = 0;
        std::vector<int64_t> signalCount;
        std::vector<int64_t> drumGateCount;
        std::vector<int64_t> signalOffset;

        double currentRow = 0.0;
        double lastRow = 0.0;
    };

} // namespace elem
