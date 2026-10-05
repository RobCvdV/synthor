import { useMemo, useState } from 'react'
import { detectPeriodIn, extractCycle, extractWavetable, loopCycle, sweepWavetable } from '../../audio/cycle'
import { CYCLE_LENGTHS, DEFAULT_CYCLE_LENGTH } from '../../audio/waveGen'
import type { PcmData } from '../../audio/sampleEdit'
import { freqToNote, midiToName } from '../../domain/notes'
import { fitsWaveform } from '../../domain/sampleChoices'
import { Dialog } from '../Dialog'
import { Button } from '../components/Button'
import { Select } from '../components/Select'
import type { Sel } from './selectionGestures'
import s from './SampleEditor.module.css'

const PREVIEW_SECONDS = 1
const SWEEP_SECONDS = 2
/** Wavetable frame counts; 1 is a single cycle. */
export const WAVETABLE_FRAME_COUNTS = [1, 8, 16, 32, 64, 128, 256] as const

/** Turns the selection (or the whole sample) into a single-cycle waveform or a wavetable sample. */
export function MakeCycleDialog({ pcm, range, sampleRate, defaultName, busy, onPreview, onSave, onClose }: {
  pcm: PcmData
  range: Sel
  sampleRate: number
  /** The sample's name; " cycle" or " wavetable" is appended. */
  defaultName: string
  busy: boolean
  onPreview: (data: PcmData) => void
  onSave: (name: string, cycle: PcmData, cycleLength: number) => void
  onClose: () => void
}) {
  const estimate = useMemo(() => detectPeriodIn(pcm, range.start, range.end, sampleRate), [pcm, range, sampleRate])
  const selected = range.end - range.start
  // A cycle-sized selection is meant as the cycle itself; detection is for longer stretches of sound.
  const [useDetected, setUseDetected] = useState(estimate !== null && !fitsWaveform({ frames: selected, sampleRate }))
  const [average, setAverage] = useState(true)
  const [length, setLength] = useState<number>(DEFAULT_CYCLE_LENGTH)
  const [frames, setFrames] = useState(1)
  const [name, setName] = useState<string | null>(null)
  const table = frames > 1
  const shownName = name ?? `${defaultName} ${table ? 'wavetable' : 'cycle'}`

  const period = useDetected && estimate ? estimate.period : selected / frames
  const result = useMemo(
    () => table
      ? extractWavetable(pcm, range.start, range.end, sampleRate, {
        length, frames, average, fallbackPeriod: estimate?.period, detect: useDetected,
      })
      : extractCycle(pcm, range.start, range.end, { length, period: useDetected ? estimate?.period : undefined, average }),
    [pcm, range, sampleRate, length, frames, table, useDetected, estimate, average],
  )

  const preview = () => onPreview(table
    ? sweepWavetable(result, length, period, Math.round(SWEEP_SECONDS * sampleRate))
    : loopCycle(result, period, Math.round(PREVIEW_SECONDS * sampleRate)))

  const save = () => {
    const n = shownName.trim()
    if (n) onSave(n, result, length)
  }

  return (
    <Dialog title={table ? 'Make Wavetable' : 'Make Cycle'} onClose={onClose} className={s.cycleDialog}
      actions={<>
        <Button onClick={preview}>▶ Preview</Button>
        <Button disabled={busy || !shownName.trim()} onClick={save}>{busy ? 'Saving…' : 'Save as Sample'}</Button>
        <Button onClick={onClose}>Cancel</Button>
      </>}>
      <p className="muted">
        Selection: {selected.toLocaleString()} frames ({(sampleRate / selected).toFixed(1)} Hz as one cycle)
        <br />
        {estimate ? describePitch(estimate.frequency, estimate.period) : 'No repeating pitch found in it.'}
      </p>
      <CycleShape data={result[0]} cycleLength={length} />
      <div className="dialog-row">
        <label>Frames</label>
        <Select value={frames} onChange={(e) => setFrames(Number(e.target.value))}>
          {WAVETABLE_FRAME_COUNTS.map((n) => <option key={n} value={n}>{n === 1 ? '1 (single cycle)' : `${n}, across the selection`}</option>)}
        </Select>
      </div>
      <div className="dialog-row">
        <label>Cycle</label>
        <Select value={useDetected ? 'period' : 'whole'} disabled={!estimate}
          onChange={(e) => setUseDetected(e.target.value === 'period')}>
          <option value="period">{table ? 'Detected period' : 'One detected period'}</option>
          <option value="whole">{table ? 'Each part, whole' : 'The whole selection'}</option>
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
          {CYCLE_LENGTHS.map((n) => <option key={n} value={n}>{n} frames{table ? ' each' : ''}</option>)}
        </Select>
      </div>
      <div className="dialog-row">
        <label>Name</label>
        <input value={shownName} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} autoFocus />
      </div>
    </Dialog>
  )
}

function describePitch(frequency: number, period: number): string {
  const { midi, cents } = freqToNote(frequency)
  return `Repeats at ${frequency.toFixed(1)} Hz · ${midiToName(midi)} ${cents >= 0 ? '+' : ''}${cents} ct · ${period.toFixed(1)} frames per period`
}

const SHAPE_POINTS = 256

/** The cycle, or every wavetable frame overlaid, fading from the first to the last. */
function CycleShape({ data, cycleLength }: { data: Float32Array; cycleLength: number }) {
  const count = Math.max(1, Math.floor(data.length / cycleLength))
  const line = (k: number) => Array.from({ length: SHAPE_POINTS + 1 }, (_, i) => {
    const v = data[k * cycleLength + Math.min(cycleLength - 1, Math.floor(i * cycleLength / SHAPE_POINTS))]
    return `${i},${(50 - v * 48).toFixed(1)}`
  }).join(' ')
  return (
    <svg className={s.cycleShape} viewBox={`0 0 ${SHAPE_POINTS} 100`} preserveAspectRatio="none" aria-label="Cycle shape">
      <line x1="0" y1="50" x2={SHAPE_POINTS} y2="50" className={s.cycleAxis} />
      {Array.from({ length: count }, (_, k) => (
        <polyline key={k} points={line(k)} className={s.cycleLine} opacity={count === 1 ? 1 : 0.25 + 0.75 * (1 - k / (count - 1))} />
      ))}
    </svg>
  )
}
