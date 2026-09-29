import type { ReactNode } from 'react'
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
  className?: string
}

/** A module param: a dropdown for choices, a slider for numbers. */
export function ParamControl({ param, value, choices, readout, readOnly, onChange, onCommit, className }: ParamControlProps) {
  const labels = choices ?? param.enumLabels
  return (
    <label className={cx(s.param, className)}>
      <span className={s.head}>
        {param.label}
        <span className={s.value}>{readout ?? (labels ? null : round(value))}</span>
      </span>
      {readOnly ? null : labels ? (
        <Select block value={Math.round(value)}
          onChange={(e) => (onCommit ?? onChange)(parseInt(e.target.value))}>
          {(labels.length ? labels : ['(none)']).map((lbl, i) => <option key={i} value={i}>{lbl}</option>)}
        </Select>
      ) : (
        <ParamSlider className={s.slider} value={value} min={param.min} max={param.max} step={param.step}
          onChange={onChange} onCommit={onCommit} />
      )}
    </label>
  )
}
