import { midiToFreq } from '../domain/notes'
import type { ParamRefRegistry } from '../audio/paramRefs'

/**
 * Fixed-size voice pool for an instrument.  Manages voice allocation (which
 * MIDI note → which slot) and updates per-voice createRef nodes directly —
 * no graph recompile needed, no snapshot(), no onChange callback.
 */
export class VoicePool {
  readonly size: number

  private noteMap = new Map<number, number>()
  private freeStack: number[] = []
  private releaseTimers = new Map<number, ReturnType<typeof setTimeout>>()

  constructor(
    private refs: ParamRefRegistry,
    private instId: string,
    size = 8,
  ) {
    this.size = size
    for (let i = size - 1; i >= 0; i--) this.freeStack.push(i)
  }

  // ── public API ──────────────────────────────────────────────────────

  /** Start a note. Returns the slot index used. */
  noteOn(note: number, velocity = 127): number {
    const idx = this.allocate(note)
    const prefix = `${this.instId}:v:${idx}`
    this.refs.setValue(`${prefix}:freq`, midiToFreq(note))
    this.refs.setValue(`${prefix}:vel`, velocity / 127)
    this.refs.setValue(`${prefix}:gate`, 1)
    return idx
  }

  /** End a note — gate drops to 0, release tail rings, slot frees after timeout. */
  noteOff(note: number): void {
    const idx = this.noteMap.get(note)
    if (idx === undefined) return
    this.refs.setValue(`${this.instId}:v:${idx}:gate`, 0)

    // Free the slot after the release tail; keep the mapping until then so
    // retrigger reuses the same slot.
    this.clearReleaseTimer(idx)
    this.releaseTimers.set(idx, setTimeout(() => {
      this.releaseTimers.delete(idx)
      this.noteMap.delete(note)
      this.freeStack.push(idx)
    }, 3500))
  }

  /** Kill every sounding voice immediately — all gates to 0, all slots freed. */
  panic(): void {
    for (const t of this.releaseTimers.values()) clearTimeout(t)
    this.releaseTimers.clear()
    for (let i = 0; i < this.size; i++) {
      this.refs.setValue(`${this.instId}:v:${i}:gate`, 0)
    }
    this.noteMap.clear()
    this.freeStack.length = 0
    for (let i = this.size - 1; i >= 0; i--) this.freeStack.push(i)
  }

  // ── internal ────────────────────────────────────────────────────────

  /** Allocate a slot for `note`, reusing an existing mapping or stealing
   *  from a releasing/oldest-active slot when the pool is exhausted. */
  private allocate(note: number): number {
    const existing = this.noteMap.get(note)
    if (existing !== undefined) {
      // Retrigger — cancel pending release, reuse same slot.
      this.clearReleaseTimer(existing)
      return existing
    }

    // Try a free slot first.
    const free = this.freeStack.pop()
    if (free !== undefined) {
      this.noteMap.set(note, free)
      return free
    }

    // Pool full — steal a slot (clears the old mapping internally).
    const stolen = this.stealSlot()
    this.clearReleaseTimer(stolen)
    this.noteMap.set(note, stolen)
    return stolen
  }

  /** Pick the best slot to steal: releasing slots first (gate already 0),
   *  then the oldest active slot (slot 0).  Also clears the old note mapping. */
  private stealSlot(): number {
    // Steal a releasing slot if available.
    for (const [idx, timer] of this.releaseTimers) {
      clearTimeout(timer)
      this.releaseTimers.delete(idx)
      // Clear the old note mapping for this slot.
      for (const [n, i] of this.noteMap) {
        if (i === idx) { this.noteMap.delete(n); break }
      }
      return idx
    }
    // No releasing slots — clear slot 0's mapping and steal it.
    for (const [n, i] of this.noteMap) {
      if (i === 0) { this.noteMap.delete(n); break }
    }
    return 0
  }

  private clearReleaseTimer(idx: number): void {
    const t = this.releaseTimers.get(idx)
    if (t !== undefined) {
      clearTimeout(t)
      this.releaseTimers.delete(idx)
    }
  }
}
