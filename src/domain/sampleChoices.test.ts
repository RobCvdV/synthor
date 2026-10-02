import { describe, expect, it } from 'vitest'
import { newSampleEntity } from './factory'
import { defaultSampleId, fitsWaveform, sampleChoices, samplePreviewPlan, sortSamples } from './sampleChoices'
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

describe('samplePreviewPlan', () => {
  it('loops a single cycle at the note frequency', () => {
    // 2048 frames at 48 kHz played at A-4: 440 cycles per second.
    const plan = samplePreviewPlan({ frames: 2048, sampleRate: 48000 }, 69)
    expect(plan.loop).toBe(true)
    expect(plan.rate * 48000 / 2048).toBeCloseTo(440)
  })
  it('plays longer samples once, C-4 at the natural rate', () => {
    expect(samplePreviewPlan({ frames: 48000, sampleRate: 48000 }, 60)).toEqual({ rate: 1, loop: false })
    expect(samplePreviewPlan({ frames: 48000, sampleRate: 48000 }, 72).rate).toBeCloseTo(2)
  })
})
