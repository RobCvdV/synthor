import type { ParamRefRegistry } from './paramRefs'

/**
 * Maps MIDI CC numbers to param-ref keys so CC knob turns update the right
 * refs directly — no graph recompile needed.
 *
 * Populated during compile (effect1/effect2/midicc modules call `register`).
 * Cleared before each structural recompile so stale bindings don't accumulate.
 */
export class CcBindings {
  private map = new Map<number, Set<string>>()

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

  /** Push a CC value (raw 0-127) to every ref registered for that CC number. */
  update(cc: number, raw: number, refs: ParamRefRegistry): void {
    const keys = this.map.get(cc)
    if (!keys) return
    const norm = raw / 127
    for (const key of keys) refs.setValue(key, norm)
  }

  /** Discard all registrations — call before each structural recompile. */
  clear(): void {
    this.map.clear()
  }
}
