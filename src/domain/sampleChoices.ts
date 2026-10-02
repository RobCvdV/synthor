import { WAVEFORM_MAX_LENGTH_SECONDS } from './moduleDefs'
import { midiToFreq, samplePlaybackRate } from './notes'
import type { Id, ModuleType, SampleEntity } from './types'

/** Whether a sample is short enough to serve as one waveform cycle. */
export function fitsWaveform(sample: { frames: number; sampleRate: number }): boolean {
  return sample.frames / sample.sampleRate <= WAVEFORM_MAX_LENGTH_SECONDS
}

/** Samples sorted by name, as the pickers list them. */
export function sortSamples(samples: Record<Id, SampleEntity>): SampleEntity[] {
  return Object.values(samples).sort((a, b) => a.name.localeCompare(b.name))
}

/** The samples a module of this type can pick from, in picker order. */
export function sampleChoices(moduleType: ModuleType, sortedSamples: SampleEntity[]): SampleEntity[] {
  return moduleType === 'wave' ? sortedSamples.filter(fitsWaveform) : sortedSamples
}

/** The sample a newly added module starts with: the first choice, if any. */
export function defaultSampleId(moduleType: ModuleType, samples: Record<Id, SampleEntity>): Id | undefined {
  return sampleChoices(moduleType, sortSamples(samples))[0]?.id
}

/**
 * How a key previews a sample: a single cycle loops at the note's frequency (while the key is
 * held), anything longer plays once, pitched relative to C-4.
 */
export function samplePreviewPlan(sample: { frames: number; sampleRate: number }, midi: number): { rate: number; loop: boolean } {
  return fitsWaveform(sample)
    ? { rate: midiToFreq(midi) * sample.frames / sample.sampleRate, loop: true }
    : { rate: samplePlaybackRate(midi), loop: false }
}
