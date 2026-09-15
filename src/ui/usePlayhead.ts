import { useEffect } from 'react'
import { useTransportStore } from '../state/transportStore'
import { useAudioStore } from '../state/audioStore'
import { useDocStore } from '../state/docStore'
import { useAppStore } from '../state/appStore'
import { buildArrangement } from '../engine/arrangement'
import type { AudioHost } from '../audio/host'

/**
 * Syncs doc.patternId to the current arrangement position during section/song
 * playback. Called once from App (always mounted) so pattern switching works
 * from any view, exactly like the old rAF did.
 */
export function usePatternSync(host: AudioHost): void {
  useEffect(() => {
    const unsub = useTransportStore.subscribe((state) => {
      if (!state.playing) return
      const { playbackStarted } = useAudioStore.getState()
      if (!playbackStarted) return
      const { playMode } = useAppStore.getState()
      if (playMode === 'pattern') return

      const { doc } = useDocStore.getState()
      const arrangement = buildArrangement(doc, playMode)
      if (arrangement.length <= 1) return

      const totalRows = arrangement.reduce((sum, a) => sum + (doc.entities.patterns[a.patternId]?.length ?? 64), 0)
      const wrapped = ((state.currentRow % totalRows) + totalRows) % totalRows

      const item = arrangement.find(
        (a) => wrapped >= a.startRow && wrapped < a.startRow + (doc.entities.patterns[a.patternId]?.length ?? 64),
      )
      if (item && item.patternId !== doc.patternId) {
        host.skipNextRecompile = true
        useDocStore.setState((s) => ({
          doc: { ...s.doc, patternId: item.patternId },
        }))
      }
    })

    return () => { unsub() }
  }, [host])
}

/**
 * Returns the current playhead row (-1 when stopped / scheduler not yet live).
 * Pattern mode: the row is already pattern-local (txseq wraps within pattern
 * length). Section/song mode: maps the arrangement-global row back to a local
 * row within the currently visible pattern.
 */
export function usePlayheadRow(): number {
  const playing = useTransportStore((s) => s.playing)
  const currentRow = useTransportStore((s) => s.currentRow)
  const playbackStarted = useAudioStore((s) => s.playbackStarted)
  const playMode = useAppStore((s) => s.playMode)
  const doc = useDocStore((s) => s.doc)

  if (!playing || !playbackStarted) return -1
  if (playMode === 'pattern') return currentRow

  // Section/song — map global row to local.
  const arrangement = buildArrangement(doc, playMode)
  if (arrangement.length <= 1) return currentRow

  const totalRows = arrangement.reduce((sum, a) => sum + (doc.entities.patterns[a.patternId]?.length ?? 64), 0)
  const wrapped = ((currentRow % totalRows) + totalRows) % totalRows
  const item = arrangement.find(
    (a) => wrapped >= a.startRow && wrapped < a.startRow + (doc.entities.patterns[a.patternId]?.length ?? 64),
  )
  return item ? wrapped - item.startRow : currentRow
}