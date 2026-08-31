#pragma once

#include <elem/AudioBufferResource.h>
#include <elem/GraphNode.h>


namespace elem
{

    // Spike node: proves the three native-node paths the sequencer needs.
    //   props    -> ch0 outputs `value`
    //   resource -> ch1 outputs first sample of the shared resource at `dataPath`
    //   events   -> emits {type: "txspike", event: {name, block}} every `emitEvery` blocks
    template <typename FloatType>
    struct TxSpikeNode : public GraphNode<FloatType> {
        TxSpikeNode(NodeId id, FloatType const sr, int const bs)
            : GraphNode<FloatType>::GraphNode(id, sr, bs)
        {
            setProperty("value", js::Value((js::Number) 0.0));
            setProperty("emitEvery", js::Value((js::Number) 100.0));
        }

        int setProperty(std::string const& key, js::Value const& val) override
        {
            if (key == "value" && val.isNumber())
                value.store((js::Number) val);
            else if (key == "emitEvery" && val.isNumber())
                emitEvery.store(std::max(1.0, (js::Number) val));

            return GraphNode<FloatType>::setProperty(key, val);
        }

        int setProperty(std::string const& key, js::Value const& val, SharedResourceMap& resources) override
        {
            if (key == "dataPath" && val.isString()) {
                auto ref = resources.get((js::String) val);
                activeResource.store(ref.get());
            }

            return setProperty(key, val);
        }

        void process (BlockContext<FloatType> const& ctx) override {
            auto* out0 = ctx.outputData[0];
            auto* out1 = ctx.numOutputChannels > 1 ? ctx.outputData[1] : nullptr;
            auto const numSamples = ctx.numSamples;

            auto const v = (FloatType) value.load();
            auto* res = activeResource.load();
            auto const firstSample = res && res->numSamples() > 0
                ? (FloatType) res->getChannelData(0)[0]
                : (FloatType) -1.0;
            firstSampleSeen.store((double) firstSample);

            for (size_t i = 0; i < numSamples; ++i) {
                out0[i] = v;
                if (out1) out1[i] = firstSample;
            }

            totalBlocks += 1;
            if (emitEvery.load() > 0 && (totalBlocks % (uint64_t) emitEvery.load()) == 0)
                eventFlag.store(true);
        }

        void processEvents(std::function<void(std::string const&, js::Value)>& eventHandler) override {
            if (!eventFlag.exchange(false)) return;

            eventHandler("txspike", js::Object({
                {"name", GraphNode<FloatType>::getPropertyWithDefault("name", js::Value((js::String) ""))},
                {"block", js::Value((js::Number) (double) totalBlocks)},
                {"value", js::Value((js::Number) (double) value.load())},
                {"firstSample", js::Value((js::Number) (double) firstSampleSeen)},
            }));
        }

        std::atomic<double> value = 0.0;
        std::atomic<double> emitEvery = 100.0;
        std::atomic<double> firstSampleSeen = 0.0;
        std::atomic<SharedResource*> activeResource = nullptr;
        std::atomic<bool> eventFlag = false;
        uint64_t totalBlocks = 0;
    };

} // namespace elem
