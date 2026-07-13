import { useEffect, useRef } from 'react'
import { AudioHost } from '../audio/host'
import { compileGraph } from '../engine/compile'
import { useDocStore } from '../state/docStore'
import { usePreviewStore } from '../state/previewStore'
import { rowHz, useTransportStore } from '../state/transportStore'

/**
 * Wires the reactive stores to the audio host: any change to the document,
 * transport, or preview recompiles the Elementary graph and re-renders it.
 * Elementary reconciles the diff, so edits-while-playing just work.
 *
 * Renders are coalesced to one per animation frame. A slider drag fires dozens
 * to hundreds of store mutations per second; rendering synchronously on each
 * one would rebuild the whole graph and post that many messages to the audio
 * worklet, starving the audio thread (dropouts that recover once the drag
 * stops). Coalescing caps it at ~60/s with only the latest state — a single
 * graph edit is instant, so one render per frame keeps audio smooth.
 */
export function useEngine(): AudioHost {
  const hostRef = useRef<AudioHost | null>(null)
  if (hostRef.current === null) hostRef.current = new AudioHost()
  const host = hostRef.current

  // Dev-only handles for debugging / audio verification from the console.
  if (import.meta.env.DEV) {
    const g = globalThis as Record<string, unknown>
    g.__host = host
    g.__docStore = useDocStore
    g.__transportStore = useTransportStore
    g.__previewStore = usePreviewStore
  }

  useEffect(() => {
    let frame = 0

    const render = () => {
      frame = 0
      if (!host.isReady) return
      const { doc, mutedTracks } = useDocStore.getState()
      const { bpm, linesPerBeat, playing } = useTransportStore.getState()
      const { instrumentId, voices } = usePreviewStore.getState()
      const active = Object.values(voices)
      host.render(
        compileGraph(doc, {
          rowHz: rowHz(bpm, linesPerBeat),
          playing: playing ? 1 : 0,
          mutedTracks,
          preview: instrumentId && active.length ? { instrumentId, voices: active } : undefined,
        }),
      )
    }

    // Coalesce bursts of store mutations into a single render on the next frame.
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(render)
    }

    const unsubDoc = useDocStore.subscribe(schedule)
    const unsubTransport = useTransportStore.subscribe(schedule)
    const unsubPreview = usePreviewStore.subscribe(schedule)
    schedule() // catch any state that changed before the host was ready
    return () => {
      if (frame) cancelAnimationFrame(frame)
      unsubDoc()
      unsubTransport()
      unsubPreview()
    }
  }, [host])

  return host
}
