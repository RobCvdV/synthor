import { useCallback, useEffect, useRef } from 'react'
import { useDocStore } from '../state/docStore'
import { usePreviewStore } from '../state/previewStore'
import { useAppStore } from '../state/appStore'
import { codeToSemitone, isEditableTarget } from './keymap'
import { ModularEditor } from './ModularEditor'
import { DrumKitEditor } from './DrumKitEditor'
import { InstrumentSettings } from './InstrumentSettings'
import { cloneInstrument } from '../domain/factory'
import type { AudioHost } from '../audio/host'
import type { KeyboardPlayer } from '../audio/keyboardPlayer'
import type { Id, Instrument } from '../domain/types'

/** Full-screen instruments view: a list rail on the left, the selected
 *  instrument's editor on the right (node graph for synths, key map for drum
 *  kits). All edits go through docStore, so undo/redo + autosave apply.
 *
 *  The note keys audition the selected instrument live (held = gate open, see
 *  KeyboardPlayer); the tracker keymap is inert here (App guards it). Octave is
 *  the global header setting; panic lives in the toolbar. */
export function InstrumentsView({ host, keyboardPlayer }: { host: AudioHost; keyboardPlayer: KeyboardPlayer }) {
  const doc = useDocStore((s) => s.doc)
  const addInstrument = useDocStore((s) => s.addInstrument)
  const removeInstrument = useDocStore((s) => s.removeInstrument)
  const duplicateInstrument = useDocStore((s) => s.duplicateInstrument)

  const noteOn = usePreviewStore((s) => s.noteOn)
  const panic = usePreviewStore((s) => s.panic)
  const activeVoices = usePreviewStore((s) => Object.keys(s.voices).length)

  const instruments = Object.values(doc.entities.instruments)
  const selectedId = useAppStore((s) => s.selectedInstrumentId)
  const setSelectedId = useAppStore((s) => s.setSelectedInstrumentId)

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

  const fileInput = useRef<HTMLInputElement>(null)

  /** Serialize the selected instrument and trigger a download. */
  const exportInstrument = () => {
    if (!selected) return
    const json = JSON.stringify({ schemaVersion: 1, instrument: selected }, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selected.name}.synthor.inst.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  /** Parse an instrument file and add it to the current song with fresh ids. */
  const importInstrument = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file
    if (!f) return
    try {
      const raw = JSON.parse(await f.text())
      if (!raw || typeof raw !== 'object' || !raw.instrument) throw new Error('Not a valid instrument file')
      const inst = raw.instrument as Instrument
      if (inst.kind !== 'modular' && inst.kind !== 'drumkit') throw new Error('Unknown instrument kind')
      // Deep-clone with fresh ids so it never collides with existing instruments.
      const cloned = cloneInstrument(inst, inst.name)
      useDocStore.getState().mutate((draft) => {
        draft.entities.instruments[cloned.id] = cloned
      })
      setSelectedId(cloned.id)
    } catch (err) {
      alert(`Could not import instrument: ${(err as Error).message}`)
    }
  }

  return (
    <div className="instruments-view">
      <aside className="inst-rail">
        <div className="inst-rail-actions">
          <button onClick={() => setSelectedId(addInstrument('modular'))}>+ Synth</button>
          <button onClick={() => setSelectedId(addInstrument('drumkit'))}>+ Drum Kit</button>
          <button onClick={() => fileInput.current?.click()}>Import</button>
        </div>
        <ul className="inst-list">
          {instruments.map((inst) => {
            const uses = usage(inst.id)
            return (
              <li
                key={inst.id}
                className={'inst-item' + (inst.id === selectedId ? ' selected' : '')}
                onClick={() => setSelectedId(inst.id)}
              >
                <span className="inst-kind">{inst.kind === 'modular' ? '▦' : '◆'}</span>
                <span className="inst-name" title={inst.name}>{inst.name}</span>
                <span className="inst-uses" title={`${uses} track(s) use this`}>{uses}</span>
              </li>
            )
          })}
        </ul>
      </aside>

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
          onExport={exportInstrument}
          onDelete={() => removeInstrument(selected.id)}
        />
      )}

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => void importInstrument(e)}
      />
    </div>
  )
}
