import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Doc, Id, Pattern } from '../domain/types'

export type PlayMode = 'song' | 'section' | 'pattern'
export const PLAY_MODES: PlayMode[] = ['song', 'section', 'pattern']

export type View = 'tracker' | 'instruments' | 'samples' | 'mixer'

export interface TrackerCursor {
  row: number
  track: number
  /** 0 = note column, 1 = volume column, 2+ = effect lane columns. */
  col: number
  /** When col >= 2, index into the track's effectLanes array (0-based). */
  laneIndex: number | null
}

/**
 * Clamp a cursor so it points to a valid cell in the given pattern. When
 * switching patterns (or loading a song), the persisted cursor may reference
 * a track or effect lane that no longer exists — this min-bounds the indices
 * against what's actually available, preserving the column type (note, volume,
 * or effect lane) whenever possible.
 */
export function clampCursor(cursor: TrackerCursor, pattern: Pattern, doc: Doc): TrackerCursor {
  const maxTrack = Math.max(0, pattern.trackIds.length - 1)
  const track = Math.min(cursor.track, maxTrack)

  let { col, laneIndex } = cursor

  if (col >= 2 && laneIndex !== null) {
    const tid = pattern.trackIds[track]
    const trackEntity = tid ? doc.entities.tracks[tid] : null
    const laneCount = trackEntity?.effectLanes.length ?? 0

    if (laneCount === 0) {
      // Track has no effect lanes — drop back to volume column.
      col = 1
      laneIndex = null
    } else {
      laneIndex = Math.min(laneIndex, laneCount - 1)
      col = 2 + laneIndex
    }
  }

  return { row: cursor.row, track, col, laneIndex }
}

interface AppState {
  playMode: PlayMode
  view: View
  trackerCursor: TrackerCursor
  selectedInstrumentId: Id | null
  /** Selected row in the sample library — target of keyboard preview. */
  selectedSampleId: Id | null
  /** Global keyboard note-range octave, 0..9. Single source for all views. */
  octave: number
  /** Global mutes keyed by 1-based track position (Track #) — applies to
   *  that position in every pattern. */
  mutedTrackNumbers: Record<number, boolean>
  /** Global solos, same keying as mutes. Solo overrides mute. */
  soloedTrackNumbers: Record<number, boolean>

  setPlayMode: (mode: PlayMode) => void
  cyclePlayMode: () => void
  setView: (view: View) => void
  setTrackerCursor: (cursor: TrackerCursor) => void
  setSelectedInstrumentId: (id: Id | null) => void
  setSelectedSampleId: (id: Id | null) => void
  setOctave: (octave: number) => void
  toggleMute: (trackNumber: number) => void
  toggleSolo: (trackNumber: number) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      playMode: 'pattern' as PlayMode,
      view: 'tracker' as View,
      trackerCursor: { row: 0, track: 0, col: 0, laneIndex: null },
      selectedInstrumentId: null,
      selectedSampleId: null,
      octave: 5,
      mutedTrackNumbers: {},
      soloedTrackNumbers: {},

      setPlayMode: (playMode) => set({ playMode }),
      cyclePlayMode: () => set((s) => {
        const idx = PLAY_MODES.indexOf(s.playMode)
        return { playMode: PLAY_MODES[(idx + 1) % PLAY_MODES.length] }
      }),
      setView: (view) => set({ view }),
      setTrackerCursor: (trackerCursor) => set({ trackerCursor }),
      setSelectedInstrumentId: (selectedInstrumentId) => set({ selectedInstrumentId }),
      setSelectedSampleId: (selectedSampleId) => set({ selectedSampleId }),
      setOctave: (octave) => set({ octave: Math.max(0, Math.min(9, octave)) }),
      toggleMute: (trackNumber) => set((s) => ({
        mutedTrackNumbers: { ...s.mutedTrackNumbers, [trackNumber]: !s.mutedTrackNumbers[trackNumber] },
      })),
      toggleSolo: (trackNumber) => set((s) => ({
        soloedTrackNumbers: { ...s.soloedTrackNumbers, [trackNumber]: !s.soloedTrackNumbers[trackNumber] },
      })),
    }),
    {
      name: 'synthor-app-state',
      // Only persist UI preferences, not transient state.
      partialize: (state) => ({
        playMode: state.playMode,
        view: state.view,
        trackerCursor: state.trackerCursor,
        selectedInstrumentId: state.selectedInstrumentId,
        selectedSampleId: state.selectedSampleId,
        octave: state.octave,
        mutedTrackNumbers: state.mutedTrackNumbers,
        soloedTrackNumbers: state.soloedTrackNumbers,
      }),
    },
  ),
)
