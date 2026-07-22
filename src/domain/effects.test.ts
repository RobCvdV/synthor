import { describe, expect, it } from 'vitest'
import { effectDisplay, effectOperand, effectType, packEffect, operandXY } from '../domain/effects'
import { Eff } from '../domain/effects'

describe('effect helpers', () => {
  it('packs an effect type + operand into a 12-bit value', () => {
    const packed = packEffect(Eff.PortaUp, 0x08)
    expect(packed).toBe(0x108)
  })

  it('packs arpeggio with xy operand', () => {
    // Arpeggio 0x47: base, +4, +7 semitones
    const packed = packEffect(Eff.Arpeggio, 0x47)
    expect(effectType(packed)).toBe(0x0)
    expect(effectOperand(packed)).toBe(0x47)
  })

  it('unpacks effect type from packed value', () => {
    expect(effectType(0x108)).toBe(0x1) // PortaUp
    expect(effectType(0x2FF)).toBe(0x2) // PortaDown
    expect(effectType(0x880)).toBe(0x8) // SetPanning
    expect(effectType(0xA05)).toBe(0xA) // VolumeSlide
    expect(effectType(0xD00)).toBe(0xD) // PatternBreak
  })

  it('unpacks effect operand from packed value', () => {
    expect(effectOperand(0xA42)).toBe(0x42)
    expect(effectOperand(0x000)).toBe(0x00)
    expect(effectOperand(0x1FF)).toBe(0xFF)
  })

  it('splits operand into x and y nibbles', () => {
    expect(operandXY(0x47)).toEqual({ x: 4, y: 7 })
    expect(operandXY(0x00)).toEqual({ x: 0, y: 0 })
    expect(operandXY(0xFF)).toEqual({ x: 15, y: 15 })
    expect(operandXY(0xA0)).toEqual({ x: 10, y: 0 })
  })

  it('formats effect as 3-char display string', () => {
    expect(effectDisplay(0x108)).toBe('108')
    expect(effectDisplay(0x000)).toBe('000')
    expect(effectDisplay(0xA42)).toBe('A42')
    expect(effectDisplay(0xFFF)).toBe('FFF')
  })
})
