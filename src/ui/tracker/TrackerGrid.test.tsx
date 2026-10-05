// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { TrackerGrid, type Cursor } from './TrackerGrid'
import { resetStores } from '../test/testUtils'
import { useDocStore } from '../../state/docStore'
import { useTransportStore } from '../../state/transportStore'
import { useAudioStore } from '../../state/audioStore'
import type { Doc } from '../../domain/types'

// Every non-empty note cell calls midiToName once per render of its row.
const midiToName = vi.hoisted(() => vi.fn((n: number) => `N${n}`))
vi.mock('../../domain/notes', async (orig) => ({ ...(await orig<object>()), midiToName }))

const noop = () => {}
const none = {}
const cursor: Cursor = { row: 0, track: 0, col: 0, laneIndex: null }

function docWithNoteOnEveryRow(): Doc {
  let doc = useDocStore.getState().doc
  const pattern = doc.entities.patterns[doc.patternId]
  const trackId = pattern.trackIds[0]
  const track = doc.entities.tracks[trackId]
  const cells = track.cells.map((c) => ({ ...c, note: 60 }))
  doc = { ...doc, entities: { ...doc.entities, tracks: { ...doc.entities.tracks, [trackId]: { ...track, cells } } } }
  useDocStore.setState({ doc })
  return doc
}

function renderGrid(doc: Doc, c: Cursor = cursor) {
  const pattern = doc.entities.patterns[doc.patternId]
  return render(
    <TrackerGrid doc={doc} pattern={pattern} cursor={c} muted={none} soloed={none}
      selection={null} volumeEntry={null} laneEntry={null} onCellClick={noop} onCellDrag={noop} />,
  )
}

describe('TrackerGrid render cost', () => {
  beforeEach(() => {
    resetStores()
    midiToName.mockClear()
  })

  it('re-renders only the old and new playhead rows on a row tick', () => {
    const doc = docWithNoteOnEveryRow()
    act(() => {
      useTransportStore.setState({ playing: true, currentRow: 0 })
      useAudioStore.setState({ playbackStarted: true })
    })
    renderGrid(doc)
    expect(midiToName.mock.calls.length).toBe(doc.entities.patterns[doc.patternId].length)

    midiToName.mockClear()
    act(() => useTransportStore.setState({ currentRow: 1 }))
    expect(midiToName).toHaveBeenCalledTimes(2)
  })

  it('re-renders only the two affected rows on a cursor move', () => {
    const doc = docWithNoteOnEveryRow()
    const { rerender } = renderGrid(doc)
    const pattern = doc.entities.patterns[doc.patternId]

    midiToName.mockClear()
    rerender(
      <TrackerGrid doc={doc} pattern={pattern} cursor={{ ...cursor, row: 5 }} muted={none} soloed={none}
        selection={null} volumeEntry={null} laneEntry={null} onCellClick={noop} onCellDrag={noop} />,
    )
    expect(midiToName).toHaveBeenCalledTimes(2)
  })
})
