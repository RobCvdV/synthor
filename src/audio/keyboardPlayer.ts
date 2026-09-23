import type { Id } from '../domain/types'
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
   *  via noteOff(code)); omit for one-shot pips (released via noteOffNote).
   *  `slot` is the tracker slot to prefer when not in free play. */
  noteOn(instId: Id, note: number, code?: string, slot?: number): void {
    if (code) this.held.set(code, { note, instId })
    this.host.live.noteOn(instId, note, 127, slot)
  }

  /** Release a held physical key. Returns what was released, if anything. */
  noteOff(code: string): ReleasedNote | undefined {
    const held = this.held.get(code)
    if (!held) return undefined
    this.held.delete(code)
    this.host.live.noteOff(held.instId, held.note)
    return held
  }

  /** Release a one-shot note that wasn't registered with a key code. */
  noteOffNote(instId: Id, note: number): void {
    this.host.live.noteOff(instId, note)
  }

  /** Forget held keys without sending note-offs (panic zeroes the gates). */
  clearHeld(): void {
    this.held.clear()
  }
}
