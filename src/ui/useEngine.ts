import { useEffect, useRef } from 'react'
import { AudioHost } from '../audio/host'
import { compileGraph } from '../engine/compile'
import { useDocStore } from '../state/docStore'
import { rowHz, useTransportStore } from '../state/transportStore'

/**
 * Wires the reactive stores to the audio host: any change to the document or
 * transport recompiles the Elementary graph and re-renders it. Elementary
 * reconciles the diff, so edits-while-playing just work.
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
  }

  useEffect(() => {
    const rerender = () => {
      if (!host.isReady) return
      const { doc, mutedTracks } = useDocStore.getState()
      const { bpm, linesPerBeat, playing } = useTransportStore.getState()
      host.render(
        compileGraph(doc, { rowHz: rowHz(bpm, linesPerBeat), playing: playing ? 1 : 0, mutedTracks }),
      )
    }
    const unsubDoc = useDocStore.subscribe(rerender)
    const unsubTransport = useTransportStore.subscribe(rerender)
    return () => {
      unsubDoc()
      unsubTransport()
    }
  }, [host])

  return host
}
