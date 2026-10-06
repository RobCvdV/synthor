// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTrackerKeys } from './useTrackerKeys'
import { resetStores, stubHost } from '../test/testUtils'
import { useAppStore } from '../../state/appStore'
import { useDocStore } from '../../state/docStore'
import type { KeyboardPlayer } from '../../audio/keyboardPlayer'

const player = { noteOn: vi.fn(), noteOffNote: vi.fn() } as unknown as KeyboardPlayer

function setup() {
  const { result } = renderHook(() => useTrackerKeys(stubHost(), player))
  const press = (code: string, mods: KeyboardEventInit = {}) =>
    act(() => result.current.handleKeyDown(new KeyboardEvent('keydown', { code, ...mods })))
  return { result, press }
}

const cursor = () => useAppStore.getState().trackerCursor
function trackId(track = 0) {
  const { doc } = useDocStore.getState()
  return doc.entities.patterns[doc.patternId].trackIds[track]
}
const cell = (row: number) => useDocStore.getState().doc.entities.tracks[trackId()].cells[row]

describe('useTrackerKeys', () => {
  beforeEach(() => {
    resetStores()
    useAppStore.setState({ trackerCursor: { row: 1, track: 0, col: 0, laneIndex: null } })
  })

  it('writes a note in the current octave and advances', () => {
    const { press } = setup()
    press('KeyQ')
    expect(cell(1).note).toBe(useAppStore.getState().octave * 12 + 12)
    expect(cursor().row).toBe(2)
  })

  it('enters a volume as two hex digits, advancing after the second', () => {
    const { result, press } = setup()
    useAppStore.setState({ trackerCursor: { row: 1, track: 0, col: 1, laneIndex: null } })
    press('KeyA')
    expect(result.current.volumeEntry).toBe(0xa)
    expect(cursor().row).toBe(1)
    press('Digit5')
    expect(cell(1).volume).toBeCloseTo(0xa5 / 255)
    expect(result.current.volumeEntry).toBeNull()
    expect(cursor().row).toBe(2)
  })

  it('selects with Shift+arrows and clears the selection with Delete', () => {
    const { result, press } = setup()
    press('ArrowDown', { shiftKey: true })
    press('ArrowDown', { shiftKey: true })
    expect(result.current.selection).toEqual({ startRow: 1, startTrack: 0, startCol: 0, endRow: 3, endTrack: 0, endCol: 0 })
    for (const row of [1, 2, 3]) useDocStore.getState().setCellNote(trackId(), row, 60)
    press('Delete')
    expect([1, 2, 3].map((r) => cell(r).note)).toEqual([null, null, null])
    expect(result.current.selection).toBeNull()
  })

  it('copies with Cmd+C and Ctrl+C alike', () => {
    const { press } = setup()
    for (const mods of [{ metaKey: true }, { ctrlKey: true }]) {
      useDocStore.setState({ trackClipboard: null })
      press('KeyC', mods)
      expect(useDocStore.getState().trackClipboard).not.toBeNull()
    }
  })

  it('moves the cursor on a cell click and extends the selection with Shift', () => {
    const { result } = setup()
    act(() => result.current.onCellClick(4, 0, true))
    expect(cursor()).toMatchObject({ row: 4, track: 0 })
    expect(result.current.selection).toEqual({ startRow: 1, startTrack: 0, startCol: 0, endRow: 4, endTrack: 0, endCol: 0 })
  })

  it('advances by the edit step, and stays put at step 0', () => {
    const { press } = setup()
    useAppStore.getState().setEditStep(4)
    press('KeyQ')
    expect(cursor().row).toBe(5)
    useAppStore.getState().setEditStep(0)
    press('KeyW')
    expect(cursor().row).toBe(5)
  })

  it('sets the edit step with Alt+digit and toggles follow with Ctrl+F', () => {
    const { press } = setup()
    press('Digit3', { altKey: true })
    expect(useAppStore.getState().editStep).toBe(3)
    press('KeyF', { ctrlKey: true })
    expect(useAppStore.getState().followPlayhead).toBe(false)
  })

  it('puts the cursor in the clicked column, falling back to volume for a missing lane', () => {
    const { result } = setup()
    act(() => result.current.onCellClick(3, 0, false, 1))
    expect(cursor()).toEqual({ row: 3, track: 0, col: 1, laneIndex: null })
    useDocStore.getState().addEffectLane(trackId(), 'panning')
    act(() => result.current.onCellClick(3, 0, false, 2))
    expect(cursor()).toEqual({ row: 3, track: 0, col: 2, laneIndex: 0 })
    act(() => result.current.onCellClick(3, 0, false, 5))
    expect(cursor()).toMatchObject({ col: 1, laneIndex: null })
  })

  it('selects by dragging until the mouse is released', () => {
    const { result } = setup()
    act(() => result.current.onCellClick(2, 0, false))
    act(() => result.current.onCellDrag(6, 0))
    expect(result.current.selection).toEqual({ startRow: 2, startTrack: 0, startCol: 0, endRow: 6, endTrack: 0, endCol: 0 })
    expect(cursor().row).toBe(6)
    act(() => result.current.onCellDrag(2, 0))
    expect(result.current.selection).toBeNull()
    act(() => { window.dispatchEvent(new MouseEvent('mouseup')) })
    act(() => result.current.onCellDrag(8, 0))
    expect(result.current.selection).toBeNull()
  })

  it('toggles edit mode with Cmd/Ctrl+E; off, note keys only play and cells stay untouched', () => {
    const { press } = setup()
    press('KeyE', { metaKey: true })
    expect(useAppStore.getState().editMode).toBe(false)
    useAppStore.setState({ selectedInstrumentId: 'inst' })
    useDocStore.getState().setCellNote(trackId(), 1, 60)
    press('KeyQ')
    press('Delete')
    press('KeyV', { metaKey: true })
    press('Equal', { metaKey: true })
    expect(cell(1).note).toBe(60)
    expect(cursor().row).toBe(1)
    press('ArrowDown')
    expect(cursor().row).toBe(2)
    press('KeyE', { ctrlKey: true })
    expect(useAppStore.getState().editMode).toBe(true)
  })

  it('transposes by a semitone with Cmd+-/=, an octave with Shift', () => {
    const { press } = setup()
    useDocStore.getState().setCellNote(trackId(), 0, 60)
    press('Equal', { metaKey: true })
    expect(cell(0).note).toBe(61)
    press('Minus', { metaKey: true, shiftKey: true })
    expect(cell(0).note).toBe(49)
  })

  it('makes a new pattern from the selection with Ctrl+N', () => {
    const { result, press } = setup()
    const before = useDocStore.getState().doc.patternId
    press('ArrowDown', { shiftKey: true })
    press('ArrowDown', { shiftKey: true })
    press('KeyN', { ctrlKey: true })
    const { doc } = useDocStore.getState()
    expect(doc.patternId).not.toBe(before)
    expect(doc.entities.patterns[doc.patternId].length).toBe(3)
    expect(result.current.selection).toBeNull()
    expect(cursor()).toEqual({ row: 0, track: 0, col: 0, laneIndex: null })
  })

  it('selecting in the volume column clears only volumes', () => {
    const { result, press } = setup()
    useAppStore.setState({ trackerCursor: { row: 1, track: 0, col: 1, laneIndex: null } })
    for (const row of [1, 2]) { useDocStore.getState().setCellNote(trackId(), row, 60); useDocStore.getState().setCellVolume(trackId(), row, 0.5) }
    press('ArrowDown', { shiftKey: true })
    expect(result.current.selection).toMatchObject({ startCol: 1, endCol: 1 })
    press('Delete')
    expect([1, 2].map((r) => [cell(r).note, cell(r).volume])).toEqual([[60, null], [60, null]])
  })
})
