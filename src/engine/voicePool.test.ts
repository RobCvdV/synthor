import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VoicePool } from './voicePool'
import type { ParamRefRegistry } from '../audio/paramRefs'
import type { DrumKitInstrument } from '../domain/types'

function mockRefs(): ParamRefRegistry {
  const setValue = vi.fn()
  return { setValue } as unknown as ParamRefRegistry
}

const INST = 'inst_test'

/** A minimal drumkit with slots at MIDI notes 36 (kick) and 48 (snare). */
function makeKit(): DrumKitInstrument {
  return {
    id: 'kit_test',
    kind: 'drumkit',
    name: 'Test Kit',
    keyLo: 36,
    keyHi: 60,
    params: { gain: 1 },
    slots: [
      { id: 'slot_36', note: 36, sampleId: 'smpl_kick', instrumentId: null, pitchOffset: 0, gain: 1, pan: 0 },
      { id: 'slot_48', note: 48, sampleId: 'smpl_snare', instrumentId: null, pitchOffset: 0, gain: 1, pan: 0 },
    ],
  }
}

function makePool(refs: ParamRefRegistry, kit?: DrumKitInstrument): VoicePool {
  const pool = new VoicePool(refs, INST)
  if (kit) pool.setKit(kit)
  return pool
}

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

// ── drumkit mode ────────────────────────────────────────────────────────

describe('VoicePool (drumkit mode)', () => {
  let pool: VoicePool
  let refs: ParamRefRegistry
  let kit: DrumKitInstrument

  beforeEach(() => {
    refs = mockRefs()
    kit = makeKit()
    pool = makePool(refs, kit)
  })

  it('setKit enables drumkit routing', () => {
    expect(pool.isDrumKit).toBe(true)
    expect(pool.slotCount).toBe(2)
  })

  it('setKit is a no-op when already configured', () => {
    const kit2 = makeKit()
    kit2.slots = [{ id: 'slot_60', note: 60, sampleId: 'x', instrumentId: null, pitchOffset: 0, gain: 1, pan: 0 }]
    pool.setKit(kit2)
    // Still has the original 2 slots, not the single-slot kit
    expect(pool.slotCount).toBe(2)
  })

  it('noteOn routes note to the correct slot via getSlotForNote', () => {
    // Note 36 falls in slot 36 (slot index 0)
    pool.noteOn(36, 100)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:0:v0:freq', expect.any(Number))
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:0:v0:vel', 100 / 127)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:0:v0:gate', 1)

    // Note 48 falls in slot 48 (slot index 1)
    ;(refs.setValue as ReturnType<typeof vi.fn>).mockClear()
    pool.noteOn(48, 80)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:1:v0:freq', expect.any(Number))
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:1:v0:vel', 80 / 127)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:1:v0:gate', 1)
  })

  it('noteOn inherits note to nearest lower slot', () => {
    // Note 40 is between 36 and 48 — should hit slot 36 (index 0)
    pool.noteOn(40)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:0:v0:gate', 1)
    // Note 55 is above 48 — should hit slot 48 (index 1)
    ;(refs.setValue as ReturnType<typeof vi.fn>).mockClear()
    pool.noteOn(55)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:1:v0:gate', 1)
  })

  it('noteOn returns -1 for note below all slots', () => {
    // No slot covers note 20 (below lowest slot at 36)
    const result = pool.noteOn(20)
    expect(result).toBe(-1)
    expect(refs.setValue).not.toHaveBeenCalled()
  })

  it('noteOn round-robins sub-voices for same-slot retriggers', () => {
    // Hit the same slot (note 36) twice
    pool.noteOn(36)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:0:v0:gate', 1)

    ;(refs.setValue as ReturnType<typeof vi.fn>).mockClear()
    pool.noteOn(36) // retrigger — should use sub-voice 1
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:0:v1:freq', expect.any(Number))
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:0:v1:gate', 1)

    // Third hit toggles back to sub-voice 0
    ;(refs.setValue as ReturnType<typeof vi.fn>).mockClear()
    pool.noteOn(36)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:0:v0:freq', expect.any(Number))
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:0:v0:gate', 1)
  })

  it('noteOff sets gate to 0 on both sub-voices of the matched slot', () => {
    pool.noteOn(48)
    ;(refs.setValue as ReturnType<typeof vi.fn>).mockClear()
    pool.noteOff(48)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:1:v0:gate', 0)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:1:v1:gate', 0)
  })

  it('noteOff on note outside all slots is a no-op', () => {
    pool.noteOff(20)
    expect(refs.setValue).not.toHaveBeenCalled()
  })

  it('panic sets all drumkit slot sub-voice gates to 0', () => {
    pool.noteOn(36)
    pool.noteOn(48)
    ;(refs.setValue as ReturnType<typeof vi.fn>).mockClear()
    pool.panic()
    // 2 slots × 2 sub-voices = 4 gate=0 calls
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:0:v0:gate', 0)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:0:v1:gate', 0)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:1:v0:gate', 0)
    expect(refs.setValue).toHaveBeenCalledWith('inst_test:ds:1:v1:gate', 0)
  })
})
