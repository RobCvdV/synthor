/**
 * Single-cycle wavetable generators for "Create Sample". The `wave` module
 * treats the whole buffer as ONE cycle (pitched by the note), so these
 * generate exactly one cycle — length determines cycle resolution, not pitch.
 * Every shape but square starts and ends at zero, so the cycle loops without a click.
 */

export type WaveShape = 'sine' | 'square' | 'saw' | 'triangle' | 'noise'

export const WAVE_SHAPES: WaveShape[] = ['sine', 'square', 'saw', 'triangle', 'noise']

/** Single-cycle lengths offered when making or creating a cycle. */
export const CYCLE_LENGTHS = [256, 512, 1024, 2048, 4096] as const
export const DEFAULT_CYCLE_LENGTH = 2048

/** Peak level of generated and extracted cycles. */
export const CYCLE_PEAK = 0.8
const AMP = CYCLE_PEAK

export function generateWaveform(shape: WaveShape, frames: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(frames)
  if (shape === 'noise') {
    for (let i = 1; i < frames; i++) out[i] = AMP * (2 * Math.random() - 1)
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
        // Rises from 0, drops at the half-way point, rises back to 0.
        out[i] = AMP * (2 * ((phase + 0.5) % 1) - 1)
        break
      case 'triangle':
        out[i] = AMP * (phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4)
        break
    }
  }
  return out
}
