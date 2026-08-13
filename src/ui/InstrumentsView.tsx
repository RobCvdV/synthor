import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocStore } from '../state/docStore'
import { usePreviewStore } from '../state/previewStore'
import { useAppStore } from '../state/appStore'
import { codeToSemitone } from './keymap'
import { LIVE_VOICE_COUNT } from '../engine/voicePool'
import { ModularEditor } from './ModularEditor'
import { DrumKitEditor } from './DrumKitEditor'
import { InstrumentSettings } from './InstrumentSettings'
import { cloneInstrument } from '../domain/factory'
import type { AudioHost } from '../audio/host'
import type { Id, Instrument } from '../domain/types'

/** True when a keystroke should go to a focused form field, not the preview.
 *  Range sliders are excluded — they can't receive text, and we want note
 *  keys to preview the instrument while tweaking sliders. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLInputElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT') return el.type !== 'range'
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** Full-screen instruments view: a list rail on the left, the selected
 *  instrument's editor on the right (node graph for synths, key map for drum
 *  kits). All edits go through docStore, so undo/redo + autosave apply.
 *
 *  The note keys audition the selected instrument live (held = gate open); the
 *  tracker keymap is inert here (App guards it). Octave keys and a panic control
 *  let you test a patch without touching the pattern. */
export function InstrumentsView({ host }: { host: AudioHost }) {
  const doc = useDocStore((s) => s.doc)
  const addInstrument = useDocStore((s) => s.addInstrument)
  const removeInstrument = useDocStore((s) => s.removeInstrument)
  const duplicateInstrument = useDocStore((s) => s.duplicateInstrument)

  const noteOn = usePreviewStore((s) => s.noteOn)
  const noteOff = usePreviewStore((s) => s.noteOff)
  const panic = usePreviewStore((s) => s.panic)
  const activeVoices = usePreviewStore((s) => Object.keys(s.voices).length)

  const instruments = Object.values(doc.entities.instruments)
  const selectedId = useAppStore((s) => s.selectedInstrumentId)
  const setSelectedId = useAppStore((s) => s.setSelectedInstrumentId)
  const [octave, setOctave] = useState(5)
  // Track whether the user has manually adjusted the octave since the last
  // instrument switch, so we don't fight their preference.
  const octaveManualRef = useRef(false)

  // Keep a valid selection as instruments come and go.
  useEffect(() => {
    if (selectedId && doc.entities.instruments[selectedId]) return
    setSelectedId(Object.keys(doc.entities.instruments)[0] ?? null)
  }, [doc.entities.instruments, selectedId])

  // Auto-adjust octave when switching instruments: drumkits default to their
  // keyLo so the keyboard covers the full key range.
  useEffect(() => {
    octaveManualRef.current = false
    if (!selectedId) return
    // Read directly from the store to avoid depending on the reference-changing
    // `doc.entities.instruments` object.
    const inst = useDocStore.getState().doc.entities.instruments[selectedId]
    if (inst?.kind === 'drumkit') {
      setOctave(Math.floor(inst.keyLo / 12))
    }
  }, [selectedId])

  const selected = selectedId ? doc.entities.instruments[selectedId] : undefined

  // Refs so the window key handlers always read the latest values.
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const octaveRef = useRef(octave)
  octaveRef.current = octave
  // Physical key code → the MIDI note it triggered, so key-up releases the
  // exact note even if the octave changed while it was held.
  const heldRef = useRef<Record<string, number>>({})

  // Panic when leaving the view or switching instruments — no stuck notes.
  useEffect(() => {
    heldRef.current = {}
    panic()
  }, [selectedId, panic])
  useEffect(() => () => panic(), [panic])

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.code === 'Escape') {
        e.preventDefault()
        heldRef.current = {}
        panic()
        host.panic()
        return
      }
      if (e.code === 'Minus') { e.preventDefault(); octaveManualRef.current = true; setOctave((o) => Math.max(0, o - 1)); return }
      if (e.code === 'Equal') { e.preventDefault(); octaveManualRef.current = true; setOctave((o) => Math.min(9, o + 1)); return }

      if (e.repeat) return // ignore auto-repeat: one attack per physical press
      const semi = codeToSemitone(e.code)
      const instId = selectedIdRef.current
      if (semi === undefined || !instId) return
      e.preventDefault()
      const note = octaveRef.current * 12 + semi
      heldRef.current[e.code] = note
      // Update previewStore for UI voice counter + fallback compile path,
      // and VoicePool for the audio ref path.
      void host.start().then(() => {
        noteOn(instId, note)
        const kit = useDocStore.getState().doc.entities.instruments[instId]
        host.voicePool(instId, LIVE_VOICE_COUNT, kit?.kind === 'drumkit' ? kit : undefined).noteOn(note, 127)
      })
    },
    [host, noteOn, panic],
  )

  const onKeyUp = useCallback(
    (e: KeyboardEvent) => {
      const note = heldRef.current[e.code]
      if (note === undefined) return
      delete heldRef.current[e.code]
      noteOff(note)
      const instId = selectedIdRef.current
      if (instId) host.voicePool(instId).noteOff(note)
    },
    [host, noteOff],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [onKeyDown, onKeyUp])

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
              <span className="muted">Play keys to preview</span>
              <span className="preview-oct">
                <button onClick={() => { octaveManualRef.current = true; setOctave((o) => Math.max(0, o - 1)) }}>oct −</button>
                <span className="preview-oct-val">oct {octave}</span>
                <button onClick={() => { octaveManualRef.current = true; setOctave((o) => Math.min(9, o + 1)) }}>oct +</button>
              </span>
              <span className="spacer" />
              <span className={'preview-voices' + (activeVoices ? ' on' : '')}>{activeVoices} voice{activeVoices === 1 ? '' : 's'}</span>
              <button
                className="panic-btn"
                title="Stop all preview notes (Esc)"
                onMouseDown={() => { heldRef.current = {}; panic() }}
              >
                Panic
              </button>
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
