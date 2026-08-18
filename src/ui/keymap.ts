/**
 * Classic tracker (FastTracker/Renoise) piano layout, keyed by *physical* key
 * position (`KeyboardEvent.code`) rather than the typed character — so it works
 * the same on US/EU keyboard layouts without remapping.
 *
 * Two rows, each a chromatic run. The upper (Q) row sits exactly one octave
 * above the lower (Z) row, so `KeyQ` (C) lands right after `KeyM` (B).
 * The lower row's tail (Comma..Slash) overlaps the bottom of the upper row —
 * that overlap is intentional and traditional.
 */
const CODE_TO_SEMITONE: Record<string, number> = {
  // Lower row — current octave.
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7,
  KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,

  // Upper row — one octave up (+12).
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18,
  KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, BracketRight: 30,
}

/** Physical-key → semitone offset from the current base octave, or undefined. */
export function codeToSemitone(code: string): number | undefined {
  return CODE_TO_SEMITONE[code]
}

/** True when a keystroke should go to a focused form field, not note playback.
 *  Range sliders are excluded — they can't receive text, and we want note
 *  keys to preview while tweaking sliders. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLInputElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT') return el.type !== 'range'
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** Map a KeyboardEvent code to its hex digit value 0-15, or undefined. */
export function keyToHex(code: string): number | undefined {
  if (code === 'Digit0') return 0
  if (code === 'Digit1') return 1
  if (code === 'Digit2') return 2
  if (code === 'Digit3') return 3
  if (code === 'Digit4') return 4
  if (code === 'Digit5') return 5
  if (code === 'Digit6') return 6
  if (code === 'Digit7') return 7
  if (code === 'Digit8') return 8
  if (code === 'Digit9') return 9
  if (code === 'KeyA') return 10
  if (code === 'KeyB') return 11
  if (code === 'KeyC') return 12
  if (code === 'KeyD') return 13
  if (code === 'KeyE') return 14
  if (code === 'KeyF') return 15
  return undefined
}
