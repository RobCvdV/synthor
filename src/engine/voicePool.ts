import type { NodeRepr_t } from '@elemaudio/core'
import type { ParamRefRegistry } from '../audio/paramRefs'
import { midiToFreq } from '../domain/notes'

/**
 * Fixed-size voice pool for an instrument.  Pre-allocates N voice slots
 * with createRef-backed freq/gate nodes.  Note on/off updates the refs
 * directly — no graph recompilation needed for note events.
 */
export class VoicePool {
  /** How many voices this pool can sound simultaneously. */
  readonly size: number

  private registry: ParamRefRegistry | null

  /** Per-slot state. */
  private slots: {
    note: number | null
    gate: 0 | 1
    velocity: number
    /** Release tail timer id, or 0 when not releasing. */
    releaseTimer: number
  }[]

  /** Freq ref keys per slot (lazily created). */
  private freqKeys: string[]
  /** Gate ref keys per slot. */
  private gateKeys: string[]

  /** Map note → slot index for fast look-up on note-off. */
  private noteMap = new Map<number, number>()

  /** Stack of free slot indices. */
  private freeStack: number[] = []

  /** Callback when voices change (for optional store sync). */
  onChange?: () => void

  constructor(size: number, keyPrefix: string, registry?: ParamRefRegistry) {
    this.size = size
    this.registry = registry ?? null
    this.slots = Array.from({ length: size }, () => ({
      note: null, gate: 0, velocity: 0, releaseTimer: 0,
    }))
    this.freqKeys = Array.from({ length: size }, (_, i) => `${keyPrefix}:v:${i}:freq`)
    this.gateKeys = Array.from({ length: size }, (_, i) => `${keyPrefix}:v:${i}:gate`)
    // All slots start free.
    for (let i = size - 1; i >= 0; i--) this.freeStack.push(i)
  }

  /** Attach to a registry (called when the host is ready). */
  attach(registry: ParamRefRegistry): void {
    this.registry = registry
  }

  /** Ensure voice refs exist in the registry (call during first compile). */
  prime(): void {
    const r = this.registry
    if (!r) return
    for (let i = 0; i < this.size; i++) {
      r.getOrCreate(this.freqKeys[i], 0)
      r.getOrCreate(this.gateKeys[i], 0)
    }
  }

  /** Return a ref node for a slot's frequency. */
  freqNode(slot: number): NodeRepr_t | number {
    if (!this.registry) return 0
    return this.registry.getOrCreate(this.freqKeys[slot], 0)
  }

  /** Return a ref node for a slot's gate. */
  gateNode(slot: number): NodeRepr_t | number {
    if (!this.registry) return 0
    return this.registry.getOrCreate(this.gateKeys[slot], 0)
  }

  /** Activate a voice for a note.  Returns the slot index, or -1 if full. */
  noteOn(note: number, velocity = 127): number {
    // Retrigger: if this note is already sounding, reuse its slot.
    const existing = this.noteMap.get(note)
    if (existing !== undefined) {
      const s = this.slots[existing]
      if (s.releaseTimer) { clearTimeout(s.releaseTimer); s.releaseTimer = 0 }
      s.gate = 1
      s.velocity = velocity
      this.setGate(existing, 1)
      this.onChange?.()
      return existing
    }

    // Find a free slot.
    let idx = this.freeStack.pop()
    if (idx === undefined) {
      // Pool exhausted — steal the slot with the oldest note-off.
      // Find a slot in release (gate=0) and take it.
      for (let i = 0; i < this.size; i++) {
        if (this.slots[i].gate === 0) {
          idx = i
          if (this.slots[i].releaseTimer) { clearTimeout(this.slots[i].releaseTimer); this.slots[i].releaseTimer = 0 }
          if (this.slots[i].note != null) this.noteMap.delete(this.slots[i].note!)
          break
        }
      }
      // If all slots are active (gate=1), steal the first active one.
      if (idx === undefined) {
        idx = 0
        if (this.slots[0].note != null) this.noteMap.delete(this.slots[0].note)
        if (this.slots[0].releaseTimer) { clearTimeout(this.slots[0].releaseTimer); this.slots[0].releaseTimer = 0 }
      }
    }

    const s = this.slots[idx]
    s.note = note
    s.gate = 1
    s.velocity = velocity
    this.noteMap.set(note, idx)
    this.setRefs(idx, note, 1)
    this.onChange?.()
    return idx
  }

  /** Release a voice.  Keeps the frequency so the release tail rings at
   *  the correct pitch — only the gate drops to 0. */
  noteOff(note: number): void {
    const idx = this.noteMap.get(note)
    if (idx === undefined) return

    const s = this.slots[idx]
    s.gate = 0
    this.noteMap.delete(note)

    // Only drop gate — keep frequency for the release tail.
    this.setGate(idx, 0)
    this.onChange?.()

    // After the release tail, free the slot.
    if (s.releaseTimer) clearTimeout(s.releaseTimer)
    s.releaseTimer = window.setTimeout(() => {
      s.releaseTimer = 0
      s.note = null
      this.freeStack.push(idx)
      this.onChange?.()
    }, 3500)
  }

  /** Silence everything immediately — drops gate on ALL slots. */
  panic(): void {
    for (let i = 0; i < this.size; i++) {
      const s = this.slots[i]
      if (s.releaseTimer) { clearTimeout(s.releaseTimer); s.releaseTimer = 0 }
      s.gate = 0
      s.note = null
      this.setGate(i, 0)
    }
    this.noteMap.clear()
    this.freeStack.length = 0
    for (let i = this.size - 1; i >= 0; i--) this.freeStack.push(i)
    this.onChange?.()
  }

  /** Current slot states, for the compile step. */
  snapshot(): { note: number | null; gate: 0 | 1; velocity: number }[] {
    return this.slots.map((s) => ({ note: s.note, gate: s.gate, velocity: s.velocity }))
  }

  private setRefs(slot: number, note: number, gate: number): void {
    if (!this.registry) return
    this.registry.getOrCreate(this.freqKeys[slot], note > 0 ? midiToFreq(note) : 0)
    this.registry.getOrCreate(this.gateKeys[slot], gate)
    this.registry.setValue(this.freqKeys[slot], note > 0 ? midiToFreq(note) : 0)
    this.registry.setValue(this.gateKeys[slot], gate)
  }

  /** Set only the gate, keeping the current frequency. */
  private setGate(slot: number, gate: number): void {
    if (!this.registry) return
    this.registry.getOrCreate(this.gateKeys[slot], gate)
    this.registry.setValue(this.gateKeys[slot], gate)
  }
}
