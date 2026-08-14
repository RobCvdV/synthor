/**
 * Single-cycle wavetable generators for "Create Sample". The `wave` module
 * treats the whole buffer as ONE cycle (pitched by the note), so these
 * generate exactly one cycle — length determines cycle resolution, not pitch.
 * Noise is the only non-deterministic generator (documented — the content
 * hash covers whatever bytes it produces).
 */

export type WaveShape = 'sine' | 'square' | 'saw' | 'triangle' | 'noise'

export const WAVE_SHAPES: WaveShape[] = ['sine', 'square', 'saw', 'triangle', 'noise']

const AMP = 0.8

export function generateWaveform(shape: WaveShape, frames: number): Float32Array {
  const out = new Float32Array(frames)
  if (shape === 'noise') {
    for (let i = 0; i < frames; i++) out[i] = AMP * (2 * Math.random() - 1)
    return out
  }
  for (let i = 0; i < frames; i++) {
    const phase = i / frames // 0..1 = one full cycle
    switch (shape) {
      case 'sine':
        out[i] = AMP * Math.sin(2 * Math.PI * phase)
        break
      case 'square':
        out[i] = AMP * (phase < 0.5 ? 1 : -1)
        break
      case 'saw':
        out[i] = AMP * (2 * phase - 1)
        break
      case 'triangle':
        out[i] = AMP * (4 * Math.abs(phase - 0.5) - 1)
        break
    }
  }
  return out
}
