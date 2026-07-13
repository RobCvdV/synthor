import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreviewStore } from './previewStore'

describe('previewStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    usePreviewStore.getState().panic()
  })
  afterEach(() => {
    usePreviewStore.getState().panic()
    vi.useRealTimers()
  })

  it('opens a gated voice on note-on', () => {
    usePreviewStore.getState().noteOn('inst_1', 60)
    const { instrumentId, voices } = usePreviewStore.getState()
    expect(instrumentId).toBe('inst_1')
    expect(voices[60]).toEqual({ note: 60, gate: 1 })
  })

  it('holds the released voice through its tail, then GCs it', () => {
    const s = usePreviewStore.getState()
    s.noteOn('inst_1', 60)
    s.noteOff(60)
    // Immediately after note-off the voice lingers with gate 0 (release tail).
    expect(usePreviewStore.getState().voices[60]).toEqual({ note: 60, gate: 0 })
    vi.advanceTimersByTime(4000)
    expect(usePreviewStore.getState().voices[60]).toBeUndefined()
  })

  it('retriggering a releasing note cancels its removal and reopens the gate', () => {
    const s = usePreviewStore.getState()
    s.noteOn('inst_1', 60)
    s.noteOff(60)
    s.noteOn('inst_1', 60) // re-press before the tail elapses
    vi.advanceTimersByTime(4000)
    expect(usePreviewStore.getState().voices[60]).toEqual({ note: 60, gate: 1 })
  })

  it('switching instruments starts a fresh voice set', () => {
    const s = usePreviewStore.getState()
    s.noteOn('inst_1', 60)
    s.noteOn('inst_2', 64)
    const { instrumentId, voices } = usePreviewStore.getState()
    expect(instrumentId).toBe('inst_2')
    expect(voices[60]).toBeUndefined()
    expect(voices[64]).toEqual({ note: 64, gate: 1 })
  })

  it('panic clears every voice and pending timer', () => {
    const s = usePreviewStore.getState()
    s.noteOn('inst_1', 60)
    s.noteOff(60)
    s.panic()
    expect(usePreviewStore.getState().voices).toEqual({})
    vi.advanceTimersByTime(4000) // no lingering timer resurrects anything
    expect(usePreviewStore.getState().voices).toEqual({})
  })
})
