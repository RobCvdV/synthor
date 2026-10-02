import { useEffect, useRef, useState } from 'react'
import { Dialog } from './Dialog'
import { sampleDialogOpenRef } from './sampleDialogRef'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { useAppStore } from '../state/appStore'
import { writeSampleData } from '../persist/sampleStorage'
import { computeHash } from '../audio/sampleLoader'
import { encodeWav } from '../audio/wav'
import { CYCLE_LENGTHS, DEFAULT_CYCLE_LENGTH, generateWaveform, WAVE_SHAPES, type WaveShape } from '../audio/waveGen'
import { newSampleEntity } from '../domain/factory'
import type { Id } from '../domain/types'
import { Button } from './components/Button'

/** Create a generated single-cycle waveform sample and add it to the song. */
export function CreateSampleDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated?: (id: Id) => void
}) {
  const [shape, setShape] = useState<WaveShape>('sine')
  const [frames, setFrames] = useState<number>(DEFAULT_CYCLE_LENGTH)
  const [name, setName] = useState('sine')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const nameTouchedRef = useRef(false)

  useEffect(() => {
    sampleDialogOpenRef.current = true
    return () => {
      sampleDialogOpenRef.current = false
    }
  }, [])

  const doCreate = async () => {
    const n = name.trim()
    if (!n) {
      setErr('Name is required')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const sr = 48000
      const data = generateWaveform(shape, frames)
      const bytes = encodeWav([data], sr, frames)
      const hash = await computeHash(bytes)
      const slug = useProjectStore.getState().slug
      if (slug) await writeSampleData(slug, hash, bytes)
      const sample = { ...newSampleEntity(n, hash, `${n}.wav`, sr, 1, frames), cycleLength: frames }
      useDocStore.getState().addSampleEntity(sample)
      useAppStore.getState().setSelectedSampleId(sample.id)
      onCreated?.(sample.id)
      onClose()
    } catch (err2) {
      setErr('Failed to create sample: ' + String(err2))
      setBusy(false)
    }
  }

  return (
    <Dialog onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void doCreate()
        }}
      >
        <div className="dialog-row">
          <label>Waveform</label>
          <select
            value={shape}
            onChange={(e) => {
              const s = e.target.value as WaveShape
              setShape(s)
              if (!nameTouchedRef.current) setName(s)
            }}
          >
            {WAVE_SHAPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="dialog-row">
          <label>Length</label>
          <select value={frames} onChange={(e) => setFrames(Number(e.target.value))}>
            {CYCLE_LENGTHS.map((n) => <option key={n} value={n}>{n} frames</option>)}
          </select>
        </div>
        <div className="dialog-row">
          <label>Name</label>
          <input
            value={name}
            onChange={(e) => {
              nameTouchedRef.current = true
              setName(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
            }}
          />
        </div>
        {err && <p className="dialog-err">{err}</p>}
        <div className="dialog-actions">
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
          <Button onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
