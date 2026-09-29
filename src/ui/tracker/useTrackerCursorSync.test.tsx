// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTrackerCursorSync } from './useTrackerCursorSync'
import { resetStores } from '../test/testUtils'
import { useAppStore } from '../../state/appStore'
import { useDocStore } from '../../state/docStore'
import { useMidiStore } from '../../state/midiStore'

const tracks = () => {
  const { doc } = useDocStore.getState()
  return doc.entities.patterns[doc.patternId].trackIds
}

describe('useTrackerCursorSync', () => {
  beforeEach(resetStores)

  it('selects the instrument of the track under the cursor', () => {
    const lastTrack = tracks().length - 1
    useAppStore.setState({ trackerCursor: { row: 0, track: lastTrack, col: 0, laneIndex: null } })
    renderHook(() => useTrackerCursorSync(true))
    const instId = useDocStore.getState().doc.entities.tracks[tracks()[lastTrack]].instrumentId
    expect(useAppStore.getState().selectedInstrumentId).toBe(instId)
    expect(useMidiStore.getState().activeInstrumentId).toBe(instId)
  })

  it('pulls the cursor back when its track is removed', () => {
    const instId = Object.keys(useDocStore.getState().doc.entities.instruments)[0]
    useDocStore.getState().addTrack(tracks().length, instId)
    const lastTrack = tracks().length - 1
    useAppStore.setState({ trackerCursor: { row: 0, track: lastTrack, col: 0, laneIndex: null } })
    renderHook(() => useTrackerCursorSync(true))
    act(() => useDocStore.getState().removeTrack(tracks()[lastTrack]))
    expect(useAppStore.getState().trackerCursor.track).toBe(lastTrack - 1)
  })

  it('leaves the cursor alone until the song is ready', () => {
    useAppStore.setState({ trackerCursor: { row: 0, track: 99, col: 0, laneIndex: null } })
    renderHook(() => useTrackerCursorSync(false))
    expect(useAppStore.getState().trackerCursor.track).toBe(99)
  })
})
