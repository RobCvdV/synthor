import type { Id } from '../domain/types'
import { LIVE_VOICE_COUNT } from '../engine/voicePool'
import { useDocStore } from '../state/docStore'
import type { AudioHost } from './host'

/** What a key-up released — for callers with extra bookkeeping. */
export interface ReleasedNote {
  note: number
  instId: Id
}

/**
 * Shared PC-keyboard player for the global keyboard instrument. Resolves the
 * kit for drumkits and remembers which physical keys are held, so a key-up
 * releases the exact note on the exact instrument even if the octave or the
 * global instrument changed mid-hold. One instance app-wide (created by App,
 * passed to the views that play note keys).
 */
export class KeyboardPlayer {
  private held = new Map<string, ReleasedNote>()

  constructor(private host: AudioHost) {}

  /** Note-on for the global instrument. Pass `code` for held notes (released
   *  via noteOff(code)); omit for one-shot pips (released via noteOffNote). */
  noteOn(instId: Id, note: number, code?: string): void {
    if (code) this.held.set(code, { note, instId })
    const inst = useDocStore.getState().doc.entities.instruments[instId]
    const kit = inst?.kind === 'drumkit' ? inst : undefined
    this.host.voicePool(instId, LIVE_VOICE_COUNT, kit).noteOn(note)
  }

  /** Release a held physical key. Returns what was released, if anything. */
  noteOff(code: string): ReleasedNote | undefined {
    const held = this.held.get(code)
    if (!held) return undefined
    this.held.delete(code)
    this.host.voicePool(held.instId).noteOff(held.note)
    return held
  }

  /** Release a one-shot note that wasn't registered with a key code. */
  noteOffNote(instId: Id, note: number): void {
    this.host.voicePool(instId).noteOff(note)
  }

  /** Forget held keys without sending note-offs (panic zeroes the gates). */
  clearHeld(): void {
    this.held.clear()
  }
}
