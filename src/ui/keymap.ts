/**
 * Classic tracker note-entry layout on the lower keyboard row: one octave from
 * the current base, C on `z`. Returns a semitone offset, or undefined for
 * non-note keys.
 */
const KEY_TO_SEMITONE: Record<string, number> = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ',': 12,
}

export function keyToSemitone(key: string): number | undefined {
  return KEY_TO_SEMITONE[key.toLowerCase()]
}
