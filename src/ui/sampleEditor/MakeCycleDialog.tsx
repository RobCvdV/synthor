import { useMemo, useState } from 'react'
import { detectPeriodIn, extractCycle, loopCycle } from '../../audio/cycle'
import type { PcmData } from '../../audio/sampleEdit'
import { freqToNote, midiToName } from '../../domain/notes'
import { Dialog } from '../Dialog'
import { Button } from '../components/Button'
import { Select } from '../components/Select'
import type { Sel } from './selectionGestures'
import s from './SampleEditor.module.css'

export const CYCLE_LENGTHS = [256, 512, 1024, 2048, 4096] as const
const PREVIEW_SECONDS = 1

/** Turns the selection (or the whole sample) into a single-cycle waveform sample. */
export function MakeCycleDialog({ pcm, range, sampleRate, defaultName, busy, onPreview, onSave, onClose }: {
  pcm: PcmData
  range: Sel
  sampleRate: number
  defaultName: string
  busy: boolean
  onPreview: (data: PcmData) => void
  onSave: (name: string, cycle: PcmData) => void
  onClose: () => void
}) {
  const estimate = useMemo(() => detectPeriodIn(pcm, range.start, range.end, sampleRate), [pcm, range, sampleRate])
  const [useDetected, setUseDetected] = useState(estimate !== null)
  const [average, setAverage] = useState(true)
  const [length, setLength] = useState(2048)
  const [name, setName] = useState(defaultName)

  const period = useDetected && estimate ? estimate.period : range.end - range.start
  const cycle = useMemo(
    () => extractCycle(pcm, range.start, range.end, { length, period: useDetected ? estimate?.period : undefined, average }),
    [pcm, range, length, useDetected, estimate, average],
  )

  const save = () => {
    const n = name.trim()
    if (n) onSave(n, cycle)
  }

  return (
    <Dialog title="Make Cycle" onClose={onClose} className={s.cycleDialog}
      actions={<>
        <Button onClick={() => onPreview(loopCycle(cycle, period, Math.round(PREVIEW_SECONDS * sampleRate)))}>▶ Preview</Button>
        <Button disabled={busy || !name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save as Sample'}</Button>
        <Button onClick={onClose}>Cancel</Button>
      </>}>
      <p className="muted">{estimate ? describePitch(estimate.frequency, estimate.period) : 'No clear pitch in the selection.'}</p>
      <CycleShape data={cycle[0]} />
      <div className="dialog-row">
        <label>Cycle</label>
        <Select value={useDetected ? 'period' : 'whole'} disabled={!estimate}
          onChange={(e) => setUseDetected(e.target.value === 'period')}>
          <option value="period">One detected period</option>
          <option value="whole">The whole selection</option>
        </Select>
      </div>
      <div className="dialog-row">
        <label>Average</label>
        <input type="checkbox" checked={average} disabled={!useDetected} onChange={(e) => setAverage(e.target.checked)} />
        <span className="muted">all periods</span>
      </div>
      <div className="dialog-row">
        <label>Length</label>
        <Select value={length} onChange={(e) => setLength(Number(e.target.value))}>
          {CYCLE_LENGTHS.map((n) => <option key={n} value={n}>{n} frames</option>)}
        </Select>
      </div>
      <div className="dialog-row">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} autoFocus />
      </div>
    </Dialog>
  )
}

function describePitch(frequency: number, period: number): string {
  const { midi, cents } = freqToNote(frequency)
  return `Detected ${frequency.toFixed(1)} Hz · ${midiToName(midi)} ${cents >= 0 ? '+' : ''}${cents} ct · ${period.toFixed(1)} frames per period`
}

const SHAPE_POINTS = 256

function CycleShape({ data }: { data: Float32Array }) {
  const points = Array.from({ length: SHAPE_POINTS + 1 }, (_, i) => {
    const v = data[Math.min(data.length - 1, Math.floor(i * data.length / SHAPE_POINTS))]
    return `${i},${(50 - v * 48).toFixed(1)}`
  }).join(' ')
  return (
    <svg className={s.cycleShape} viewBox={`0 0 ${SHAPE_POINTS} 100`} preserveAspectRatio="none" aria-label="Cycle shape">
      <line x1="0" y1="50" x2={SHAPE_POINTS} y2="50" className={s.cycleAxis} />
      <polyline points={points} className={s.cycleLine} />
    </svg>
  )
}
