import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CcBindings } from './ccBindings'
import type { ParamRefRegistry } from './paramRefs'

function mockRefs(): ParamRefRegistry {
  const setValue = vi.fn()
  return { setValue } as unknown as ParamRefRegistry
}

describe('CcBindings', () => {
  let bindings: CcBindings
  let refs: ParamRefRegistry

  beforeEach(() => {
    bindings = new CcBindings()
    refs = mockRefs()
  })

  it('registers a CC→ref mapping and updates it', () => {
    bindings.register(7, 'inst:mod:cc')
    bindings.update(7, 64, refs)
    expect(refs.setValue).toHaveBeenCalledWith('inst:mod:cc', 64 / 127)
  })

  it('registers multiple refs for the same CC number', () => {
    bindings.register(7, 'inst:mod1:cc')
    bindings.register(7, 'inst:mod2:cc')
    bindings.update(7, 127, refs)
    expect(refs.setValue).toHaveBeenCalledWith('inst:mod1:cc', 127 / 127)
    expect(refs.setValue).toHaveBeenCalledWith('inst:mod2:cc', 127 / 127)
    expect(refs.setValue).toHaveBeenCalledTimes(2)
  })

  it('skips CC=0 (no CC assigned)', () => {
    bindings.register(0, 'inst:mod:cc')
    bindings.update(0, 64, refs)
    expect(refs.setValue).not.toHaveBeenCalled()
  })

  it('no-ops on update of an unregistered CC', () => {
    bindings.update(99, 64, refs)
    expect(refs.setValue).not.toHaveBeenCalled()
  })

  it('clear discards all registrations', () => {
    bindings.register(7, 'inst:mod:cc')
    bindings.clear()
    bindings.update(7, 64, refs)
    expect(refs.setValue).not.toHaveBeenCalled()
  })

  it('register is idempotent — same key twice still only updates once', () => {
    bindings.register(7, 'inst:mod:cc')
    bindings.register(7, 'inst:mod:cc')
    bindings.update(7, 64, refs)
    expect(refs.setValue).toHaveBeenCalledTimes(1)
  })

  it('normalises CC value to 0..1 range', () => {
    bindings.register(7, 'inst:mod:cc')
    bindings.update(7, 0, refs)
    expect(refs.setValue).toHaveBeenCalledWith('inst:mod:cc', 0)
    bindings.update(7, 127, refs)
    expect(refs.setValue).toHaveBeenCalledWith('inst:mod:cc', 1)
  })
})
