import { useEffect } from 'react'
import type { AudioHost } from '../audio/host'
import type { KeyboardPlayer } from '../audio/keyboardPlayer'
import { useAppStore } from '../state/appStore'
import { useAudioStore } from '../state/audioStore'
import { useDocStore } from '../state/docStore'
import { usePreviewStore } from '../state/previewStore'
import { useTransportStore } from '../state/transportStore'
import { codeToSemitone, isEditableTarget } from './keymap'

/**
 * The app's one keydown/keyup listener pair: transport, undo, panic, mute/solo, view and
 * octave keys, mixer note keys, and the tracker keys via `onTrackerKey`. Views with their
 * own keyboard handling (instruments, samples) register their own listeners.
 */
export function useAppKeys(host: AudioHost, keyboardPlayer: KeyboardPlayer, onTrackerKey: (e: KeyboardEvent) => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const app = useAppStore.getState()
      const { doc, undo, redo } = useDocStore.getState()
      const pattern = doc.entities.patterns[doc.patternId]
      if (!pattern) return
      const editing = isEditableTarget(e.target)

      // --- Transport: Space plays from the cursor, Ctrl+Space from the top ---
      if (e.code === 'Space' && !e.metaKey && !editing) {
        e.preventDefault()
        void host.start()
        useTransportStore.getState().toggle(host.currentTime, e.ctrlKey ? 0 : app.trackerCursor.row)
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }

      if (e.code === 'Escape' && !editing) {
        e.preventDefault()
        keyboardPlayer.clearHeld()
        host.panic()
        useAudioStore.getState().setPlaybackStarted(false)
        return
      }

      // --- F1..F12 mute, Shift+F solo, by Track # ---
      const fkey = /^F([1-9]|1[0-2])$/.exec(e.code)
      if (fkey) {
        e.preventDefault()
        const trackNum = Number(fkey[1])
        if (pattern.trackIds[trackNum - 1]) {
          if (e.shiftKey) app.toggleSolo(trackNum)
          else app.toggleMute(trackNum)
        }
        return
      }

      if (editing) return

      if (e.code === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        app.cyclePlayMode()
        return
      }

      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const view = ({ KeyT: 'tracker', KeyI: 'instruments', KeyS: 'samples', KeyM: 'mixer' } as const)[e.code as 'KeyT']
        if (view) { e.preventDefault(); app.setView(view); return }
      }

      const noMods = !e.metaKey && !e.ctrlKey && !e.altKey
      if (noMods && (e.code === 'Minus' || e.code === 'Equal')) {
        e.preventDefault()
        app.setOctave(app.octave + (e.code === 'Equal' ? 1 : -1))
        return
      }

      if (app.view === 'tracker') {
        onTrackerKey(e)
        return
      }

      // Mixer: note keys play the global instrument, held until key-up.
      if (app.view === 'mixer' && noMods) {
        const semi = codeToSemitone(e.code)
        if (semi === undefined) return
        e.preventDefault()
        if (e.repeat) return
        const instId = app.selectedInstrumentId
        if (instId) {
          const note = app.octave * 12 + semi
          void host.start().then(() => keyboardPlayer.noteOn(instId, note, e.code))
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      const released = keyboardPlayer.noteOff(e.code)
      if (released) usePreviewStore.getState().noteOff(released.note)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [host, keyboardPlayer, onTrackerKey])
}
