import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CcBindings } from './ccBindings'
import type { ParamRefRegistry } from './paramRefs'

function mockRefs(): ParamRefRegistry {
  const setValue = vi.fn()
  return { setValue } as unknown as ParamRefRegistry
}

describe('CcBindings (rAF-coalesced)', () => {
  let bindings: CcBindings
  let refs: ParamRefRegistry

  beforeEach(() => {
    vi.useFakeTimers()
    // Node.js doesn't have requestAnimationFrame — mock it with a timer.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 16) as unknown as number)
    bindings = new CcBindings()
    refs = mockRefs()
    bindings.attach(refs)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('queues a CC value and flushes it on the next rAF', async () => {
    bindings.register(7, 'inst:mod:cc')
    bindings.queue(7, 64)
    expect(refs.setValue).not.toHaveBeenCalled() // not yet
    await vi.advanceTimersByTimeAsync(16)
    expect(refs.setValue).toHaveBeenCalledWith('inst:mod:cc', 64 / 127)
  })

  it('coalesces multiple values for the same CC into one flush', async () => {
    bindings.register(7, 'inst:mod:cc')
    bindings.queue(7, 10)
    bindings.queue(7, 50)
    bindings.queue(7, 100)
    await vi.advanceTimersByTimeAsync(16)
    expect(refs.setValue).toHaveBeenCalledTimes(1)
    expect(refs.setValue).toHaveBeenCalledWith('inst:mod:cc', 100 / 127)
  })

  it('flushes multiple CC numbers independently', async () => {
    bindings.register(7, 'inst:mod1:cc')
    bindings.register(11, 'inst:mod2:cc')
    bindings.queue(7, 64)
    bindings.queue(11, 32)
    await vi.advanceTimersByTimeAsync(16)
    expect(refs.setValue).toHaveBeenCalledWith('inst:mod1:cc', 64 / 127)
    expect(refs.setValue).toHaveBeenCalledWith('inst:mod2:cc', 32 / 127)
    expect(refs.setValue).toHaveBeenCalledTimes(2)
  })

  it('skips CC=0 (no CC assigned)', async () => {
    bindings.register(0, 'inst:mod:cc')
    bindings.queue(0, 64)
    await vi.advanceTimersByTimeAsync(16)
    expect(refs.setValue).not.toHaveBeenCalled()
  })

  it('no-ops on an unregistered CC', async () => {
    bindings.queue(99, 64)
    await vi.advanceTimersByTimeAsync(16)
    expect(refs.setValue).not.toHaveBeenCalled()
  })

  it('clear discards pending values and registrations', async () => {
    bindings.register(7, 'inst:mod:cc')
    bindings.queue(7, 64)
    bindings.clear()
    await vi.advanceTimersByTimeAsync(16)
    expect(refs.setValue).not.toHaveBeenCalled()
  })

  it('normalises CC value to 0..1 range', async () => {
    bindings.register(7, 'inst:mod:cc')
    bindings.queue(7, 0)
    await vi.advanceTimersByTimeAsync(16)
    expect(refs.setValue).toHaveBeenCalledWith('inst:mod:cc', 0)
    bindings.queue(7, 127)
    await vi.advanceTimersByTimeAsync(16)
    expect(refs.setValue).toHaveBeenCalledWith('inst:mod:cc', 1)
  })

  it('coalesces across rAF boundaries — second queue starts fresh', async () => {
    bindings.register(7, 'inst:mod:cc')
    bindings.queue(7, 10)
    await vi.advanceTimersByTimeAsync(16)
    expect(refs.setValue).toHaveBeenCalledWith('inst:mod:cc', 10 / 127)
    ;(refs.setValue as ReturnType<typeof vi.fn>).mockClear()
    bindings.queue(7, 20)
    await vi.advanceTimersByTimeAsync(16)
    expect(refs.setValue).toHaveBeenCalledWith('inst:mod:cc', 20 / 127)
  })
})
