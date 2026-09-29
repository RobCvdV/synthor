import { useEffect } from 'react'
import { clampCursor, useAppStore } from '../../state/appStore'
import { useDocStore } from '../../state/docStore'
import { useMidiStore } from '../../state/midiStore'

/**
 * Keeps the tracker cursor inside the current pattern, and makes the cursor's track
 * instrument the keyboard/MIDI instrument. Waits for `ready` so it never acts on the
 * placeholder doc.
 */
export function useTrackerCursorSync(ready: boolean): void {
  const trackCount = useDocStore((s) => s.doc.entities.patterns[s.doc.patternId]?.trackIds.length ?? 0)
  const cursorTrack = useAppStore((s) => s.trackerCursor.track)

  useEffect(() => {
    if (!ready) return
    const { doc } = useDocStore.getState()
    const pattern = doc.entities.patterns[doc.patternId]
    const app = useAppStore.getState()
    if (pattern) app.setTrackerCursor(clampCursor(app.trackerCursor, pattern, doc))
  }, [trackCount, ready])

  // Empty tracks keep the last selection.
  useEffect(() => {
    const { doc } = useDocStore.getState()
    const trackId = doc.entities.patterns[doc.patternId]?.trackIds[cursorTrack]
    const instId = trackId ? doc.entities.tracks[trackId]?.instrumentId : null
    useMidiStore.getState().setActiveInstrument(instId ?? null)
    if (instId) useAppStore.getState().setSelectedInstrumentId(instId)
  }, [cursorTrack, trackCount, ready])
}
