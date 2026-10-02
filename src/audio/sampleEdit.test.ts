import { describe, expect, it } from 'vitest'
import {
  adaptChannels, copyRange, drawLine, cutRange, fadeRange, framesOf,
  gainRange, insertAt, nearestZeroCrossing, normalizeRange, pasteAt, removeDcRange, repitchRange, replaceRange,
  resampleTo, reverseRange, silenceRange, trimToRange,
} from './sampleEdit'

const mono = (vals: number[]) => [new Float32Array(vals)]
const stereo = (l: number[], r: number[]) => [new Float32Array(l), new Float32Array(r)]

const toArr = (data: Float32Array[]) => data.map((ch) => Array.from(ch))

describe('copyRange', () => {
  it('copies an inclusive range', () => {
    expect(toArr(copyRange(mono([1, 2, 3, 4, 5]), 1, 4))).toEqual([[2, 3, 4]])
  })
  it('clamps out-of-bounds and inverted ranges', () => {
    expect(toArr(copyRange(mono([1, 2, 3]), -5, 99))).toEqual([[1, 2, 3]])
    expect(toArr(copyRange(mono([1, 2, 3]), 2, 0))).toEqual([[1, 2]])
  })
  it('is pure', () => {
    const src = mono([1, 2, 3])
    copyRange(src, 0, 3)
    expect(toArr(src)).toEqual([[1, 2, 3]])
  })
})

describe('cutRange', () => {
  it('removes the range and returns it', () => {
    const { data, removed } = cutRange(mono([1, 2, 3, 4, 5]), 1, 3)
    expect(toArr(data)).toEqual([[1, 4, 5]])
    expect(toArr(removed)).toEqual([[2, 3]])
  })
  it('cuts across all stereo channels', () => {
    const { data } = cutRange(stereo([1, 2, 3, 4], [9, 8, 7, 6]), 1, 3)
    expect(toArr(data)).toEqual([[1, 4], [9, 6]])
  })
  it('zero-length cut is a no-op', () => {
    const { data, removed } = cutRange(mono([1, 2, 3]), 1, 1)
    expect(toArr(data)).toEqual([[1, 2, 3]])
    expect(framesOf(removed)).toBe(0)
  })
  it('cutting everything leaves 1 silent frame', () => {
    const { data } = cutRange(mono([1, 2, 3]), 0, 3)
    expect(toArr(data)).toEqual([[0]])
  })
})

describe('insertAt', () => {
  it('shifts content right and always grows', () => {
    expect(toArr(insertAt(mono([1, 2, 3]), 1, mono([9, 9])))).toEqual([[1, 9, 9, 2, 3]])
  })
  it('inserts at end and at 0', () => {
    expect(toArr(insertAt(mono([1]), 1, mono([2])))).toEqual([[1, 2]])
    expect(toArr(insertAt(mono([1]), 0, mono([2])))).toEqual([[2, 1]])
  })
  it('clamps position beyond end to the end', () => {
    expect(toArr(insertAt(mono([1, 2]), 99, mono([3])))).toEqual([[1, 2, 3]])
  })
  it('adapts mono PB into stereo target by duplication', () => {
    expect(toArr(insertAt(stereo([1], [2]), 1, mono([7])))).toEqual([[1, 7], [2, 7]])
  })
})

describe('pasteAt', () => {
  it('overwrites in place without growing when it fits', () => {
    expect(toArr(pasteAt(mono([1, 2, 3, 4]), 1, mono([9, 9])))).toEqual([[1, 9, 9, 4]])
  })
  it('extends the sample when PB runs past the end', () => {
    expect(toArr(pasteAt(mono([1, 2]), 1, mono([9, 9, 9])))).toEqual([[1, 9, 9, 9]])
  })
  it('adapts stereo PB into mono target by half-sum', () => {
    expect(toArr(pasteAt(mono([0, 0, 0]), 0, stereo([1, 0.5], [-1, -0.5])))).toEqual([[0, 0, 0]])
  })
})

describe('replaceRange', () => {
  it('cuts the selection and inserts PB', () => {
    expect(toArr(replaceRange(mono([1, 2, 3, 4, 5]), 1, 3, mono([9, 9, 9, 9])))).toEqual([[1, 9, 9, 9, 9, 4, 5]])
  })
  it('can shrink with a shorter PB', () => {
    expect(toArr(replaceRange(mono([1, 2, 3, 4, 5]), 1, 3, mono([9])))).toEqual([[1, 9, 4, 5]])
  })
  it('replacing everything leaves 1 silent frame when PB is empty', () => {
    expect(toArr(replaceRange(mono([1, 2]), 0, 2, mono([])))).toEqual([[0]])
  })
})

describe('reverseRange', () => {
  it('inverts the selection over the time axis', () => {
    expect(toArr(reverseRange(mono([1, 2, 3, 4, 5]), 1, 4))).toEqual([[1, 4, 3, 2, 5]])
  })
  it('is idempotent', () => {
    const once = reverseRange(mono([1, 2, 3, 4]), 0, 4)
    expect(toArr(reverseRange(once, 0, 4))).toEqual([[1, 2, 3, 4]])
  })
  it('reverses each stereo channel independently', () => {
    expect(toArr(reverseRange(stereo([1, 2, 3], [4, 5, 6]), 0, 3))).toEqual([[3, 2, 1], [6, 5, 4]])
  })
})

describe('gainRange', () => {
  it('scales by a linear gain', () => {
    const out = gainRange(mono([0.5, 0.5, 0.5]), 1, 2, 0.5)
    expect(out[0][0]).toBe(0.5) // outside range untouched
    expect(out[0][1]).toBeCloseTo(0.25)
    expect(out[0][2]).toBe(0.5)
  })
  it('clamps amplified values to [-1, 1]', () => {
    const out = gainRange(mono([0.8]), 0, 1, 10)
    expect(out[0][0]).toBe(1)
  })
})

describe('fadeRange', () => {
  it('ramps linearly from to', () => {
    const src = mono([1, 1, 1, 1, 1])
    const out = fadeRange(src, 1, 4, 1, 0)
    expect(out[0][0]).toBe(1)
    expect(out[0][1]).toBeCloseTo(1)
    expect(out[0][2]).toBeCloseTo(0.5)
    expect(out[0][3]).toBeCloseTo(0)
    expect(out[0][4]).toBe(1)
  })
  it('handles a single-frame selection', () => {
    const out = fadeRange(mono([0.5]), 0, 1, 0.2, 0.8)
    expect(out[0][0]).toBeCloseTo(0.5 * 0.2)
  })
})

describe('adaptChannels', () => {
  it('passes matching counts through unchanged', () => {
    const pb = stereo([1], [2])
    expect(adaptChannels(pb, 2)).toBe(pb)
  })
  it('duplicates mono into stereo', () => {
    const out = adaptChannels(mono([0.25]), 2)
    expect(toArr(out)).toEqual([[0.25], [0.25]])
  })
  it('mixes stereo down to mono', () => {
    const out = adaptChannels(stereo([1], [-1]), 1)
    expect(out[0][0]).toBeCloseTo(0)
  })
  it('empty PB stays empty (channels duplicated)', () => {
    expect(toArr(adaptChannels(mono([]), 2))).toEqual([[], []])
  })
})

describe('framesOf', () => {
  it('reads the first channel length', () => {
    expect(framesOf(mono([1, 2]))).toBe(2)
    expect(framesOf([])).toBe(0)
  })
})

const sine = (frames: number, period: number, amp = 0.5, phase = 0) =>
  Float32Array.from({ length: frames }, (_, i) => amp * Math.sin(2 * Math.PI * i / period + phase))

describe('trim, silence, normalize and DC', () => {
  it('keeps only the range when trimming, never leaving nothing', () => {
    expect(toArr(trimToRange(mono([1, 2, 3, 4]), 1, 3))).toEqual([[2, 3]])
    expect(toArr(trimToRange(mono([1, 2]), 1, 1))).toEqual([[0]])
  })
  it('silences a range', () => {
    expect(toArr(silenceRange(mono([0.5, 0.5, 0.5]), 1, 2))).toEqual([[0.5, 0, 0.5]])
  })
  it('normalizes a range to its loudest frame across channels', () => {
    const out = normalizeRange(stereo([0.1, 0.25], [-0.5, 0.2]), 0, 2)
    expect(toArr(out).map((c) => c.map((v) => +v.toFixed(3)))).toEqual([[0.2, 0.5], [-1, 0.4]])
    const silent = mono([0, 0])
    expect(normalizeRange(silent, 0, 2)).toBe(silent)
  })
  it('removes each channel\'s offset within the range', () => {
    expect(toArr(removeDcRange(stereo([0.6, 0.4], [0, 0]), 0, 2)).map((c) => c.map((v) => +v.toFixed(3)))).toEqual([[0.1, -0.1], [0, 0]])
  })
})

describe('nearestZeroCrossing', () => {
  it('finds the closest rising crossing on the mono mix', () => {
    const data = [sine(400, 100, 0.5, 0.01)]
    expect(nearestZeroCrossing(data, 95)).toBe(100)
    expect(nearestZeroCrossing(data, 140)).toBe(100)
    expect(nearestZeroCrossing(data, 160)).toBe(200)
  })
  it('stays put when there is no crossing in reach', () => {
    expect(nearestZeroCrossing(mono([0.5, 0.5, 0.5, 0.5]), 2)).toBe(2)
  })
})

describe('resampling', () => {
  it('stretches to the requested length and keeps the waveform', () => {
    const out = resampleTo([sine(400, 100)], 800)
    expect(framesOf(out)).toBe(800)
    // A period of 100 becomes 200: compare away from the edges.
    for (const i of [100, 250, 333, 500]) expect(out[0][i]).toBeCloseTo(0.5 * Math.sin(2 * Math.PI * i / 200), 2)
  })
  it('wraps a single cycle around its ends when periodic', () => {
    const out = resampleTo([sine(64, 64)], 256, true)
    for (const i of [0, 1, 255]) expect(out[0][i]).toBeCloseTo(0.5 * Math.sin(2 * Math.PI * i / 256), 2)
  })
  it('filters content above the new Nyquist when shrinking', () => {
    // A period of 3 frames is above Nyquist once halved; it must not alias into the result.
    const out = resampleTo([sine(3000, 3)], 1500)
    const mid = Array.from(out[0].subarray(200, 1300))
    expect(Math.max(...mid.map(Math.abs))).toBeLessThan(0.05)
  })
  it('repitches only the range: an octave up halves it', () => {
    const data = [new Float32Array(100).fill(0.25)]
    const out = repitchRange(data, 20, 60, 12)
    expect(framesOf(out)).toBe(80)
    expect(out[0][0]).toBe(0.25)
    expect(out[0][79]).toBe(0.25)
  })
})

describe('drawLine', () => {
  it('interpolates between the points in either direction and clamps', () => {
    const ch = new Float32Array(6)
    drawLine(ch, 1, 0, 4, 0.75)
    expect(Array.from(ch)).toEqual([0, 0, 0.25, 0.5, 0.75, 0])
    drawLine(ch, 5, 2, 5, 2)
    expect(ch[5]).toBe(1)
    drawLine(ch, 3, -1, 0, -0.25)
    expect(Array.from(ch).slice(0, 4)).toEqual([-0.25, -0.5, -0.75, -1])
  })
  it('ignores the part outside the sample', () => {
    const ch = new Float32Array(3)
    drawLine(ch, -2, 0.5, 10, 0.5)
    expect(Array.from(ch)).toEqual([0.5, 0.5, 0.5])
  })
})
