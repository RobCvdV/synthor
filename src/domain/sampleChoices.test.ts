import { describe, expect, it } from 'vitest'
import { newSampleEntity } from './factory'
import { defaultSampleId, fitsWaveform, sampleChoices, sortSamples } from './sampleChoices'
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

describe('sortSamples / defaultSampleId', () => {
  const byId = { [loop.id]: loop, [cycle.id]: cycle, x: { ...cycle, id: 'x', name: 'alpha' } }

  it('sorts by name', () => {
    expect(sortSamples(byId).map((smp) => smp.name)).toEqual(['alpha', 'cycle', 'loop'])
  })

  it('defaults to the first eligible sample, or none', () => {
    expect(defaultSampleId('sample', byId)).toBe('x')
    expect(defaultSampleId('wave', { [loop.id]: loop })).toBeUndefined()
    expect(defaultSampleId('conv', {})).toBeUndefined()
  })
})
