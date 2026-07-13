import { create } from 'zustand'
import type { Id } from '../domain/types'

/**
 * Live keyboard preview state — transient, never part of undo history (like
 * transportStore). Lets you audition an instrument by holding note keys while
 * editing it. Held keys open the gate (attack); releasing closes it (release).
 *
 * Released voices linger with `gate: 0` for a short window so the instrument's
 * release tail rings out instead of clicking off, then they are GC'd. A retrigger
 * of the same note cancels its pending removal and reuses the voice, so the
 * Elementary node keeps a stable key across the release→attack transition.
 */
export interface PreviewVoice {
  note: number
  gate: 0 | 1
}

interface PreviewState {
  /** Instrument being auditioned (the one open in the editor). */
  instrumentId: Id | null
  /** Sounding voices keyed by MIDI note (one voice per pitch). */
  voices: Record<number, PreviewVoice>

  noteOn: (instrumentId: Id, note: number) => void
  noteOff: (note: number) => void
  /** Kill everything immediately (panic button / Esc / view change). */
  panic: () => void
}

/** How long a released voice stays in the graph so its release tail rings. */
const RELEASE_TAIL_MS = 3500

// Pending removal timers, keyed by note. Kept out of store state (not data).
const releaseTimers = new Map<number, ReturnType<typeof setTimeout>>()

function clearTimer(note: number) {
  const t = releaseTimers.get(note)
  if (t !== undefined) {
    clearTimeout(t)
    releaseTimers.delete(note)
  }
}

export const usePreviewStore = create<PreviewState>((set, get) => ({
  instrumentId: null,
  voices: {},

  noteOn: (instrumentId, note) => {
    clearTimer(note) // cancel any pending release of a re-pressed note
    set((s) => ({
      instrumentId,
      // Switching instruments starts a clean voice set.
      voices:
        s.instrumentId === instrumentId
          ? { ...s.voices, [note]: { note, gate: 1 } }
          : { [note]: { note, gate: 1 } },
    }))
  },

  noteOff: (note) => {
    const voice = get().voices[note]
    if (!voice) return
    // Note-off: drop the gate to start the release, then GC after the tail.
    set((s) => ({ voices: { ...s.voices, [note]: { note, gate: 0 } } }))
    clearTimer(note)
    releaseTimers.set(
      note,
      setTimeout(() => {
        releaseTimers.delete(note)
        set((s) => {
          const rest = { ...s.voices }
          delete rest[note]
          return { voices: rest }
        })
      }, RELEASE_TAIL_MS),
    )
  },

  panic: () => {
    for (const t of releaseTimers.values()) clearTimeout(t)
    releaseTimers.clear()
    set({ voices: {} })
  },
}))
