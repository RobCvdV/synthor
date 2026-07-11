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
