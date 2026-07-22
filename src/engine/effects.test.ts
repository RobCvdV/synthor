import { describe, expect, it } from 'vitest'
import { buildEffectSignals, panGains } from '../engine/effects'
import { Eff, packEffect } from '../domain/effects'

describe('panGains', () => {
  it('returns equal gains for center pan', () => {
    const { left, right } = panGains(0.5)
    expect(left).toBeCloseTo(Math.SQRT1_2)
    expect(right).toBeCloseTo(Math.SQRT1_2)
  })

  it('returns full left for pan=0', () => {
    const { left, right } = panGains(0)
    expect(left).toBeCloseTo(1)
    expect(right).toBeCloseTo(0)
  })

  it('returns full right for pan=1', () => {
    const { left, right } = panGains(1)
    expect(left).toBeCloseTo(0)
    expect(right).toBeCloseTo(1)
  })
})

describe('buildEffectSignals', () => {
  it('returns identity signals for empty effect sequence', () => {
    const { freqMul, volMod, pan, breakRow } = buildEffectSignals([null, null, null], 3)
    expect(freqMul).toEqual([1, 1, 1])
    expect(volMod).toEqual([1, 1, 1])
    expect(pan).toEqual([null, null, null])
    expect(breakRow).toEqual([null, null, null])
  })

  it('portamento up accumulates pitch offset across consecutive effect rows', () => {
    // speed 16 = 1 semitone per row, effect on both rows
    const seq = [packEffect(Eff.PortaUp, 0x10), packEffect(Eff.PortaUp, 0x10)]
    const { freqMul } = buildEffectSignals(seq, 2)
    // Row 0: offset = 1 semitone → 2^(1/12) ≈ 1.059
    expect(freqMul[0]).toBeCloseTo(Math.pow(2, 1 / 12))
    // Row 1: offset = 2 semitones → 2^(2/12) ≈ 1.122
    expect(freqMul[1]).toBeCloseTo(Math.pow(2, 2 / 12))
  })

  it('portamento down accumulates negative pitch offset', () => {
    // speed 16 = 1 semitone, effect on row 0 only
    const seq = [packEffect(Eff.PortaDown, 0x10), null]
    const { freqMul } = buildEffectSignals(seq, 2)
    expect(freqMul[0]).toBeCloseTo(Math.pow(2, -1 / 12))
    // Row 1: no effect → freqMul stays at identity (the offset persists in portaOffset but isn't applied here)
    expect(freqMul[1]).toBe(1)
  })

  it('arpeggio cycles through 3 notes per row', () => {
    const seq = [
      packEffect(Eff.Arpeggio, 0x47), // +4, +7 semitones
      packEffect(Eff.Arpeggio, 0x47),
      packEffect(Eff.Arpeggio, 0x47),
    ]
    const { freqMul } = buildEffectSignals(seq, 3)
    // Row 0: base (cycle pos 0)
    expect(freqMul[0]).toBeCloseTo(1) // no change = 2^(0/12)
    // Row 1: base + 4 semitones (cycle pos 1)
    expect(freqMul[1]).toBeCloseTo(Math.pow(2, 4 / 12))
    // Row 2: base + 7 semitones (cycle pos 2)
    expect(freqMul[2]).toBeCloseTo(Math.pow(2, 7 / 12))
  })

  it('set panning maps to 0..1', () => {
    const seq = [
      packEffect(Eff.SetPanning, 0x00),  // full left
      packEffect(Eff.SetPanning, 0x80),  // center
      packEffect(Eff.SetPanning, 0xFF),  // full right
    ]
    const { pan } = buildEffectSignals(seq, 3)
    expect(pan[0]).toBeCloseTo(0)
    expect(pan[1]).toBeCloseTo(128 / 255)
    expect(pan[2]).toBeCloseTo(1)
  })

  it('volume slide x slides up', () => {
    const seq = [
      packEffect(Eff.VolumeSlide, 0x80), // x=8, y=0 → +8/64
      packEffect(Eff.VolumeSlide, 0x80),
    ]
    const { volMod } = buildEffectSignals(seq, 2)
    // Row 0: 1 + 8/64 = 1.125, clamped to 1.0
    expect(volMod[0]).toBe(1)
    // Row 1: 1 + 16/64 = 1.25, clamped to 1.0
    expect(volMod[1]).toBe(1)
  })

  it('volume slide y slides down', () => {
    const seq = [
      packEffect(Eff.VolumeSlide, 0x08), // x=0, y=8 → -8/64
      packEffect(Eff.VolumeSlide, 0x08),
    ]
    const { volMod } = buildEffectSignals(seq, 2)
    // Row 0: 1 - 8/64 = 0.875
    expect(volMod[0]).toBeCloseTo(0.875)
    // Row 1: 1 - 16/64 = 0.75
    expect(volMod[1]).toBeCloseTo(0.75)
  })

  it('volume slide stays in [0, 1] range', () => {
    const seq = new Array(100).fill(packEffect(Eff.VolumeSlide, 0xF0)) // max up
    const { volMod } = buildEffectSignals(seq, 100)
    for (const v of volMod) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('pattern break stores the target row', () => {
    const seq = [null, packEffect(Eff.PatternBreak, 0x10), null] // break to row 16
    const { breakRow } = buildEffectSignals(seq, 3)
    expect(breakRow[1]).toBe(0x10)
    expect(breakRow[0]).toBeNull()
    expect(breakRow[2]).toBeNull()
  })

  it('vibrato modulates frequency at non-zero phase positions', () => {
    // Use 8 rows, speed 3 to get non-zero phase at row 1.
    const seq = new Array(8).fill(packEffect(Eff.Vibrato, 0x33)) // speed 3, depth 3
    const { freqMul } = buildEffectSignals(seq, 8)
    // Row 0: phase = 0 → sin=0 → no modulation
    expect(freqMul[0]).toBe(1)
    // Row 1: phase = (1*3)/8*2π = 0.75π → sin(0.75π) ≈ 0.707 → modulation applied
    expect(freqMul[1]).not.toBe(1)
    // Row 3: phase = (3*3)/8*2π = 2.25π ≡ 0.25π → sin ≈ 0.707 → modulation applied
    expect(freqMul[3]).not.toBe(1)
  })

  it('tremolo modulates volume with sine', () => {
    const seq = [packEffect(Eff.Tremolo, 0x44), null] // speed 4, depth 4
    const { volMod } = buildEffectSignals(seq, 2)
    // Row 0: tremolo applied — volMod should vary
    expect(volMod[0]).toBeLessThan(1)
    // Row 1: no tremolo — identity
    expect(volMod[1]).toBe(1)
  })

  it('unknown effect types are silently ignored', () => {
    const seq = [0xE42] // type 0xE is not a known effect
    const { freqMul, volMod, pan, breakRow } = buildEffectSignals(seq, 1)
    expect(freqMul[0]).toBe(1)
    expect(volMod[0]).toBe(1)
    expect(pan[0]).toBeNull()
    expect(breakRow[0]).toBeNull()
  })
})
