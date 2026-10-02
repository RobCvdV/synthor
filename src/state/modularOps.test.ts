import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useDocStore } from './docStore'
import { createDefaultDoc, newModularInstrument, newSampleEntity } from '../domain/factory'
import { setActiveParamRefs, type ParamRefRegistry } from '../audio/paramRefs'
import type { ModularInstrument } from '../domain/types'

function resetStore() {
  useDocStore.getState().loadDoc(createDefaultDoc())
}

const doc = () => useDocStore.getState().doc

function setupModular(): ModularInstrument {
  resetStore()
  const inst = newModularInstrument('Test Synth')
  useDocStore.getState().mutate((draft) => {
    draft.entities.instruments[inst.id] = inst
  })
  return inst
}

const getInst = (id: string) => doc().entities.instruments[id] as ModularInstrument

describe('modularOps', () => {
  beforeEach(() => resetStore())

  it('addModule rejects singletons and adds other types', () => {
    const inst = setupModular()
    const store = useDocStore.getState()
    const pastBefore = useDocStore.getState().past.length
    store.addModule(inst.id, 'output', { x: 0, y: 0 }) // singleton → no-op
    expect(useDocStore.getState().past.length).toBe(pastBefore)

    store.addModule(inst.id, 'noise', { x: 100, y: 100 })
    const fresh = getInst(inst.id)
    expect(Object.values(fresh.modules).some((m) => m.type === 'noise')).toBe(true)
  })

  it('removeModule deletes the module and its incident connections', () => {
    const inst = setupModular()
    const filter = Object.values(inst.modules).find((m) => m.type === 'filter')!
    const connCountBefore = Object.keys(getInst(inst.id).connections).length

    useDocStore.getState().removeModule(inst.id, filter.id)
    const fresh = getInst(inst.id)
    expect(fresh.modules[filter.id]).toBeUndefined()
    expect(Object.keys(fresh.connections).length).toBeLessThan(connCountBefore) // osc→filter and filter→gain gone
  })

  it('removeModule refuses to delete source singletons', () => {
    const inst = setupModular()
    const note = Object.values(inst.modules).find((m) => m.type === 'note')!
    const pastBefore = useDocStore.getState().past.length
    useDocStore.getState().removeModule(inst.id, note.id)
    expect(useDocStore.getState().past.length).toBe(pastBefore)
    expect(getInst(inst.id).modules[note.id]).toBeDefined()
  })

  it('moveModules applies a batch in one undo step', () => {
    const inst = setupModular()
    const [m1, m2] = Object.values(inst.modules).slice(0, 2)
    const pastBefore = useDocStore.getState().past.length
    useDocStore.getState().moveModules(inst.id, [
      { id: m1.id, pos: { x: 10, y: 20 } },
      { id: m2.id, pos: { x: 30, y: 40 } },
    ])
    expect(useDocStore.getState().past.length).toBe(pastBefore + 1)
    const fresh = getInst(inst.id)
    expect(fresh.modules[m1.id].pos).toEqual({ x: 10, y: 20 })
    expect(fresh.modules[m2.id].pos).toEqual({ x: 30, y: 40 })
  })

  it('setModuleParam persists and updates the param ref', () => {
    const setValue = vi.fn()
    setActiveParamRefs({ setValue } as unknown as ParamRefRegistry)
    const inst = setupModular()
    const osc = Object.values(inst.modules).find((m) => m.type === 'osc')!
    useDocStore.getState().setModuleParam(inst.id, osc.id, 'waveform', 2)
    expect(getInst(inst.id).modules[osc.id].params.waveform).toBe(2)
    expect(setValue).toHaveBeenCalledWith(`${inst.id}:${osc.id}:waveform`, 2)
  })

  it('setModuleParamSilent persists with silentBatch and updates the ref', () => {
    const setValue = vi.fn()
    setActiveParamRefs({ setValue } as unknown as ParamRefRegistry)
    const inst = setupModular()
    const osc = Object.values(inst.modules).find((m) => m.type === 'osc')!
    const seen: boolean[] = []
    const unsub = useDocStore.subscribe((s) => seen.push(s.silentBatch))

    useDocStore.getState().setModuleParamSilent(inst.id, osc.id, 'gain', 0.6)
    unsub()

    expect(getInst(inst.id).modules[osc.id].params.gain).toBe(0.6)
    expect(setValue).toHaveBeenCalledWith(`${inst.id}:${osc.id}:gain`, 0.6)
    expect(seen).toContain(true)
  })

  describe('addConnection', () => {
    it('rejects cycles without touching existing cords', () => {
      const inst = setupModular()
      const gain = Object.values(inst.modules).find((m) => m.type === 'gain')!
      const filter = Object.values(inst.modules).find((m) => m.type === 'filter')!
      const connCount = Object.keys(getInst(inst.id).connections).length
      const pastBefore = useDocStore.getState().past.length

      useDocStore.getState().addConnection(
        inst.id,
        { moduleId: gain.id, port: 'out' },
        { moduleId: filter.id, port: 'in' },
      )
      expect(Object.keys(getInst(inst.id).connections).length).toBe(connCount)
      expect(useDocStore.getState().past.length).toBe(pastBefore) // no history entry
    })

    it('rejects exact duplicates', () => {
      const inst = setupModular()
      const osc = Object.values(inst.modules).find((m) => m.type === 'osc')!
      const filter = Object.values(inst.modules).find((m) => m.type === 'filter')!
      const connCount = Object.keys(getInst(inst.id).connections).length

      useDocStore.getState().addConnection(
        inst.id,
        { moduleId: osc.id, port: 'out' },
        { moduleId: filter.id, port: 'in' },
      )
      expect(Object.keys(getInst(inst.id).connections).length).toBe(connCount)
    })

    it('replaces the existing feeder per inlet unless stacked', () => {
      const inst = setupModular()
      const osc = Object.values(inst.modules).find((m) => m.type === 'osc')!
      const adsr = Object.values(inst.modules).find((m) => m.type === 'adsr')!
      const gain = Object.values(inst.modules).find((m) => m.type === 'gain')!

      const feeders = () => Object.values(getInst(inst.id).connections).filter((c) => c.to.moduleId === gain.id && c.to.port === 'mod')

      useDocStore.getState().addConnection(
        inst.id,
        { moduleId: osc.id, port: 'out' },
        { moduleId: gain.id, port: 'mod' },
      )
      expect(feeders()).toHaveLength(1)
      expect(feeders()[0].from.moduleId).toBe(osc.id) // adsr cord replaced

      useDocStore.getState().addConnection(
        inst.id,
        { moduleId: adsr.id, port: 'env' },
        { moduleId: gain.id, port: 'mod' },
        true,
      )
      expect(feeders()).toHaveLength(2) // stacked
    })

    it('ignores unknown modules', () => {
      const inst = setupModular()
      const pastBefore = useDocStore.getState().past.length
      useDocStore.getState().addConnection(
        inst.id,
        { moduleId: 'nope', port: 'out' },
        { moduleId: inst.outputId, port: 'inL' },
      )
      expect(useDocStore.getState().past.length).toBe(pastBefore)
    })
  })

  it('removeConnection and setConnectionGain edit the connection', () => {
    const inst = setupModular()
    const conn = Object.values(getInst(inst.id).connections)[0]
    useDocStore.getState().setConnectionGain(inst.id, conn.id, 0.5)
    expect(getInst(inst.id).connections[conn.id].gain).toBe(0.5)
    useDocStore.getState().removeConnection(inst.id, conn.id)
    expect(getInst(inst.id).connections[conn.id]).toBeUndefined()
  })

  afterEach(() => {
    setActiveParamRefs(null)
  })

  it('addModule points sample modules at the first eligible sample', () => {
    const inst = setupModular()
    const store = useDocStore.getState()
    store.addSampleEntity(newSampleEntity('Zap', 'h-zap', 'zap.wav', 48000, 1, 48000 * 2))
    store.addSampleEntity(newSampleEntity('Blip', 'h-blip', 'blip.wav', 48000, 1, 256))
    const ids = Object.fromEntries(Object.values(doc().entities.samples).map((smp) => [smp.name, smp.id]))

    store.addModule(inst.id, 'sample', { x: 0, y: 0 })
    store.addModule(inst.id, 'osc', { x: 0, y: 0 })
    const mods = Object.values(getInst(inst.id).modules)
    expect(mods.find((m) => m.type === 'sample')?.sampleId).toBe(ids.Blip)
    expect(mods.find((m) => m.type === 'osc')?.sampleId).toBeUndefined()
  })

  it('setModuleSample repoints a module, ignoring unknown samples', () => {
    const inst = setupModular()
    const store = useDocStore.getState()
    store.addSampleEntity(newSampleEntity('Kick', 'h-kick', 'kick.wav', 48000, 1, 480))
    const kick = Object.values(doc().entities.samples)[0].id
    store.addModule(inst.id, 'sample', { x: 0, y: 0 })
    const modId = Object.values(getInst(inst.id).modules).find((m) => m.type === 'sample')!.id

    store.addSampleEntity(newSampleEntity('Snare', 'h-snare', 'snare.wav', 48000, 1, 480))
    const snare = Object.values(doc().entities.samples).find((smp) => smp.name === 'Snare')!.id
    expect(getInst(inst.id).modules[modId].sampleId).toBe(kick)
    store.setModuleSample(inst.id, modId, snare)
    expect(getInst(inst.id).modules[modId].sampleId).toBe(snare)
    store.setModuleSample(inst.id, modId, 'nope')
    expect(getInst(inst.id).modules[modId].sampleId).toBe(snare)
  })
})
