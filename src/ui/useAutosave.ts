import { useEffect, useRef } from 'react'
import { Autosaver } from '../persist/autosave'
import { isOpfsSupported } from '../persist/opfsStore'
import { saveCurrentSong } from '../persist/saveCurrent'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { useTransportStore } from '../state/transportStore'

const AUTOSAVE_DELAY_MS = 800

/**
 * Persists the current song to OPFS shortly after edits settle, and flushes on
 * transport stop, tab hide, and unload so the last edit is never lost. Saving
 * runs off the audio thread on a small JSON doc, so it's safe during playback;
 * we debounce only to avoid thrashing storage on every keystroke.
 *
 * No-ops gracefully where OPFS is unavailable (older Safari, SSR, tests).
 */
export function useAutosave(): void {
  const saverRef = useRef<Autosaver | null>(null)

  useEffect(() => {
    if (!isOpfsSupported()) return

    const saver = new Autosaver({
      delayMs: AUTOSAVE_DELAY_MS,
      // saveCurrentSong updates status itself; onError just prevents an
      // unhandled rejection from the rethrow.
      onError: () => {},
      save: saveCurrentSong,
    })
    saverRef.current = saver

    // Edits to the document (not mute/clipboard/transport) drive autosave.
    const unsubDoc = useDocStore.subscribe((state, prev) => {
      if (state.doc === prev.doc) return
      useProjectStore.getState().markDirty()
      saver.schedule()
    })

    // Renaming should also persist.
    const unsubProject = useProjectStore.subscribe((state, prev) => {
      if (state.name !== prev.name) saver.schedule()
    })

    // Flush immediately when playback stops.
    const unsubTransport = useTransportStore.subscribe((state, prev) => {
      if (prev.playing && !state.playing) void saver.flush()
    })

    const flush = () => void saver.flush()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      unsubDoc()
      unsubProject()
      unsubTransport()
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      saver.dispose()
    }
  }, [])
}
