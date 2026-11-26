import { useState, type ReactNode } from 'react'
import type { ParamDef } from '../../domain/moduleDefs'
import { round } from '../format'
import { cx } from './cx'
import { ParamSlider } from './ParamSlider'
import { Select } from './Select'
import s from './ParamControl.module.css'

export interface ParamControlProps {
  param: ParamDef
  value: number
  /** Overrides `param.enumLabels`, e.g. with the sample names. */
  choices?: string[]
  /** Replaces the value shown next to the label. */
  readout?: ReactNode
  /** Label and readout only, e.g. when the value is set by learning. */
  readOnly?: boolean
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  /** Slider drags only move a local value; the change is sent once, on release
   *  (through onCommit, else onChange). For params that recompile the graph. */
  deferred?: boolean
  className?: string
}

/** A module param: a dropdown for choices, a slider for numbers. */
export function ParamControl({ param, value, choices, readout, readOnly, onChange, onCommit, deferred, className }: ParamControlProps) {
  const labels = choices ?? param.enumLabels
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value
  const release = (v: number) => {
    setDraft(null)
    ;(onCommit ?? onChange)(v)
  }
  return (
    <label className={cx(s.param, className)}>
      <span className={s.head}>
        {param.label}
        <span className={s.value}>{readout ?? (labels ? null : round(shown))}</span>
      </span>
      {readOnly ? null : labels ? (
        <Select block value={Math.round(value)}
          onChange={(e) => (onCommit ?? onChange)(parseInt(e.target.value))}>
          {(labels.length ? labels : ['(none)']).map((lbl, i) => <option key={i} value={i}>{lbl}</option>)}
        </Select>
      ) : (
        <ParamSlider className={s.slider} value={shown} min={param.min} max={param.max} step={param.step}
          onChange={deferred ? setDraft : onChange} onCommit={deferred ? release : onCommit} />
      )}
    </label>
  )
}
