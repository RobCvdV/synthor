import type { ParamRefRegistry } from './paramRefs'

/**
 * Maps MIDI CC numbers to param-ref keys so CC knob turns update the right
 * refs directly — no graph recompile needed.
 *
 * CC values are rAF-coalesced: incoming events are buffered, and only the
 * latest value per CC number is flushed once per animation frame.  This
 * prevents the audio worklet message queue from backing up when a MIDI
 * controller sends dozens of CC events per frame.
 *
 * Populated during compile (effect1/effect2/midicc modules call `register`).
 * Cleared before each structural recompile so stale bindings don't accumulate.
 */
export class CcBindings {
  private map = new Map<number, Set<string>>()
  private pending = new Map<number, number>()
  private frame = 0
  private refs: ParamRefRegistry | null = null
  /** Called once per rAF per CC number after flush, for store updates. */
  onFlush?: (cc: number, raw: number) => void

  /** Must be called after the host creates the paramRefs registry. */
  attach(refs: ParamRefRegistry): void {
    this.refs = refs
  }

  /** Record that `refKey` should be updated when CC `cc` changes.
   *  cc=0 means "no CC assigned" — silently skipped. */
  register(cc: number, refKey: string): void {
    if (cc <= 0) return
    let keys = this.map.get(cc)
    if (!keys) {
      keys = new Set()
      this.map.set(cc, keys)
    }
    keys.add(refKey)
  }

  /** Buffer a CC value (raw 0-127).  Flushed once per animation frame so the
   *  audio worklet only gets the latest value, not every intermediate event. */
  queue(cc: number, raw: number): void {
    if (cc === 21) console.log(`[ccBindings] queue CC21 raw=${raw}  @ ${performance.now().toFixed(0)}`)
    this.pending.set(cc, raw)
    if (this.frame === 0) {
      this.frame = requestAnimationFrame(() => this.flushPending())
    }
  }

  /** Discard all registrations — call before each structural recompile. */
  clear(): void {
    this.map.clear()
    this.pending.clear()
  }

  // ── internal ────────────────────────────────────────────────────────

  private flushPending(): void {
    this.frame = 0
    if (this.pending.size === 0) return
    for (const [cc, raw] of this.pending) {
      // Update the store once per frame per CC (not on every event).
      this.onFlush?.(cc, raw)
      if (!this.refs) continue
      const keys = this.map.get(cc)
      if (!keys) continue
      const norm = raw / 127
      if (cc === 21) console.log(`[ccBindings] FLUSH CC21 norm=${norm.toFixed(3)}  @ ${performance.now().toFixed(0)}`)
      for (const key of keys) this.refs.setValue(key, norm)
    }
    this.pending.clear()
  }
}
