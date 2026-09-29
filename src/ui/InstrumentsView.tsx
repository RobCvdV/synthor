import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocStore } from '../state/docStore'
import { usePreviewStore } from '../state/previewStore'
import { useAppStore } from '../state/appStore'
import { codeToSemitone, isEditableTarget } from './keymap'
import { downloadBlob } from './download'
import { ModularEditor } from './ModularEditor'
import { DrumKitEditor } from './DrumKitEditor'
import { InstrumentSettings } from './InstrumentSettings'
import { exportInstrumentFile, saveSongInstrumentToLibrary } from './instrumentActions'
import { hasStorage } from '../persist/storage'
import { InstrumentRail } from './InstrumentRail'
import { SaveToLibraryDialog, type SaveToLibraryValues } from './library/SaveToLibraryDialog'
import { instrumentLibrary } from './library/librarySource'
import type { AudioHost } from '../audio/host'
import type { KeyboardPlayer } from '../audio/keyboardPlayer'
import type { Id } from '../domain/types'

/** Full-screen instruments view: a list rail on the left, the selected
 *  instrument's editor on the right (node graph for synths, key map for drum
 *  kits). All edits go through docStore, so undo/redo + autosave apply.
 *
 *  The note keys audition the selected instrument live (held = gate open, see
 *  KeyboardPlayer); the tracker keymap is inert here (App guards it). Octave is
 *  the global header setting; panic lives in the toolbar. */
export function InstrumentsView({ host, keyboardPlayer }: { host: AudioHost; keyboardPlayer: KeyboardPlayer }) {
  const doc = useDocStore((s) => s.doc)
  const removeInstrument = useDocStore((s) => s.removeInstrument)
  const duplicateInstrument = useDocStore((s) => s.duplicateInstrument)

  const noteOn = usePreviewStore((s) => s.noteOn)
  const panic = usePreviewStore((s) => s.panic)
  const activeVoices = usePreviewStore((s) => Object.keys(s.voices).length)

  const instruments = Object.values(doc.entities.instruments)
  const selectedId = useAppStore((s) => s.selectedInstrumentId)
  const setSelectedId = useAppStore((s) => s.setSelectedInstrumentId)
  const [savingId, setSavingId] = useState<Id | null>(null)

  // Keep a valid selection as instruments come and go.
  useEffect(() => {
    if (selectedId && doc.entities.instruments[selectedId]) return
    setSelectedId(Object.keys(doc.entities.instruments)[0] ?? null)
  }, [doc.entities.instruments, selectedId])

  const selected = selectedId ? doc.entities.instruments[selectedId] : undefined

  // Refs so the window key handler always reads the latest values.
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  // Panic when leaving the view or switching instruments — no stuck notes.
  useEffect(() => {
    keyboardPlayer.clearHeld()
    panic()
  }, [selectedId, panic, keyboardPlayer])
  useEffect(() => () => panic(), [panic])

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.code === 'Escape') {
        e.preventDefault()
        keyboardPlayer.clearHeld()
        panic()
        host.panic()
        return
      }

      if (e.repeat) return // ignore auto-repeat: one attack per physical press
      const semi = codeToSemitone(e.code)
      const instId = selectedIdRef.current
      if (semi === undefined || !instId) return
      e.preventDefault()
      const note = useAppStore.getState().octave * 12 + semi
      // previewStore for the UI voice counter + MIDI priority, and the shared
      // KeyboardPlayer for the audio ref path (held until App's key-up).
      void host.start().then(() => {
        noteOn(instId, note)
        keyboardPlayer.noteOn(instId, note, e.code)
      })
    },
    [host, keyboardPlayer, noteOn, panic],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onKeyDown])

  /** How many tracks reference each instrument (delete is blocked while > 0). */
  const usage = (id: Id) => Object.values(doc.entities.tracks).filter((t) => t.instrumentId === id).length

  /** Download the selected instrument with its sub-instruments and samples. */
  const exportInstrument = async () => {
    if (!selected) return
    try {
      const { blob, filename } = await exportInstrumentFile(selected.id)
      downloadBlob(blob, filename)
    } catch (err) {
      alert(`Could not export instrument: ${(err as Error).message}`)
    }
  }

  const saveToLibrary = async (values: SaveToLibraryValues) => {
    if (!savingId) return
    setSavingId(null)
    try {
      await saveSongInstrumentToLibrary(savingId, values.name, values)
    } catch (err) {
      alert(`Could not save to the library: ${(err as Error).message}`)
    }
  }

  return (
    <div className="instruments-view">
      <InstrumentRail instruments={instruments} selectedId={selectedId} usage={usage} onSelect={setSelectedId} />

      <section className="inst-editor">
        {!selected && <div className="inst-empty">No instruments. Add one to start patching.</div>}
        {selected && (
          <>
            <div className="preview-bar">
              <span className={'preview-voices' + (activeVoices ? ' on' : '')}>{activeVoices} voice{activeVoices === 1 ? '' : 's'}</span>
            </div>

            {selected.kind === 'modular' ? (
              <ModularEditor inst={selected} host={host} />
            ) : (
              <DrumKitEditor inst={selected} />
            )}
          </>
        )}
      </section>

      {selected && (
        <InstrumentSettings
          inst={selected}
          usage={usage(selected.id)}
          onDuplicate={() => setSelectedId(duplicateInstrument(selected.id))}
          onExport={() => void exportInstrument()}
          onSaveToLibrary={hasStorage() ? () => setSavingId(selected.id) : undefined}
          onDelete={() => removeInstrument(selected.id)}
        />
      )}
      {savingId && doc.entities.instruments[savingId] && (
        <SaveToLibraryDialog source={instrumentLibrary} defaultName={doc.entities.instruments[savingId].name}
          onSave={(values) => void saveToLibrary(values)} onCancel={() => setSavingId(null)} />
      )}
    </div>
  )
}
