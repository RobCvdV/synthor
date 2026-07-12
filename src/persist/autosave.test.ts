import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Autosaver } from './autosave'

/** A save that resolves only when we tell it to, so we can test overlap. */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('Autosaver', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces rapid schedules into a single save', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const a = new Autosaver({ delayMs: 100, save })

    a.schedule()
    vi.advanceTimersByTime(40)
    a.schedule() // resets the timer
    vi.advanceTimersByTime(40)
    a.schedule()
    expect(save).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does not save when nothing was scheduled', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const a = new Autosaver({ delayMs: 100, save })
    await a.flush()
    expect(save).not.toHaveBeenCalled()
  })

  it('flush saves immediately and cancels the pending timer', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const a = new Autosaver({ delayMs: 1000, save })
    a.schedule()
    await a.flush()
    expect(save).toHaveBeenCalledTimes(1)
    // Timer was cancelled, so letting it "fire" does nothing more.
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('cancel drops a pending save', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const a = new Autosaver({ delayMs: 100, save })
    a.schedule()
    a.cancel()
    await vi.runAllTimersAsync()
    expect(save).not.toHaveBeenCalled()
  })

  it('coalesces an edit arriving mid-save into exactly one follow-up save', async () => {
    const d1 = deferred()
    const d2 = deferred()
    const save = vi.fn().mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise)
    const a = new Autosaver({ delayMs: 10, save })

    a.schedule()
    await vi.advanceTimersByTimeAsync(10) // first save starts, awaiting d1
    expect(save).toHaveBeenCalledTimes(1)

    a.schedule() // arrives mid-save
    await vi.advanceTimersByTimeAsync(10)
    expect(save).toHaveBeenCalledTimes(1) // still blocked on the first save

    d1.resolve() // first save finishes → one follow-up runs
    await Promise.resolve()
    await Promise.resolve()
    expect(save).toHaveBeenCalledTimes(2)

    d2.resolve()
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledTimes(2) // no extra pile-up
  })

  it('reports save lifecycle and errors via hooks', async () => {
    const onSaveStart = vi.fn()
    const onSaveEnd = vi.fn()
    const onError = vi.fn()
    const save = vi.fn().mockRejectedValue(new Error('disk full'))
    const a = new Autosaver({ delayMs: 10, save, onSaveStart, onSaveEnd, onError })

    a.schedule()
    await vi.runAllTimersAsync()

    expect(onSaveStart).toHaveBeenCalledTimes(1)
    expect(onSaveEnd).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }))
  })

  it('stops scheduling after dispose', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const a = new Autosaver({ delayMs: 10, save })
    a.dispose()
    a.schedule()
    await vi.runAllTimersAsync()
    expect(save).not.toHaveBeenCalled()
  })
})
