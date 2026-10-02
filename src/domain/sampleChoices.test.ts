import { describe, expect, it } from 'vitest'
import { newSampleEntity } from './factory'
import {
  cycleLength, defaultSampleId, fitsWaveform, fitsWavetable, sampleChoices, samplePreviewPlan, sortSamples, waveUse,
  wavetableFrameCount,
} from './sampleChoices'
import { CYCLE_SIZE_CHOICES, WAVEFORM_MAX_LENGTH_SECONDS, structuralParamsKey } from './moduleDefs'

const rate = 48000
const cycle = newSampleEntity('cycle', 'h1', 'cycle.wav', rate, 1, 256)
/** Too long for one cycle and not a whole number of wavetable frames. */
const loop = newSampleEntity('loop', 'h2', 'loop.wav', rate, 1, rate * 2 + 1)

describe('sampleChoices', () => {
  it('offers wave modules only single cycles and wavetables', () => {
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

describe('wavetables', () => {
  const choice = (c: (typeof CYCLE_SIZE_CHOICES)[number]) => CYCLE_SIZE_CHOICES.indexOf(c)

  it('accepts single cycles, whole multiples of 256 frames, and samples with a known cycle length', () => {
    expect(fitsWavetable({ frames: 2048, sampleRate: 48000 })).toBe(true)
    expect(fitsWavetable({ frames: 64 * 2048, sampleRate: 48000 })).toBe(true)
    expect(fitsWavetable({ frames: 48000, sampleRate: 48000 })).toBe(false)
    expect(fitsWavetable({ frames: 71347, sampleRate: 48000, cycleLength: 2229.1 })).toBe(true)
    expect(fitsWavetable({ frames: 257 * 4096, sampleRate: 48000 })).toBe(false)
  })

  it('picks the cycle length: auto uses the stored one, else whole for a single cycle, else 2048', () => {
    expect(cycleLength({ frames: 2048, sampleRate: 48000 }, choice('auto'))).toBe(2048)
    expect(cycleLength({ frames: 16384, sampleRate: 48000 }, choice('auto'))).toBe(2048)
    expect(cycleLength({ frames: 16384, sampleRate: 48000, cycleLength: 512 }, choice('auto'))).toBe(512)
    expect(cycleLength({ frames: 16384, sampleRate: 48000, cycleLength: 512 }, choice('whole'))).toBe(16384)
    expect(cycleLength({ frames: 16384, sampleRate: 48000 }, choice('256'))).toBe(256)
    expect(cycleLength({ frames: 100, sampleRate: 48000 }, choice('4096'))).toBe(100)
  })

  it('counts frames, tolerating resampling rounding', () => {
    expect(wavetableFrameCount(16384, 2048)).toBe(8)
    expect(wavetableFrameCount(2229.1 * 8 - 0.4, 2229.1)).toBe(8)
    expect(wavetableFrameCount(100, 2048)).toBe(1)
  })

  it('describes the use for the editor', () => {
    expect(waveUse({ frames: 2048, sampleRate: 48000 })).toBe('single cycle')
    expect(waveUse({ frames: 16384, sampleRate: 48000, cycleLength: 512 })).toBe('wavetable: 32 frames of 512')
    expect(waveUse({ frames: 48001, sampleRate: 48000 })).toMatch(/not usable/)
  })

  it('keys the params the graph is compiled from', () => {
    expect(structuralParamsKey('wave', { cycle: 3, position: 0.5 })).toBe('cycle=3')
    expect(structuralParamsKey('sample', {})).toBe('loop=0,pitchTrack=1')
    expect(structuralParamsKey('filter', { bypass: 1, cutoff: 300 })).toBe('bypass=1')
    expect(structuralParamsKey('osc', {})).toBe('')
  })
})
