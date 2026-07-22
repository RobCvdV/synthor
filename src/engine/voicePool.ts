/**
 * Fixed-size voice pool for an instrument.  Manages voice allocation and
 * state only — the actual audio graph is built by compilePreview using
 * plain el.const nodes read from snapshot().  No createRef, no setValue,
 * no async races: just synchronous state + compile-driven graph updates
 * like the tracker.
 */
export class VoicePool {
  readonly size: number

  private slots: {
    note: number | null
    gate: 0 | 1
    velocity: number
    releaseTimer: number
  }[]

  private noteMap = new Map<number, number>()
  private freeStack: number[] = []

  onChange?: () => void

  constructor(size: number) {
    this.size = size
    this.slots = Array.from({ length: size }, () => ({
      note: null, gate: 0, velocity: 0, releaseTimer: 0,
    }))
    for (let i = size - 1; i >= 0; i--) this.freeStack.push(i)
  }

  noteOn(note: number, velocity = 127): number {
    const existing = this.noteMap.get(note)
    if (existing !== undefined) {
      const s = this.slots[existing]
      if (s.releaseTimer) { clearTimeout(s.releaseTimer); s.releaseTimer = 0 }
      s.gate = 1
      s.velocity = velocity
      this.onChange?.()
      return existing
    }

    let idx = this.freeStack.pop()
    if (idx === undefined) {
      for (let i = 0; i < this.size; i++) {
        if (this.slots[i].gate === 0) {
          idx = i
          if (this.slots[i].releaseTimer) { clearTimeout(this.slots[i].releaseTimer); this.slots[i].releaseTimer = 0 }
          if (this.slots[i].note != null) this.noteMap.delete(this.slots[i].note!)
          break
        }
      }
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
    this.onChange?.()
    return idx
  }

  noteOff(note: number): void {
    const idx = this.noteMap.get(note)
    if (idx === undefined) return

    const s = this.slots[idx]
    s.gate = 0
    this.noteMap.delete(note)
    this.onChange?.()

    if (s.releaseTimer) clearTimeout(s.releaseTimer)
    s.releaseTimer = window.setTimeout(() => {
      s.releaseTimer = 0
      s.note = null
      this.freeStack.push(idx)
      this.onChange?.()
    }, 3500)
  }

  panic(): void {
    for (let i = 0; i < this.size; i++) {
      const s = this.slots[i]
      if (s.releaseTimer) { clearTimeout(s.releaseTimer); s.releaseTimer = 0 }
      s.gate = 0
      s.note = null
    }
    this.noteMap.clear()
    this.freeStack.length = 0
    for (let i = this.size - 1; i >= 0; i--) this.freeStack.push(i)
    this.onChange?.()
  }

  snapshot(): { note: number | null; gate: 0 | 1; velocity: number }[] {
    return this.slots.map((s) => ({ note: s.note, gate: s.gate, velocity: s.velocity }))
  }
}
