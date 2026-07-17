import { useCallback, useMemo, useState } from 'react'
import { useDocStore } from '../state/docStore'
import type { DrumKitInstrument, Id } from '../domain/types'
import { getSlotForNote } from '../domain/types'
import { midiToName } from '../domain/notes'

/** Note name for display. */
function noteLabel(midi: number): string {
  return midiToName(midi)
}

/** White keys in an octave (C, D, E, F, G, A, B). */
const WHITE_KEYS = new Set([0, 2, 4, 5, 7, 9, 11])
function isWhiteKey(midi: number): boolean {
  return WHITE_KEYS.has(((midi % 12) + 12) % 12)
}

/** Effective source info for a note in the key range. */
interface EffectiveSlot {
  label: string
  /** The slot that covers this note (may be inherited from a lower note). */
  slotId: Id | null
  note: number | null    // the slot's own note (null when no slot covers)
  sampleId: Id | null
  instrumentId: Id | null
  pitchOffset: number
  gain: number
  pan: number
  inherited: boolean
}

function getEffective(note: number, kit: DrumKitInstrument, sampleNames: Record<Id, string>, instNames: Record<Id, string>): EffectiveSlot {
  const slot = getSlotForNote(kit, note)
  if (!slot) {
    return { label: '(empty)', slotId: null, note: null, sampleId: null, instrumentId: null, pitchOffset: 0, gain: 1, pan: 0, inherited: false }
  }
  let label = ''
  if (slot.sampleId) label = sampleNames[slot.sampleId] ?? '(deleted)'
  else if (slot.instrumentId) label = instNames[slot.instrumentId] ?? '(deleted)'
  else label = '(unset)'
  return {
    label,
    slotId: slot.id,
    note: slot.note,
    sampleId: slot.sampleId,
    instrumentId: slot.instrumentId,
    pitchOffset: slot.pitchOffset,
    gain: slot.gain,
    pan: slot.pan,
    inherited: slot.note !== note,
  }
}

/** Editor for a single drum kit: vertical piano keys with per-note assignments. */
export function DrumKitEditor({ inst }: { inst: DrumKitInstrument }) {
  const sampleEntities = useDocStore((s) => s.doc.entities.samples)
  const instrumentEntities = useDocStore((s) => s.doc.entities.instruments)
  const addSlot = useDocStore((s) => s.addDrumKitSlot)
  const removeSlot = useDocStore((s) => s.removeDrumKitSlot)
  const setSlotParam = useDocStore((s) => s.setDrumKitSlotParam)
  const setSlotSource = useDocStore((s) => s.setDrumKitSlotSource)
  const setKitParam = useDocStore((s) => s.setDrumKitParam)
  const setKeyRange = useDocStore((s) => s.setDrumKitKeyRange)

  const samples = useMemo(() => Object.values(sampleEntities).sort((a, b) => a.name.localeCompare(b.name)), [sampleEntities])
  const instruments = useMemo(
    () => Object.values(instrumentEntities).filter((i) => i.id !== inst.id).sort((a, b) => a.name.localeCompare(b.name)),
    [instrumentEntities, inst.id],
  )

  const sampleNames = useMemo(() => {
    const m: Record<Id, string> = {}
    for (const s of samples) m[s.id] = s.name
    return m
  }, [samples])

  const instrumentNames = useMemo(() => {
    const m: Record<Id, string> = {}
    for (const i of instruments) m[i.id] = i.name
    return m
  }, [instruments])

  const [selectedNote, setSelectedNote] = useState<number | null>(null)

  // Build the list of notes in the key range (descending — high notes at top).
  const notes = useMemo(() => {
    const result: number[] = []
    for (let n = inst.keyHi; n >= inst.keyLo; n--) result.push(n)
    return result
  }, [inst.keyLo, inst.keyHi])

  // Pre-compute effective slots for all notes.
  const effectiveMap = useMemo(() => {
    const m = new Map<number, EffectiveSlot>()
    for (const n of notes) m.set(n, getEffective(n, inst, sampleNames, instrumentNames))
    return m
  }, [notes, inst, sampleNames, instrumentNames])

  const doAssignSource = useCallback(
    (note: number, sampleId: Id | null, instrumentId: Id | null) => {
      const eff = effectiveMap.get(note)
      if (eff && eff.note === note) {
        // Exact slot exists at this note — update its source.
        setSlotSource(inst.id, eff.slotId!, sampleId, instrumentId)
      } else {
        // Create a new slot at this note.
        addSlot(inst.id, note, sampleId ?? undefined, instrumentId ?? undefined)
      }
    },
    [inst.id, effectiveMap, addSlot, setSlotSource],
  )

  const doClearSlot = useCallback(
    (slotId: Id) => removeSlot(inst.id, slotId),
    [inst.id, removeSlot],
  )

  const doSetParam = useCallback(
    (note: number, key: 'pitchOffset' | 'gain' | 'pan', value: number) => {
      const eff = effectiveMap.get(note)
      if (!eff?.slotId) return
      if (eff.inherited) {
        // Promote: create a new explicit slot at this note with parent's source.
        // Params will be defaults; user can then adjust. This is a two-click flow
        // but avoids async slot-ID chasing.
        addSlot(inst.id, note, eff.sampleId ?? undefined, eff.instrumentId ?? undefined)
      } else {
        setSlotParam(inst.id, eff.slotId, key, value)
      }
    },
    [inst.id, effectiveMap, addSlot, setSlotParam],
  )

  return (
    <div className="drumkit-editor">
      {/* Master gain */}
      <div className="dk-master">
        <label className="mod-param">
          <span className="mod-param-label">
            Master<span className="mod-param-value">{inst.params.gain.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={inst.params.gain}
            onChange={(e) => setKitParam(inst.id, 'gain', Number(e.target.value))}
          />
        </label>
      </div>

      {/* Key range selector */}
      <div className="dk-key-range">
        <span className="dk-add-label">Key range:</span>
        <select
          value={inst.keyLo}
          onChange={(e) => setKeyRange(inst.id, Number(e.target.value), inst.keyHi)}
        >
          {Array.from({ length: 128 }, (_, i) => (
            <option key={i} value={i}>{noteLabel(i)} ({i})</option>
          ))}
        </select>
        <span className="muted">–</span>
        <select
          value={inst.keyHi}
          onChange={(e) => setKeyRange(inst.id, inst.keyLo, Number(e.target.value))}
        >
          {Array.from({ length: 128 }, (_, i) => (
            <option key={i} value={i}>{noteLabel(i)} ({i})</option>
          ))}
        </select>
      </div>

      {/* Piano key rows */}
      <div className="dk-keys">
        {/* Header row */}
        <div className="dk-key-row dk-header">
          <span className="dk-key-label">Key</span>
          <span className="dk-source">Source</span>
          <span className="dk-param-col">Pitch</span>
          <span className="dk-param-col">Gain</span>
          <span className="dk-param-col">Pan</span>
        </div>

        {notes.map((note) => {
          const eff = effectiveMap.get(note)!
          const isSelected = selectedNote === note
          const white = isWhiteKey(note)
          const isExplicit = !eff.inherited && eff.slotId !== null

          // Source value for the dropdown: prefix 's:' for sample, 'i:' for instrument.
          const sourceVal = eff.sampleId ? `s:${eff.sampleId}` : eff.instrumentId ? `i:${eff.instrumentId}` : ''

          return (
            <div
              key={note}
              className={`dk-key-row ${white ? 'white-key' : 'black-key'}${isSelected ? ' selected' : ''}${eff.inherited ? ' inherited' : ''}${!eff.slotId ? ' empty' : ''}`}
              onClick={() => setSelectedNote(note)}
            >
              {/* Note label */}
              <span className="dk-key-label">{noteLabel(note)}</span>

              {/* Source column */}
              <span className="dk-source">
                {isExplicit || isSelected ? (
                  <>
                    <select
                      className="dk-source-select"
                      value={sourceVal}
                      onChange={(e) => {
                        const val = e.target.value
                        if (!val) {
                          if (eff.slotId) doClearSlot(eff.slotId)
                          return
                        }
                        if (val.startsWith('s:')) doAssignSource(note, val.slice(2), null)
                        else if (val.startsWith('i:')) doAssignSource(note, null, val.slice(2))
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <option value="">(unset)</option>
                      {samples.length > 0 && (
                        <optgroup label="Samples">
                          {samples.map((s) => (
                            <option key={`s:${s.id}`} value={`s:${s.id}`}>{s.name}</option>
                          ))}
                        </optgroup>
                      )}
                      {instruments.length > 0 && (
                        <optgroup label="Instruments">
                          {instruments.map((i) => (
                            <option key={`i:${i.id}`} value={`i:${i.id}`}>{i.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {isExplicit && (
                      <button
                        className="dk-clear"
                        title="Remove assignment"
                        onClick={(e) => { e.stopPropagation(); doClearSlot(eff.slotId!) }}
                      >
                        ×
                      </button>
                    )}
                  </>
                ) : (
                  <span className="dk-inherited">
                    <span className="dk-inherit-arrow">← </span>
                    {eff.label}
                  </span>
                )}
              </span>

              {/* Pitch offset */}
              <span className="dk-param-col">
                <input
                  type="number"
                  className="dk-param-input"
                  min={-24}
                  max={24}
                  step={1}
                  value={eff.pitchOffset}
                  readOnly={eff.inherited || !eff.slotId}
                  onChange={(e) => doSetParam(note, 'pitchOffset', Number(e.target.value))}
                  onClick={(e) => e.stopPropagation()}
                />
              </span>

              {/* Gain */}
              <span className="dk-param-col">
                <input
                  type="number"
                  className="dk-param-input"
                  min={0}
                  max={1}
                  step={0.01}
                  value={eff.gain}
                  readOnly={eff.inherited || !eff.slotId}
                  onChange={(e) => doSetParam(note, 'gain', Number(e.target.value))}
                  onClick={(e) => e.stopPropagation()}
                />
              </span>

              {/* Pan */}
              <span className="dk-param-col">
                <input
                  type="number"
                  className="dk-param-input"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={eff.pan}
                  readOnly={eff.inherited || !eff.slotId}
                  onChange={(e) => doSetParam(note, 'pan', Number(e.target.value))}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="dk-pan-indicator">
                  {eff.pan > 0.05 ? 'R' : eff.pan < -0.05 ? 'L' : 'C'}
                </span>
              </span>
            </div>
          )
        })}

        {notes.length === 0 && (
          <p className="muted" style={{ padding: 16 }}>
            No keys in range. Adjust the key range above.
          </p>
        )}
      </div>
    </div>
  )
}
