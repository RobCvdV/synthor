import { describe, expect, it } from 'vitest'
import { BUILTIN_LANE_TYPES, isBuiltinLaneType, LANE_DEFS, readableLaneLabel, valueHex } from '../domain/effects'

describe('LANE_DEFS', () => {
  it('has entries for all built-in lane types', () => {
    for (const type of BUILTIN_LANE_TYPES) {
      expect(LANE_DEFS[type]).toBeDefined()
      expect(LANE_DEFS[type].label.length).toBeGreaterThan(0)
    }
  })

  it('recognizes built-in types', () => {
    expect(isBuiltinLaneType('vibratoDepth')).toBe(true)
    expect(isBuiltinLaneType('panning')).toBe(true)
    expect(isBuiltinLaneType('nonsense')).toBe(false)
    expect(isBuiltinLaneType('')).toBe(false)
  })

  it('readableLaneLabel returns labels', () => {
    expect(readableLaneLabel('vibratoDepth')).toBe('Vib Depth')
    expect(readableLaneLabel('My Inlet')).toBe('My Inlet')
  })
})

describe('valueHex', () => {
  it('formats values', () => {
    expect(valueHex(null)).toBe('··')
    expect(valueHex(0)).toBe('00')
    expect(valueHex(1)).toBe('FF')
    expect(valueHex(0.5)).toBe('80')
  })
})
