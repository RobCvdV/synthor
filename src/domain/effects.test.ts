import { describe, expect, it } from 'vitest'
import {
  BUILTIN_LANE_TYPES, effInletNames, interpolateValues, isBuiltinLaneType, LANE_DEFS, parseHex, readableLaneLabel, valueHex,
} from '../domain/effects'
import { newDrumKitInstrument, newModularInstrument } from '../domain/factory'
import type { Module } from '../domain/types'

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

describe('effInletNames', () => {
  it('returns the names of eff modules on a modular instrument', () => {
    const inst = newModularInstrument('Patch')
    expect(effInletNames(inst)).toEqual(['Eff In 01', 'Eff In 02'])
  })

  it('returns [] for non-modular instruments', () => {
    expect(effInletNames(newDrumKitInstrument('Kit'))).toEqual([])
    expect(effInletNames(undefined)).toEqual([])
  })

  it('excludes unnamed eff modules and collapses duplicate names', () => {
    const inst = newModularInstrument('Patch')
    const unnamed: Module = { id: 'mod_u', type: 'eff', params: { cc: 0 }, pos: { x: 0, y: 0 } }
    const dupe: Module = { id: 'mod_d', type: 'eff', params: { cc: 0 }, pos: { x: 0, y: 0 }, name: 'Eff In 01' }
    inst.modules[unnamed.id] = unnamed
    inst.modules[dupe.id] = dupe
    // Unnamed module dropped; the second "Eff In 01" doesn't appear twice.
    expect(effInletNames(inst)).toEqual(['Eff In 01', 'Eff In 02'])
  })
})

describe('parseHex', () => {
  it('parses one or two hex digits into 0..1', () => {
    expect(parseHex('FF')).toBe(1)
    expect(parseHex(' 0 ')).toBe(0)
    expect(parseHex('80')).toBe(128 / 255)
    expect(parseHex('a')).toBe(10 / 255)
  })

  it('rejects anything else', () => {
    for (const s of ['', 'G0', '100', '-1', '1.5']) expect(parseHex(s)).toBeNull()
  })
})

describe('interpolateValues', () => {
  it('ramps linearly, snapped to whole bytes', () => {
    expect(interpolateValues(0, 1, 4).map((v) => valueHex(v))).toEqual(['00', '55', 'AA', 'FF'])
    expect(interpolateValues(1, 0, 3).map((v) => valueHex(v))).toEqual(['FF', '80', '00'])
  })

  it('handles degenerate counts', () => {
    expect(interpolateValues(0.5, 1, 1)).toEqual([0.5])
    expect(interpolateValues(0, 1, 0)).toEqual([])
  })
})
