import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDocStore } from '../state/docStore'
import type { DrumKitInstrument } from '../domain/types'
import { midiToName } from '../domain/notes'

/** Note names for display. */
function noteLabel(note: number): string {
  return `${midiToName(note)} (${note})`
}

/** Editor for a single drum kit: add/remove slots, tweak per-slot params. */
export function DrumKitEditor({ inst }: { inst: DrumKitInstrument }) {
  const sampleEntities = useDocStore((s) => s.doc.entities.samples)
  const samples = useMemo(() => Object.values(sampleEntities), [sampleEntities])
  const addSlot = useDocStore((s) => s.addDrumKitSlot)
  const removeSlot = useDocStore((s) => s.removeDrumKitSlot)
  const setSlotParam = useDocStore((s) => s.setDrumKitSlotParam)
  const setKitParam = useDocStore((s) => s.setDrumKitParam)

  const [newLo, setNewLo] = useState(36)
  const [newHi, setNewHi] = useState(36)
  const [newSample, setNewSample] = useState(samples[0]?.id ?? '')

  // Keep newSample in sync when the sample list changes.
  useEffect(() => {
    if (samples.length === 0) {
      setNewSample('')
    } else if (!samples.find((s) => s.id === newSample)) {
      setNewSample(samples[0].id)
    }
  }, [samples, newSample])

  const doAdd = useCallback(() => {
    if (!newSample) return
    addSlot(inst.id, newLo, newHi, newSample)
    setNewLo(newHi + 1)
    setNewHi(newHi + 1)
  }, [inst.id, newLo, newHi, newSample, addSlot])

  const sampleOptions = samples.map((s) => ({ id: s.id, name: s.name }))

  return (
    <div className="drumkit-editor">
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

      <div className="dk-add">
        <span className="dk-add-label">Note range:</span>
        <select value={newLo} onChange={(e) => setNewLo(Number(e.target.value))}>
          {Array.from({ length: 128 }, (_, i) => (
            <option key={i} value={i}>{noteLabel(i)}</option>
          ))}
        </select>
        <span className="muted">–</span>
        <select value={newHi} onChange={(e) => setNewHi(Number(e.target.value))}>
          {Array.from({ length: 128 }, (_, i) => (
            <option key={i} value={i}>{noteLabel(i)}</option>
          ))}
        </select>
        <span className="dk-add-label">Sample:</span>
        <select value={newSample} onChange={(e) => setNewSample(e.target.value)}>
          {sampleOptions.length === 0 && (
            <option value="">(no samples)</option>
          )}
          {sampleOptions.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button onClick={doAdd} disabled={!newSample || sampleOptions.length === 0}>
          + Add Slot
        </button>
      </div>

      {inst.slots.length === 0 && (
        <p className="muted" style={{ padding: 16 }}>
          No slots. Add a note range and sample above.
        </p>
      )}

      <table className="dk-slots">
        <thead>
          <tr>
            <th>Note</th>
            <th>Sample</th>
            <th>Pitch</th>
            <th>Gain</th>
            <th>Pan</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {inst.slots.map((slot) => {
            const sampleName = samples.find((s) => s.id === slot.sampleId)?.name ?? '(deleted)'
            return (
              <tr key={slot.id}>
                <td className="dk-note-range">
                  {slot.noteLo === slot.noteHi ? noteLabel(slot.noteLo) : `${noteLabel(slot.noteLo)} – ${noteLabel(slot.noteHi)}`}
                </td>
                <td>{sampleName}</td>
                <td className="dk-param">
                  <input
                    type="range"
                    min={-24}
                    max={24}
                    step={1}
                    value={slot.pitchOffset}
                    onChange={(e) => setSlotParam(inst.id, slot.id, 'pitchOffset', Number(e.target.value))}
                  />
                  <span>{slot.pitchOffset > 0 ? '+' : ''}{slot.pitchOffset}</span>
                </td>
                <td className="dk-param">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={slot.gain}
                    onChange={(e) => setSlotParam(inst.id, slot.id, 'gain', Number(e.target.value))}
                  />
                  <span>{slot.gain.toFixed(2)}</span>
                </td>
                <td className="dk-param">
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={slot.pan}
                    onChange={(e) => setSlotParam(inst.id, slot.id, 'pan', Number(e.target.value))}
                  />
                  <span>{slot.pan > 0 ? 'R' : slot.pan < 0 ? 'L' : 'C'}</span>
                </td>
                <td>
                  <button className="mod-del" title="Remove slot" onClick={() => removeSlot(inst.id, slot.id)}>
                    ×
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
