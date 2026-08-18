import { useEffect, useRef, useState } from 'react'
import { Dialog } from './Dialog'
import { sampleDialogOpenRef } from './sampleDialogRef'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { useAppStore } from '../state/appStore'
import { writeSampleData } from '../persist/sampleStorage'
import { computeHash } from '../audio/sampleLoader'
import { encodeWav } from '../audio/wav'
import { generateWaveform, WAVE_SHAPES, type WaveShape } from '../audio/waveGen'
import { newSampleEntity } from '../domain/factory'
import { WAVEFORM_MAX_LENGTH_SECONDS } from '../domain/moduleDefs'
import type { Id } from '../domain/types'

/** Create a generated waveform sample and add it to the song. */
export function CreateSampleDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated?: (id: Id) => void
}) {
  const [shape, setShape] = useState<WaveShape>('sine')
  const [length, setLength] = useState('0.25')
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
    const len = parseFloat(length)
    if (!isFinite(len) || len <= 0.001 || len > 30) {
      setErr('Length must be 0.001–30 seconds')
      return
    }
    const n = name.trim()
    if (!n) {
      setErr('Name is required')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const sr = 44100
      const frames = Math.max(1, Math.round(len * sr))
      const data = generateWaveform(shape, frames)
      const bytes = encodeWav([data], sr)
      const hash = await computeHash(bytes)
      const slug = useProjectStore.getState().slug
      if (slug) await writeSampleData(slug, hash, bytes)
      const sample = newSampleEntity(n, hash, `${n}.wav`, sr, 1, frames)
      useDocStore.getState().addSampleEntity(sample)
      useAppStore.getState().setSelectedSampleId(sample.id)
      onCreated?.(sample.id)
      onClose()
    } catch (err2) {
      setErr('Failed to create sample: ' + String(err2))
      setBusy(false)
    }
  }

  const lenNum = parseFloat(length)
  const tooLong = isFinite(lenNum) && lenNum > WAVEFORM_MAX_LENGTH_SECONDS

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
          <input
            value={length}
            onChange={(e) => setLength(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
            }}
            autoFocus
          />
          <span className="muted">s</span>
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
        {tooLong && <p className="dialog-err">Longer than {WAVEFORM_MAX_LENGTH_SECONDS}s won't appear in wave module pickers.</p>}
        {err && <p className="dialog-err">{err}</p>}
        <div className="dialog-actions">
          <button type="submit" className="octbtn" disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
          <button type="button" className="octbtn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}
