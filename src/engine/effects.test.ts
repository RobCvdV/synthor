import { describe, expect, it } from 'vitest'
import { buildEffectSignals, panGains } from '../engine/effects'
import type { EffectLaneDef } from '../domain/types'

describe('buildEffectSignals', () => {
  it('returns identity signals for empty lanes', () => {
    const sigs = buildEffectSignals({}, [], 4)
    expect(sigs.freqMul).toEqual([1, 1, 1, 1])
    expect(sigs.volMod).toEqual([1, 1, 1, 1])
    expect(sigs.pan).toEqual([0.5, 0.5, 0.5, 0.5])
  })

  it('panning lane sets pan values', () => {
    const lanes: EffectLaneDef[] = [{ id: 'l1', type: 'panning' }]
    const seqs = { l1: [0, 0.5, 1, 0.25] }
    const sigs = buildEffectSignals(seqs, lanes, 4)
    expect(sigs.pan).toEqual([0, 0.5, 1, 0.25])
  })

  it('ignores named inlet lanes', () => {
    const lanes: EffectLaneDef[] = [{ id: 'l1', type: 'My Inlet' }]
    const seqs = { l1: [0.3, 0.7, 0, 0.9] }
    const sigs = buildEffectSignals(seqs, lanes, 4)
    // Named inlets don't affect freq/vol/pan — they pass through unchanged.
    expect(sigs.freqMul).toEqual([1, 1, 1, 1])
    expect(sigs.volMod).toEqual([1, 1, 1, 1])
    expect(sigs.pan).toEqual([0.5, 0.5, 0.5, 0.5])
  })
})

describe('panGains', () => {
  it('returns left=1,right=0 at pan=0', () => {
    const { left, right } = panGains(0)
    expect(left).toBeCloseTo(1, 5)
    expect(right).toBeCloseTo(0, 5)
  })

  it('returns equal gains at pan=0.5', () => {
    const { left, right } = panGains(0.5)
    expect(left).toBeCloseTo(right, 5)
  })
})
