import { useEffect, useMemo } from 'react'
import { useTransportStore } from '../state/transportStore'
import { useAudioStore } from '../state/audioStore'
import { useDocStore } from '../state/docStore'
import { useAppStore } from '../state/appStore'
import { buildArrangement, itemIndexAt, startRowFor, type ArrangementItem } from '../engine/arrangement'
import type { AudioHost } from '../audio/host'

/** The arrangement the current play mode plays, from the live stores. */
export function currentArrangement(): ArrangementItem[] {
  const { doc } = useDocStore.getState()
  const { playMode, currentStep } = useAppStore.getState()
  return buildArrangement(doc, playMode, currentStep)
}

/** Global start row for Space (from the cursor in the current step) or Ctrl+Space (from the top). */
export function playStartRow(fromTop: boolean): number {
  if (fromTop) return 0
  const { doc } = useDocStore.getState()
  const { currentStep, trackerCursor } = useAppStore.getState()
  return startRowFor(doc, currentArrangement(), currentStep, trackerCursor.row)
}

/**
 * Follows the playing step during section/song playback: shows its pattern and makes it the
 * current step. Called once from App (always mounted) so it works from any view.
 */
export function usePatternSync(host: AudioHost): void {
  useEffect(() => {
    const unsub = useTransportStore.subscribe((state) => {
      if (!state.playing) return
      if (!useAudioStore.getState().playbackStarted) return
      const app = useAppStore.getState()
      if (app.playMode === 'pattern') return

      const { doc } = useDocStore.getState()
      const arrangement = buildArrangement(doc, app.playMode, app.currentStep)
      if (arrangement.length <= 1) return
      const item = arrangement[itemIndexAt(doc, arrangement, state.currentRow)]
      if (!item) return

      // Step before pattern: the arrangement resolves through it, so it must never point elsewhere.
      if (item.sectionId !== undefined && item.step !== undefined) {
        app.setCurrentStep({ sectionId: item.sectionId, step: item.step })
      }
      if (item.patternId !== doc.patternId) {
        host.skipNextRecompile = true
        useDocStore.setState((s) => ({ doc: { ...s.doc, patternId: item.patternId } }))
      }
    })
    return () => { unsub() }
  }, [host])
}

/** The arrangement item under the playhead, or -1 when stopped / not yet audible. */
function usePlayingIndex(arrangement: readonly ArrangementItem[]): number {
  const doc = useDocStore((s) => s.doc)
  const playing = useTransportStore((s) => s.playing)
  const started = useAudioStore((s) => s.playbackStarted)
  // Selecting the index (not the row) re-renders only when the playing item changes.
  const index = useTransportStore((s) => itemIndexAt(doc, arrangement, s.currentRow))
  return playing && started ? index : -1
}

function useArrangement(): ArrangementItem[] {
  const doc = useDocStore((s) => s.doc)
  const playMode = useAppStore((s) => s.playMode)
  const currentStep = useAppStore((s) => s.currentStep)
  return useMemo(() => buildArrangement(doc, playMode, currentStep), [doc, playMode, currentStep])
}

/** The section step under the playhead (section/song mode), or null. */
export function usePlayingStep(): ArrangementItem | null {
  const arrangement = useArrangement()
  const playMode = useAppStore((s) => s.playMode)
  const index = usePlayingIndex(arrangement)
  return playMode !== 'pattern' && index >= 0 ? arrangement[index] : null
}

/**
 * Returns the current playhead row (-1 when stopped / scheduler not yet live).
 * Pattern mode: the row is already pattern-local (txseq wraps within pattern
 * length). Section/song mode: maps the arrangement-global row back to a local
 * row within the playing item.
 */
export function usePlayheadRow(): number {
  const playing = useTransportStore((s) => s.playing)
  const currentRow = useTransportStore((s) => s.currentRow)
  const playbackStarted = useAudioStore((s) => s.playbackStarted)
  const playMode = useAppStore((s) => s.playMode)
  const doc = useDocStore((s) => s.doc)
  const arrangement = useArrangement()

  if (!playing || !playbackStarted) return -1
  if (playMode === 'pattern' || arrangement.length <= 1) return currentRow

  const total = arrangement.reduce((sum, a) => sum + (doc.entities.patterns[a.patternId]?.length ?? 0), 0)
  const item = arrangement[itemIndexAt(doc, arrangement, currentRow)]
  return item && total > 0 ? (((currentRow % total) + total) % total) - item.startRow : currentRow
}
