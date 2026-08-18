import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useDocStore } from './docStore'
import { createDefaultDoc } from '../domain/factory'
import { setActiveParamRefs, type ParamRefRegistry } from '../audio/paramRefs'
import { MASTER_CHANNEL_ID } from '../domain/types'

function resetStore() {
  useDocStore.getState().loadDoc(createDefaultDoc())
}

const doc = () => useDocStore.getState().doc
const firstInstId = () => {
  const d = doc()
  const tid = d.entities.patterns[d.patternId].trackIds[0]
  return d.entities.tracks[tid].instrumentId
}

describe('mixerOps', () => {
  beforeEach(() => resetStore())

  it('addChannel returns the id; renameChannel renames it', () => {
    const store = useDocStore.getState()
    const id = store.addChannel('sub')
    expect(doc().entities.mixChannels[id]).toBeDefined()
    store.renameChannel(id, 'Drums')
    expect(doc().entities.mixChannels[id].name).toBe('Drums')
  })

  it('removeChannel reroutes its instruments back to master', () => {
    const store = useDocStore.getState()
    const sub = store.addChannel('sub')
    const instId = firstInstId()
    store.setInstrumentChannelId(instId, sub)
    expect(doc().entities.instruments[instId].channelId).toBe(sub)

    store.removeChannel(sub)
    expect(doc().entities.mixChannels[sub]).toBeUndefined()
    expect(doc().entities.instruments[instId].channelId).toBe(MASTER_CHANNEL_ID)
  })

  it('removeChannel refuses to delete the master channel', () => {
    const store = useDocStore.getState()
    const pastBefore = store.past.length
    store.removeChannel(MASTER_CHANNEL_ID)
    expect(store.past.length).toBe(pastBefore)
    expect(doc().entities.mixChannels[MASTER_CHANNEL_ID]).toBeDefined()
  })

  it('setChannelVolume/Pan/Mute/Solo update the channel', () => {
    const store = useDocStore.getState()
    const chan = doc().entities.mixChannels[MASTER_CHANNEL_ID]
    store.setChannelVolume(chan.id, 0.5)
    store.setChannelPan(chan.id, -0.3)
    store.setChannelMute(chan.id, true)
    store.setChannelSolo(chan.id, true)
    const fresh = doc().entities.mixChannels[chan.id]
    expect(fresh.volume).toBe(0.5)
    expect(fresh.pan).toBe(-0.3)
    expect(fresh.mute).toBe(true)
    expect(fresh.solo).toBe(true)
  })

  it('addChannelEffect creates one instance for stereo, L+R for mono', () => {
    const store = useDocStore.getState()
    const stereoId = store.addChannelEffect(MASTER_CHANNEL_ID, 'reverb')
    expect(doc().entities.mixChannels[MASTER_CHANNEL_ID].effects).toHaveLength(1)
    expect(stereoId).toBe(doc().entities.mixChannels[MASTER_CHANNEL_ID].effects[0].id)

    const monoId = store.addChannelEffect(MASTER_CHANNEL_ID, 'filter')
    const fx = doc().entities.mixChannels[MASTER_CHANNEL_ID].effects
    expect(fx).toHaveLength(3)
    expect(monoId).toBe(fx[1].id) // returns efL
    expect(fx[1].side).toBe('L')
    expect(fx[2].side).toBe('R')
  })

  it('removeChannelEffect and moveChannelEffect reorder the chain', () => {
    const store = useDocStore.getState()
    const a = store.addChannelEffect(MASTER_CHANNEL_ID, 'reverb')
    const b = store.addChannelEffect(MASTER_CHANNEL_ID, 'delay')
    store.moveChannelEffect(MASTER_CHANNEL_ID, a, 1)
    expect(doc().entities.mixChannels[MASTER_CHANNEL_ID].effects.map((e) => e.id)).toEqual([b, a])

    store.removeChannelEffect(MASTER_CHANNEL_ID, a)
    expect(doc().entities.mixChannels[MASTER_CHANNEL_ID].effects.map((e) => e.id)).toEqual([b])
  })

  it('setChannelEffectParam writes the effect param', () => {
    const store = useDocStore.getState()
    const fxId = store.addChannelEffect(MASTER_CHANNEL_ID, 'reverb')
    store.setChannelEffectParam(MASTER_CHANNEL_ID, fxId, 'mix', 0.4)
    const fx = doc().entities.mixChannels[MASTER_CHANNEL_ID].effects.find((e) => e.id === fxId)!
    expect(fx.params.mix).toBe(0.4)
  })

  it('hide/show/reorderMixerInstrument manage the mixer order', () => {
    const store = useDocStore.getState()
    const instId = firstInstId()
    store.hideInstrumentFromMixer(instId)
    expect(doc().entities.mixerInstrumentOrder).not.toContain(instId)
    store.showInstrumentInMixer(instId)
    expect(doc().entities.mixerInstrumentOrder).toContain(instId)

    const other = store.addInstrument('modular')
    const orderBefore = [...doc().entities.mixerInstrumentOrder]
    store.reorderMixerInstrument(other, 0)
    expect(doc().entities.mixerInstrumentOrder[0]).toBe(other)
    expect(doc().entities.mixerInstrumentOrder).toHaveLength(orderBefore.length)
  })

  it('setInstrumentChannelId guards unknown channels', () => {
    const store = useDocStore.getState()
    const instId = firstInstId()
    const pastBefore = store.past.length
    store.setInstrumentChannelId(instId, 'nope')
    expect(store.past.length).toBe(pastBefore)
  })

  it('setInstrumentPan persists', () => {
    const store = useDocStore.getState()
    const instId = firstInstId()
    store.setInstrumentPan(instId, 0.3)
    expect(doc().entities.instruments[instId].pan).toBe(0.3)
  })

  it('*Silent actions persist with silentBatch and update the refs', () => {
    const setValue = vi.fn()
    setActiveParamRefs({ setValue } as unknown as ParamRefRegistry)
    const store = useDocStore.getState()
    const instId = firstInstId()
    const chanId = MASTER_CHANNEL_ID
    const fxId = store.addChannelEffect(chanId, 'reverb')
    const seen: boolean[] = []
    const unsub = useDocStore.subscribe((s) => seen.push(s.silentBatch))

    store.setInstrumentPanSilent(instId, 0.2)
    store.setChannelVolumeSilent(chanId, 0.8)
    store.setChannelPanSilent(chanId, -0.1)
    store.setChannelEffectParamSilent(chanId, fxId, 'mix', 0.3)
    unsub()

    expect(doc().entities.instruments[instId].pan).toBe(0.2)
    expect(doc().entities.mixChannels[chanId].volume).toBe(0.8)
    expect(doc().entities.mixChannels[chanId].pan).toBe(-0.1)
    const fx = doc().entities.mixChannels[chanId].effects.find((e) => e.id === fxId)!
    expect(fx.params.mix).toBe(0.3)
    expect(setValue).toHaveBeenCalledWith(`inst:${instId}:pan`, 0.2)
    expect(setValue).toHaveBeenCalledWith(`chan:${chanId}:volume`, 0.8)
    expect(setValue).toHaveBeenCalledWith(`chan:${chanId}:pan`, -0.1)
    expect(setValue).toHaveBeenCalledWith(`chan:${chanId}:${fxId}:mix`, 0.3)
    expect(seen).toContain(true)
  })

  afterEach(() => {
    setActiveParamRefs(null)
  })
})
