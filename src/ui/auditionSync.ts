import type { AudioHost } from '../audio/host'
import { auditionKey, sampleInUse, type AuditionOverride } from '../engine/audition'
import { useDocStore } from '../state/docStore'
import { useSampleAudition } from '../state/sampleAudition'
import { useTransportStore } from '../state/transportStore'

/**
 * Uploads each version of the auditioned sample to the VFS under its own key (VFS entries are
 * immutable) and reports when the engine should recompile against it. `onChange(ended)` fires
 * once a version is in the VFS, and with `ended` when the audition stops.
 */
export function syncAudition(host: AudioHost, onChange: (ended: boolean) => void) {
  let current: (AuditionOverride & { l1: number }) | null = null
  let running = false

  const step = async () => {
    if (running) return
    running = true
    try {
      for (;;) {
        const tuned = useSampleAudition.getState().audition
        const a = tuned && sampleInUse(useDocStore.getState().doc, tuned.sampleId) ? tuned : null
        if (!a) {
          if (current) {
            current = null
            onChange(true)
          }
          return
        }
        const key = auditionKey(a.sampleId, a.version)
        if (current?.key === key) return
        // Drops superseded versions; playback prunes on its own, and racing its uploads is unsafe.
        if (current && !useTransportStore.getState().playing) await host.pruneVfs()
        await host.updateVfs({ [key]: a.data.length === 1 ? a.data[0] : a.data })
        let l1 = 0
        for (const v of a.data[0]) l1 += Math.abs(v)
        current = { sampleId: a.sampleId, key, frames: a.data[0].length, channels: a.data.length, l1 }
        onChange(false)
      }
    } finally {
      running = false
    }
  }

  const unsubscribe = useSampleAudition.subscribe(() => void step())
  return {
    override: (): AuditionOverride | null => current,
    l1: () => current?.l1,
    dispose: unsubscribe,
  }
}
