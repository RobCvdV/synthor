import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VoicePool } from './voicePool'
import type { ParamRefRegistry } from '../audio/paramRefs'

function mockRefs(): ParamRefRegistry {
  const setValue = vi.fn()
  return { setValue } as unknown as ParamRefRegistry
}

const INST = 'inst_test'

describe('VoicePool (ref-based)', () => {
  let pool: VoicePool
  let refs: ParamRefRegistry

  beforeEach(() => {
    refs = mockRefs()
    pool = new VoicePool(refs, INST)
  })

  // --- noteOn ---

  it('noteOn sets freq, velocity, and gate refs for the allocated slot', () => {
    pool.noteOn(60, 100)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:freq', expect.any(Number))
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:vel', 100 / 127)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:gate', 1)
  })

  it('noteOn defaults velocity to 127', () => {
    pool.noteOn(60)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:vel', 127 / 127)
  })

  it('noteOn allocates sequential slots for different notes', () => {
    pool.noteOn(60)
    pool.noteOn(62)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:freq', expect.any(Number))
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:1:freq', expect.any(Number))
  })

  // --- noteOff ---

  it('noteOff sets gate to 0 for the slot', () => {
    pool.noteOn(60)
    ;(refs.setValue as ReturnType<typeof vi.fn>).mockClear()
    pool.noteOff(60)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:gate', 0)
  })

  it('noteOff on unknown note is a no-op', () => {
    pool.noteOff(99)
    expect(refs.setValue).not.toHaveBeenCalled()
  })

  // --- retrigger ---

  it('retriggering the same note reuses the same slot', () => {
    pool.noteOn(60)
    ;(refs.setValue as ReturnType<typeof vi.fn>).mockClear()
    pool.noteOn(60, 80)
    // Should set values on the SAME slot (v:0)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:freq', expect.any(Number))
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:vel', 80 / 127)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:gate', 1)
  })

  // --- voice stealing ---

  it('steals a releasing slot before stealing an active one', () => {
    // Fill all 8 slots
    for (let n = 60; n < 68; n++) pool.noteOn(n)
    // Release note 60 — gate goes to 0, slot 0 is now releasing
    pool.noteOff(60)
    ;(refs.setValue as ReturnType<typeof vi.fn>).mockClear()
    // New note should steal the releasing slot (0)
    pool.noteOn(72)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:freq', expect.any(Number))
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:gate', 1)
  })

  it('steals the oldest active slot when all are active and none releasing', () => {
    // Fill all 8 slots
    for (let n = 60; n < 68; n++) pool.noteOn(n)
    ;(refs.setValue as ReturnType<typeof vi.fn>).mockClear()
    // New note steals slot 0 (oldest active)
    pool.noteOn(72)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:freq', expect.any(Number))
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:gate', 1)
  })

  // --- panic ---

  it('panic sets all gates to 0', () => {
    pool.noteOn(60)
    pool.noteOn(62)
    ;(refs.setValue as ReturnType<typeof vi.fn>).mockClear()
    pool.panic()
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:gate', 0)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:1:gate', 0)
    // After panic, new note should get a fresh slot
    pool.noteOn(64)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:freq', expect.any(Number))
  })

  // --- release tail cleanup ---

  it('frees the slot after the release tail expires', async () => {
    vi.useFakeTimers()
    pool.noteOn(60)
    pool.noteOff(60)
    // Advance past the 3500ms release tail
    await vi.advanceTimersByTimeAsync(3500)
    // Slot should be freed — a new note can reuse it
    ;(refs.setValue as ReturnType<typeof vi.fn>).mockClear()
    pool.noteOn(72)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:freq', expect.any(Number))
    vi.useRealTimers()
  })

  it('cancels release timer on retrigger', () => {
    vi.useFakeTimers()
    pool.noteOn(60)
    pool.noteOff(60)
    // Retrigger before the release tail expires
    pool.noteOn(60)
    // Release timer should be cancelled — advancing past the original
    // 3500ms should NOT free the slot
    ;(refs.setValue as ReturnType<typeof vi.fn>).mockClear()
    vi.advanceTimersByTime(3500)
    pool.noteOff(60)
    // Should still refer to the same slot
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:v:0:gate', 0)
    vi.useRealTimers()
  })
})
