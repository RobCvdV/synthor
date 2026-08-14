import { describe, expect, it } from 'vitest'
import {
  adaptChannels, copyRange, cutRange, fadeRange, framesOf,
  gainRange, insertAt, pasteAt, replaceRange, reverseRange,
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
