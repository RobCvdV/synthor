import { useEffect } from 'react'
import { isEditableTarget, codeToSemitone } from '../keymap'
import { useAppStore } from '../../state/appStore'

interface NoteKeysOptions {
  onNote: (note: number, code: string) => void
  onEscape?: () => void
  /** Return true to suppress note keys (e.g. when a sample dialog is open). */
  blockWhen?: () => boolean
  disabled?: boolean
}

/** Window-level keyboard-note audition for standalone views
 *  (InstrumentsView, SampleLibraryView). App's global handler owns
 *  tracker + mixer notes — do not add a second listener there. */
export function useNoteKeys({ onNote, onEscape, blockWhen, disabled }: NoteKeysOptions): void {
  useEffect(() => {
    if (disabled) return

    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isEditableTarget(e.target as HTMLElement | null)) return
      if (blockWhen?.()) return

      if (e.key === 'Escape') {
        onEscape?.()
        return
      }

      const semi = codeToSemitone(e.code)
      if (semi === undefined) return
      const octave = useAppStore.getState().octave
      const note = octave * 12 + semi
      if (note >= 0 && note <= 127) onNote(note, e.code)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onNote, onEscape, blockWhen, disabled])
}