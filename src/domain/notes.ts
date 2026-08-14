/** Note <-> frequency/name helpers. Pure. */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/** Equal-tempered frequency for a MIDI note. A4 (69) = 440 Hz. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * Playback rate that pitches a sample to `midi`. MIDI 60 (C-4) = 1, i.e. the
 * sample's natural rate — the same base-note convention as the engine's
 * `sample` module.
 */
export function samplePlaybackRate(midi: number): number {
  return midiToFreq(midi) / midiToFreq(60)
}

/** Human-readable note name, e.g. 60 -> "C-4". */
export function midiToName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  // Pad to 3 chars ("C-4", "C#4") for fixed-width grid rendering.
  return name.length === 1 ? `${name}-${octave}` : `${name}${octave}`
}
