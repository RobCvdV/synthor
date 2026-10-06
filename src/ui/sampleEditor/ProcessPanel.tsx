import { Button } from '../components/Button'
import { ParamSlider } from '../components/ParamSlider'
import type { LiveContext, LiveParam, LiveProcessDef } from './liveProcesses'
import s from './SampleEditor.module.css'

/** Sliders for a live process; the editor shows and plays the result until Done or Cancel. */
export function ProcessPanel({ def, values, ctx, target, busy, onChange, onLoop, onDone, onCancel }: {
  def: LiveProcessDef
  values: Record<string, number>
  ctx: LiveContext
  /** What it applies to, e.g. "selection". */
  target: string
  busy: boolean
  onChange: (key: string, value: number) => void
  /** Plays the processed range in a loop. */
  onLoop: () => void
  onDone: () => void
  onCancel: () => void
}) {
  return (
    <div className={s.processPanel} role="group" aria-label={def.title}>
      <strong>{def.title}</strong>
      <span className="muted">{target}</span>
      {def.params.map((p) => (
        <label key={p.key} className={s.processParam}>
          <span>{p.label}</span>
          <ParamSlider value={values[p.key]} min={p.min} max={p.max} step={p.step}
            onChange={(v) => onChange(p.key, v)} className={s.processSlider} />
          <ValueInput param={p} value={values[p.key]} onChange={(v) => onChange(p.key, v)} onDone={onDone} onCancel={onCancel} />
          <span className="muted">{p.unit}</span>
          {p.describe && <span className={s.processInfo}>{p.describe(values[p.key], ctx)}</span>}
        </label>
      ))}
      <span className={s.spacer} />
      <Button onClick={onLoop} title="Loop the processed range while tuning (Space plays as usual)">▶ Loop</Button>
      <Button onClick={onCancel} title="Back to the original (Esc)">Cancel</Button>
      <Button disabled={busy} onClick={onDone} title="Apply as one undoable edit (Enter)">Done</Button>
    </div>
  )
}

/** Exact entry next to the slider; out-of-range values are clamped. */
function ValueInput({ param: p, value, onChange, onDone, onCancel }: {
  param: LiveParam
  value: number
  onChange: (v: number) => void
  onDone: () => void
  onCancel: () => void
}) {
  return (
    <input type="number" className={s.processNumber} aria-label={p.label}
      min={p.min} max={p.max} step={p.step} value={Number(value.toFixed(2))}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const v = parseFloat(e.target.value)
        if (isFinite(v)) onChange(Math.max(p.min, Math.min(p.max, v)))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone()
        else if (e.key === 'Escape') onCancel()
        else return
        e.preventDefault()
        e.stopPropagation()
      }} />
  )
}
