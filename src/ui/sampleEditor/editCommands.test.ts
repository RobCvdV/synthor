import { describe, expect, it } from 'vitest'
import type { PcmData } from '../../audio/sampleEdit'
import {
  copySelection, cutSelection, fadeSelection, gainSelection, normalizeSelection, pasteClip, removeDcSelection,
  repitchSelection, replaceSelection, reverseSelection, silenceSelection, snapSelection, trimSelection,
} from './editCommands'

const pcm = (...v: number[]): PcmData => [new Float32Array(v)]
const values = (d: PcmData) => Array.from(d[0])

describe('editCommands', () => {
  const base = { pcm: pcm(1, 2, 3, 4, 5), sel: { start: 1, end: 3 }, cursor: 1 }

  it('copies and cuts the selection, leaving the cursor at its start', () => {
    expect(values(copySelection(base)!)).toEqual([2, 3])
    const cut = cutSelection(base)!
    expect(values(cut.pcm)).toEqual([1, 4, 5])
    expect(values(cut.removed)).toEqual([2, 3])
    expect(cut).toMatchObject({ sel: null, cursor: 1 })
  })

  it('pastes at the cursor and selects what was pasted', () => {
    const over = pasteClip({ ...base, cursor: 3 }, pcm(9, 9), 'overwrite')
    expect(values(over.pcm)).toEqual([1, 2, 3, 9, 9])
    expect(over.sel).toEqual({ start: 3, end: 5 })
    const ins = pasteClip({ ...base, cursor: 3 }, pcm(9, 9), 'insert')
    expect(values(ins.pcm)).toEqual([1, 2, 3, 9, 9, 4, 5])
  })

  it('replaces the selection with the clip', () => {
    const r = replaceSelection(base, pcm(7))!
    expect(values(r.pcm)).toEqual([1, 7, 4, 5])
    expect(r).toMatchObject({ cursor: 1, sel: { start: 1, end: 2 } })
  })

  it('reverses, scales and fades only the selection', () => {
    expect(values(reverseSelection(base)!.pcm)).toEqual([1, 3, 2, 4, 5])
    const quiet = { ...base, pcm: pcm(0.5, 0.5, 0.25, 0.5, 0.5) }
    expect(values(gainSelection(quiet, 50)!.pcm)).toEqual([0.5, 0.25, 0.125, 0.5, 0.5])
    expect(values(fadeSelection(base, 0, 100)!.pcm)[1]).toBe(0)
  })

  it('does nothing without a selection', () => {
    const none = { ...base, sel: null }
    expect([copySelection(none), cutSelection(none), replaceSelection(none, pcm(1)), reverseSelection(none),
      gainSelection(none, 50), fadeSelection(none, 0, 100)]).toEqual([null, null, null, null, null, null])
  })
})

describe('processing commands', () => {
  const base = { pcm: pcm(0.1, 0.2, 0.4, 0.1), sel: { start: 1, end: 3 }, cursor: 1 }
  const rounded = (d: PcmData) => values(d).map((v) => +v.toFixed(3))

  it('trims to the selection and silences it', () => {
    expect(trimSelection(base)).toEqual({ pcm: [new Float32Array([0.2, 0.4])], sel: null, cursor: 0 })
    expect(trimSelection({ ...base, sel: null })).toBeNull()
    expect(rounded(silenceSelection(base)!.pcm)).toEqual([0.1, 0, 0, 0.1])
  })

  it('normalizes and removes DC on the selection, or on everything without one', () => {
    expect(rounded(normalizeSelection(base).pcm)).toEqual([0.1, 0.5, 1, 0.1])
    expect(rounded(normalizeSelection({ ...base, sel: null }).pcm)).toEqual([0.25, 0.5, 1, 0.25])
    expect(rounded(removeDcSelection(base).pcm)).toEqual([0.1, -0.1, 0.1, 0.1])
  })

  it('keeps the repitched range selected', () => {
    const long = { pcm: [new Float32Array(100)], sel: { start: 10, end: 50 }, cursor: 10 }
    const up = repitchSelection(long, 12)
    expect(up.pcm[0].length).toBe(80)
    expect(up.sel).toEqual({ start: 10, end: 30 })
  })

  it('snaps the selection to rising zero crossings', () => {
    const wave = [Float32Array.from({ length: 400 }, (_, i) => Math.sin(2 * Math.PI * i / 100 + 0.01))]
    expect(snapSelection({ pcm: wave, sel: { start: 90, end: 310 }, cursor: null })).toEqual({ start: 100, end: 300 })
  })
})
