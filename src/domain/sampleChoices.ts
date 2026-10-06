import { CYCLE_SIZE_CHOICES, MAX_CYCLE_FRAMES, WAVETABLE_GRAIN, WAVETABLE_MAX_FRAMES } from './moduleDefs'
import { midiToFreq, samplePlaybackRate } from './notes'
import type { Id, ModuleType, SampleEntity } from './types'

type CycleSample = { frames: number; cycleLength?: number }

/**
 * Whether a sample is one waveform cycle: its declared cycle length covers it, or, undeclared,
 * it is no longer than a cycle can be. Short one-shots past that limit stay one-shots.
 */
export function fitsWaveform(sample: CycleSample): boolean {
  // Tolerates the rounding a resampled cycle picks up.
  return sample.cycleLength ? sample.frames < sample.cycleLength + 1 : sample.frames <= MAX_CYCLE_FRAMES
}

/** A single cycle or a wavetable: its length is resolution, so the note sets its pitch. */
export function holdsCycles(sample: CycleSample): boolean {
  return !!sample.cycleLength || fitsWaveform(sample)
}

/** Whether the wave module can play a sample: a single cycle, or a wavetable of whole frames. */
export function fitsWavetable(sample: CycleSample): boolean {
  return fitsWaveform(sample) || (sample.frames <= WAVETABLE_MAX_FRAMES && (!!sample.cycleLength || sample.frames % WAVETABLE_GRAIN === 0))
}

/** Frames per cycle for the wave module's `cycle` choice (index into CYCLE_SIZE_CHOICES). */
export function cycleLength(sample: CycleSample, choice: number): number {
  const c = CYCLE_SIZE_CHOICES[Math.round(choice)] ?? 'auto'
  if (c === 'whole') return sample.frames
  if (c === 'auto') return Math.min(sample.cycleLength ?? (fitsWaveform(sample) ? sample.frames : 2048), sample.frames)
  return Math.min(Number(c), sample.frames)
}

/** How many whole cycles (wavetable frames) a sample holds at `size` frames each. */
export function wavetableFrameCount(frames: number, size: number): number {
  // Tolerates the rounding a resampled table picks up.
  return Math.max(1, Math.floor(frames / size + 1e-3))
}

/** Samples sorted by name, as the pickers list them. */
export function sortSamples(samples: Record<Id, SampleEntity>): SampleEntity[] {
  return Object.values(samples).sort((a, b) => a.name.localeCompare(b.name))
}

/** The samples a module of this type can pick from, in picker order. */
export function sampleChoices(moduleType: ModuleType, sortedSamples: SampleEntity[]): SampleEntity[] {
  return moduleType === 'wave' ? sortedSamples.filter(fitsWavetable) : sortedSamples
}

/** The sample a newly added module starts with: the first choice, if any. */
export function defaultSampleId(moduleType: ModuleType, samples: Record<Id, SampleEntity>): Id | undefined {
  return sampleChoices(moduleType, sortSamples(samples))[0]?.id
}

/**
 * How a key previews a sample: a single cycle loops at the note's frequency (while the key is
 * held), anything longer plays once, pitched relative to C-4.
 */
export function samplePreviewPlan(sample: CycleSample & { sampleRate: number }, midi: number): { rate: number; loop: boolean } {
  return fitsWaveform(sample)
    ? { rate: midiToFreq(midi) * sample.frames / sample.sampleRate, loop: true }
    : { rate: samplePlaybackRate(midi), loop: false }
}

/** How the wave module can use a sample, for the sample editor's info line. */
export function waveUse(sample: CycleSample): string {
  if (fitsWaveform(sample)) return 'single cycle'
  if (!fitsWavetable(sample)) return `not usable as a waveform (wavetables are whole multiples of ${WAVETABLE_GRAIN} frames)`
  const size = cycleLength(sample, 0)
  return `wavetable: ${wavetableFrameCount(sample.frames, size)} frames of ${+size.toFixed(1)}`
}
