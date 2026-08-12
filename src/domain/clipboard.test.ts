import { describe, expect, it } from 'vitest'
import { newModularInstrument } from './factory'
import { MODULE_DEFS } from './moduleDefs'
import {
  collectClipboardModules,
  collectDeletableIds,
  preparePastedModules,
} from './clipboard'
import type { ModularInstrument } from './types'

/** Return a fresh modular instrument for each test. */
function makeInst(): ModularInstrument {
  return newModularInstrument('Test')
}

/** True when an id belongs to a singleton module in the instrument. */
function isSingleton(inst: ModularInstrument, id: string): boolean {
  const mod = inst.modules[id]
  return mod ? MODULE_DEFS[mod.type].singleton === true : false
}

// ---- collectClipboardModules -------------------------------------------

describe('collectClipboardModules', () => {
  it('returns null for an empty selection', () => {
    const inst = makeInst()
    expect(collectClipboardModules(inst, [])).toBeNull()
  })

  it('collects a single non-singleton module', () => {
    const inst = makeInst()
    // osc is non-singleton
    const oscId = Object.keys(inst.modules).find(
      (id) => inst.modules[id].type === 'osc',
    )!
    const result = collectClipboardModules(inst, [oscId])
    expect(result).not.toBeNull()
    expect(result!.modules).toHaveLength(1)
    expect(result!.modules[0].id).toBe(oscId)
  })

  it('filters out singleton modules', () => {
    const inst = makeInst()
    // note, gate, volume, output are singletons
    const singletons = Object.keys(inst.modules).filter((id) => isSingleton(inst, id))
    expect(singletons.length).toBeGreaterThan(0)

    const result = collectClipboardModules(inst, singletons)
    expect(result).toBeNull()
  })

  it('collects multiple non-singleton modules', () => {
    const inst = makeInst()
    const nonSingletons = Object.keys(inst.modules).filter((id) => !isSingleton(inst, id))
    expect(nonSingletons.length).toBeGreaterThan(1)

    const result = collectClipboardModules(inst, nonSingletons)
    expect(result).not.toBeNull()
    expect(result!.modules).toHaveLength(nonSingletons.length)
  })

  it('collects internal connections between selected modules', () => {
    const inst = makeInst()
    // osc → filter → gain are chained. Grab osc and filter.
    const oscId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'osc')!
    const filterId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'filter')!
    const gainId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'gain')!

    // Select osc + filter only (not gain) — there's osc→filter but no filter→gain
    const result = collectClipboardModules(inst, [oscId, filterId])
    expect(result).not.toBeNull()

    // osc→filter connection should be included (both are selected)
    const hasOscToFilter = result!.connections.some(
      (c) => c.from.moduleId === oscId && c.to.moduleId === filterId,
    )
    expect(hasOscToFilter).toBe(true)

    // filter→gain connection should NOT be included (gain is not selected)
    const hasFilterToGain = result!.connections.some(
      (c) => c.from.moduleId === filterId && c.to.moduleId === gainId,
    )
    expect(hasFilterToGain).toBe(false)
  })

  it('excludes connections where either endpoint is not selected', () => {
    const inst = makeInst()
    // gate→adsr connection: select only gate (singleton) — nothing collected
    const gateId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'gate')!
    // gate is a singleton, so clipboard returns null regardless
    expect(collectClipboardModules(inst, [gateId])).toBeNull()
  })

  it('returns null when only selected module is a singleton', () => {
    const inst = makeInst()
    const outputId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'output')!
    expect(collectClipboardModules(inst, [outputId])).toBeNull()
  })

  it('mixed selection: non-singletons collected, singletons ignored', () => {
    const inst = makeInst()
    const oscId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'osc')!
    const outputId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'output')!

    const result = collectClipboardModules(inst, [oscId, outputId])
    expect(result).not.toBeNull()
    // osc is collected, output is not
    expect(result!.modules).toHaveLength(1)
    expect(result!.modules[0].id).toBe(oscId)
  })
})

// ---- preparePastedModules -----------------------------------------------

describe('preparePastedModules', () => {
  it('generates fresh ids for all modules', () => {
    const inst = makeInst()
    const nonSingletons = Object.keys(inst.modules).filter((id) => !isSingleton(inst, id))
    const clip = collectClipboardModules(inst, nonSingletons)!

    const { modules } = preparePastedModules(clip)

    // Every module id must differ from its source id.
    const sourceIds = new Set(clip.modules.map((m) => m.id))
    for (const m of modules) {
      expect(sourceIds.has(m.id)).toBe(false)
      expect(m.id).toMatch(/^mod_/)
    }
  })

  it('offsets positions by +44 on both axes', () => {
    const inst = makeInst()
    const oscId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'osc')!
    const originalPos = { ...inst.modules[oscId].pos }
    const clip = collectClipboardModules(inst, [oscId])!

    const { modules } = preparePastedModules(clip)

    expect(modules[0].pos).toEqual({
      x: originalPos.x + 44,
      y: originalPos.y + 44,
    })
  })

  it('remaps connection endpoints to new ids', () => {
    const inst = makeInst()
    const oscId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'osc')!
    const filterId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'filter')!
    const clip = collectClipboardModules(inst, [oscId, filterId])!

    const { modules, connections } = preparePastedModules(clip)

    // Build a set of new module ids.
    const newIds = new Set(modules.map((m) => m.id))

    for (const c of connections) {
      // Connection endpoints must reference new module ids, not old ones.
      expect(newIds.has(c.from.moduleId)).toBe(true)
      expect(newIds.has(c.to.moduleId)).toBe(true)
      expect(c.id).toMatch(/^con_/)
    }
  })

  it('preserves module params', () => {
    const inst = makeInst()
    const filterId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'filter')!
    const clip = collectClipboardModules(inst, [filterId])!

    const { modules } = preparePastedModules(clip)

    expect(modules[0].params).toEqual(clip.modules[0].params)
    // Must be a different object (deep-cloned).
    expect(modules[0].params).not.toBe(clip.modules[0].params)
  })

  it('produces independent copies on repeated calls', () => {
    const inst = makeInst()
    const oscId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'osc')!
    const clip = collectClipboardModules(inst, [oscId])!

    const a = preparePastedModules(clip)
    const b = preparePastedModules(clip)

    // Different module ids each time.
    expect(a.modules[0].id).not.toBe(b.modules[0].id)
  })

  it('handles a clip with no connections', () => {
    const inst = makeInst()
    // eff modules have no connections in the default instrument
    const effId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'eff')!
    const clip = collectClipboardModules(inst, [effId])!

    const { modules, connections } = preparePastedModules(clip)

    expect(modules).toHaveLength(1)
    expect(connections).toHaveLength(0)
  })
})

// ---- collectDeletableIds -------------------------------------------------

describe('collectDeletableIds', () => {
  it('returns empty array for a selection of only singletons', () => {
    const inst = makeInst()
    const outputId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'output')!
    const noteId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'note')!

    const ids = collectDeletableIds(inst, [outputId, noteId])
    expect(ids).toHaveLength(0)
  })

  it('returns non-singleton ids from a mixed selection', () => {
    const inst = makeInst()
    const oscId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'osc')!
    const outputId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'output')!

    const ids = collectDeletableIds(inst, [oscId, outputId])
    expect(ids).toEqual([oscId])
  })

  it('returns all selected non-singleton ids', () => {
    const inst = makeInst()
    const nonSingletons = Object.keys(inst.modules).filter((id) => !isSingleton(inst, id))

    const ids = collectDeletableIds(inst, nonSingletons)
    expect(ids.sort()).toEqual(nonSingletons.sort())
  })

  it('returns empty for an empty selection', () => {
    const inst = makeInst()
    expect(collectDeletableIds(inst, [])).toHaveLength(0)
  })
})

// ---- Integration: copy → prepare → paste flow ---------------------------

describe('clipboard round-trip (copy → prepare → paste)', () => {
  it('produces a self-consistent group with remapped connections', () => {
    const inst = makeInst()
    // Select osc + filter: they are connected (osc→filter).
    const oscId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'osc')!
    const filterId = Object.keys(inst.modules).find((id) => inst.modules[id].type === 'filter')!
    const clip = collectClipboardModules(inst, [oscId, filterId])!

    expect(clip).not.toBeNull()
    expect(clip!.modules).toHaveLength(2)
    expect(clip!.connections.length).toBeGreaterThan(0)

    const { modules, connections } = preparePastedModules(clip!)

    // Every connection must reference only the new module ids.
    const newIds = new Set(modules.map((m) => m.id))
    for (const c of connections) {
      expect(newIds.has(c.from.moduleId)).toBe(true)
      expect(newIds.has(c.to.moduleId)).toBe(true)
    }
  })

  it('repeatedly preparing the same clip produces independent groups', () => {
    const inst = makeInst()
    const nonSingletons = Object.keys(inst.modules).filter((id) => !isSingleton(inst, id))
    const clip = collectClipboardModules(inst, nonSingletons)!

    const a = preparePastedModules(clip)
    const b = preparePastedModules(clip)

    const aIds = new Set(a.modules.map((m) => m.id))
    const bIds = new Set(b.modules.map((m) => m.id))

    // No id overlap between the two prepared groups.
    for (const id of aIds) expect(bIds.has(id)).toBe(false)
  })
})
