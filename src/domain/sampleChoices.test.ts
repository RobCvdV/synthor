import { describe, expect, it } from 'vitest'
import { newSampleEntity } from './factory'
import { fitsWaveform, sampleChoices } from './sampleChoices'
import { WAVEFORM_MAX_LENGTH_SECONDS } from './moduleDefs'

const rate = 48000
const cycle = newSampleEntity('cycle', 'h1', 'cycle.wav', rate, 1, 256)
const loop = newSampleEntity('loop', 'h2', 'loop.wav', rate, 1, rate * 2)

describe('sampleChoices', () => {
  it('offers wave modules only samples short enough for one cycle', () => {
    expect(sampleChoices('wave', [cycle, loop])).toEqual([cycle])
  })

  it('offers other sample modules every sample', () => {
    expect(sampleChoices('sample', [cycle, loop])).toEqual([cycle, loop])
    expect(sampleChoices('conv', [cycle, loop])).toEqual([cycle, loop])
  })

  it('accepts a sample exactly at the length limit', () => {
    expect(fitsWaveform({ frames: WAVEFORM_MAX_LENGTH_SECONDS * rate, sampleRate: rate })).toBe(true)
  })
})
