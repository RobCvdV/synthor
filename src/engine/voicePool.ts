import { midiToFreq } from '../domain/notes'
import type { ParamRefRegistry } from '../audio/paramRefs'
import type { DrumKitInstrument, DrumKitSlot } from '../domain/types'
import { getSlotForNote } from '../domain/types'

/** Number of fixed voice slots per instrument for live keyboard/MIDI playback.
 *  Must match the voiceCount in compileLiveVoices — mismatches cause dead slots
 *  (notes that appear allocated in VoicePool but have no ref nodes in the graph). */
export const LIVE_VOICE_COUNT = 4

/**
 * Fixed-size voice pool for an instrument.  Manages voice allocation (which
 * MIDI note → which slot) and updates per-voice createRef nodes directly —
 * no graph recompile needed, no snapshot(), no onChange callback.
 *
 * In drumkit mode (kit provided), MIDI notes are routed to the correct
 * drumkit slot via getSlotForNote. Each slot gets 1 sub-voice.
 */
export class VoicePool {
  readonly size: number

  private noteMap = new Map<number, number>()
  private freeStack: number[] = []
  private releaseTimers = new Map<number, ReturnType<typeof setTimeout>>()

  /** Set via setKit() for drumkit instruments. */
  private kit?: DrumKitInstrument

  constructor(
    private refs: ParamRefRegistry,
    private instId: string,
    size = 4,
  ) {
    this.size = size
    for (let i = size - 1; i >= 0; i--) this.freeStack.push(i)
  }

  /** True when this pool routes to drumkit slots instead of generic voices. */
  get isDrumKit(): boolean {
    return this.kit !== undefined
  }

  /** Number of drumkit slots (0 when not in drumkit mode). */
  get slotCount(): number {
    return this.kit?.slots.length ?? 0
  }

  /** Configure this pool for drumkit mode. No-op if already configured.
   *  Safe to call after construction — call before any note events. */
  setKit(kit: DrumKitInstrument): void {
    if (this.kit) return
    this.kit = kit
  }

  /** Snapshot of currently held notes → slot indices. Used by UI voice counter. */
  getActiveNotes(): Map<number, number> {
    return new Map(this.noteMap)
  }

  /** Number of currently active (gated) voices. */
  get activeCount(): number {
    return this.noteMap.size
  }

  /** Called when a voice is stolen (pool exhausted). */
  onVoiceSteal: ((instId: string, note: number) => void) | null = null

  // ── public API ──────────────────────────────────────────────────────

  /** Start a note. Returns the slot index used. */
  noteOn(note: number, velocity = 127): number {
    if (this.kit) return this.drumNoteOn(note, velocity)

    const idx = this.allocate(note)
    const prefix = `${this.instId}:v:${idx}`
    this.refs.setValue(`${prefix}:freq`, midiToFreq(note))
    this.refs.setValue(`${prefix}:vel`, velocity / 127)
    this.refs.setValue(`${prefix}:gate`, 1)
    return idx
  }

  /** End a note — gate drops to 0, release tail rings, slot frees after timeout. */
  noteOff(note: number): void {
    if (this.kit) { this.drumNoteOff(note); return }

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
    if (this.kit) {
      for (let si = 0; si < this.kit.slots.length; si++) {
        this.refs.setValue(`${this.instId}:ds:${si}:v0:gate`, 0)
      }
    } else {
      for (let i = 0; i < this.size; i++) {
        this.refs.setValue(`${this.instId}:v:${i}:gate`, 0)
      }
    }
    this.noteMap.clear()
    this.freeStack.length = 0
    for (let i = this.size - 1; i >= 0; i--) this.freeStack.push(i)
  }

  // ── drumkit mode ────────────────────────────────────────────────────

  private drumNoteOn(note: number, velocity = 127): number {
    const kit = this.kit!
    const slot = getSlotForNote(kit, note)
    if (!slot) return -1
    const si = kit.slots.findIndex((s: DrumKitSlot) => s.id === slot.id)
    if (si < 0) return -1
    // Single sub-voice per slot.
    const sv = 0
    const prefix = `${this.instId}:ds:${si}:v${sv}`
    this.refs.setValue(`${prefix}:freq`, midiToFreq(note))
    this.refs.setValue(`${prefix}:vel`, velocity / 127)
    this.refs.setValue(`${prefix}:gate`, 1)
    return si
  }

  private drumNoteOff(note: number): void {
    const kit = this.kit!
    const slot = getSlotForNote(kit, note)
    if (!slot) return
    const si = kit.slots.findIndex((s: DrumKitSlot) => s.id === slot.id)
    if (si < 0) return
    this.refs.setValue(`${this.instId}:ds:${si}:v0:gate`, 0)
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
    this.onVoiceSteal?.(this.instId, note)
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
