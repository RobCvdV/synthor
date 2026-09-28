import { WAVEFORM_MAX_LENGTH_SECONDS } from './moduleDefs'
import type { ModuleType, SampleEntity } from './types'

/** Whether a sample is short enough to serve as one waveform cycle. */
export function fitsWaveform(sample: { frames: number; sampleRate: number }): boolean {
  return sample.frames / sample.sampleRate <= WAVEFORM_MAX_LENGTH_SECONDS
}

/** The name-sorted samples a module's `sampleIndex` indexes into; the engine resolves the same list. */
export function sampleChoices(moduleType: ModuleType, sortedSamples: SampleEntity[]): SampleEntity[] {
  return moduleType === 'wave' ? sortedSamples.filter(fitsWaveform) : sortedSamples
}
