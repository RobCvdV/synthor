import { describe, expect, it } from 'vitest'
import type { PcmData } from '../../audio/sampleEdit'
import { driveGain, initialValues, isLiveProcess, LIVE_PROCESSES, processedSel, processRange, smoothCutoff } from './liveProcesses'

const ctx = { sampleRate: 48000 }
const pcm = (v: number[]): PcmData => [new Float32Array(v)]

describe('liveProcesses', () => {
  it('maps smoothness from Nyquist down ten octaves', () => {
    expect(smoothCutoff(0)).toBe(0.5)
    expect(smoothCutoff(100)).toBeCloseTo(0.5 / 1024)
    expect(LIVE_PROCESSES.smooth.params[0].describe!(100, ctx)).toBe('23 Hz')
  })

  it('returns the source untouched at zero, so Done has nothing to commit', () => {
    const src = pcm([1, -1, 1, -1])
    const range = { start: 0, end: 4 }
    expect(LIVE_PROCESSES.smooth.apply(src, range, { amount: 0 }, ctx)).toBe(src)
    expect(LIVE_PROCESSES.drive.apply(src, range, { amount: 0 }, ctx)).toBe(src)
    expect(LIVE_PROCESSES.smooth.apply(src, range, initialValues(LIVE_PROCESSES.smooth), ctx)).not.toBe(src)
  })

  it('ports volume, fades and pitch, which changes the length', () => {
    const src = pcm(new Array(100).fill(0.5))
    const whole = { start: 0, end: 100 }
    expect(LIVE_PROCESSES.volume.apply(src, whole, initialValues(LIVE_PROCESSES.volume), ctx)).toBe(src)
    expect(LIVE_PROCESSES.volume.apply(src, whole, { percent: 50 }, ctx)[0][0]).toBe(0.25)
    expect(LIVE_PROCESSES.volume.params[0].describe!(200, ctx)).toBe('6.0 dB')
    const faded = LIVE_PROCESSES.fadeOut.apply(src, whole, initialValues(LIVE_PROCESSES.fadeOut), ctx)[0]
    expect([faded[0], faded[99]]).toEqual([0.5, 0])
    expect(initialValues(LIVE_PROCESSES.fadeIn)).toEqual({ from: 0, to: 100 })
    expect(LIVE_PROCESSES.pitch.apply(src, { start: 10, end: 50 }, { semitones: 12 }, ctx)[0].length).toBe(80)
    expect(LIVE_PROCESSES.pitch.apply(src, whole, { semitones: 0 }, ctx)).toBe(src)
  })

  it('inserts silence at the selection start or cursor, and selects it', () => {
    const def = LIVE_PROCESSES.insertSilence
    const src = pcm([1, 1, 1, 1])
    expect(processRange(def, { pcm: src, sel: { start: 1, end: 3 }, cursor: 0 })).toEqual({ start: 1, end: 1 })
    expect(processRange(def, { pcm: src, sel: null, cursor: 2 })).toEqual({ start: 2, end: 2 })
    expect(processRange(def, { pcm: src, sel: null, cursor: null })).toEqual({ start: 0, end: 0 })
    const out = def.apply(src, { start: 2, end: 2 }, { ms: 0.0625 }, { sampleRate: 32000 })
    expect(Array.from(out[0])).toEqual([1, 1, 0, 0, 1, 1])
    expect(def.apply(src, { start: 2, end: 2 }, { ms: 0 }, ctx)).toBe(src)
    expect(processedSel(null, { start: 2, end: 2 }, 2)).toEqual({ start: 2, end: 4 })
  })

  it('keeps a selection on the processed range as it resizes, and adds none for whole-sample edits', () => {
    expect(processedSel({ start: 10, end: 50 }, { start: 10, end: 50 }, -20)).toEqual({ start: 10, end: 30 })
    expect(processedSel(null, { start: 0, end: 100 }, -50)).toBeNull()
    expect(processedSel({ start: 1, end: 2 }, { start: 1, end: 2 }, 0)).toEqual({ start: 1, end: 2 })
  })

  it('drives near-linearly at low settings', () => {
    expect(driveGain(0)).toBeLessThan(0.02)
    expect(driveGain(100)).toBe(32)
  })

  it('knows its kinds', () => {
    expect(isLiveProcess('crush')).toBe(true)
    expect(isLiveProcess('trim')).toBe(false)
    expect(isLiveProcess('toString')).toBe(false)
  })
})
