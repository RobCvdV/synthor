/**
 * The Game screen's settings fields. Text edits stay local until blur or
 * Enter (one undo step per change), Escape reverts; selects and toggles
 * commit at once.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { formatNotes, formatTracks, parseNotes, parseTracks } from '../../domain/gameEdit'
import { Select } from '../components/Select'
import { cx } from '../components/cx'
import s from './GameView.module.css'

interface DraftProps {
  value: string
  /** Called with the text on blur or Enter when it changed; false rejects it (the field reverts) */
  onCommit: (text: string) => boolean | void
  title?: string
  width?: number
  placeholder?: string
}

function DraftInput({ value, onCommit, title, width, placeholder }: DraftProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft === value) return
    if (onCommit(draft) === false) setDraft(value)
  }
  return (
    <input
      className={s.field}
      style={width ? { width } : undefined}
      value={draft}
      title={title}
      placeholder={placeholder}
      aria-label={title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') { setDraft(value); e.stopPropagation() }
      }}
    />
  )
}

export function TextField(props: DraftProps) {
  return <DraftInput {...props} />
}

interface NumberProps {
  value: number | undefined
  onCommit: (value: number | undefined) => void
  min?: number
  max?: number
  /** Whole numbers only */
  int?: boolean
  /** Empty is allowed (and means none) */
  optional?: boolean
  title?: string
  width?: number
}

export function NumberField({ value, onCommit, min = -Infinity, max = Infinity, int, optional, title, width = 52 }: NumberProps) {
  return (
    <DraftInput
      value={value === undefined ? '' : String(value)}
      title={title}
      width={width}
      placeholder={optional ? '—' : undefined}
      onCommit={(text) => {
        if (text.trim() === '') {
          if (!optional) return false
          onCommit(undefined)
          return
        }
        const n = Number(text)
        if (!Number.isFinite(n)) return false
        onCommit(Math.min(max, Math.max(min, int ? Math.round(n) : n)))
      }}
    />
  )
}

export function TracksField({ value, onCommit, title, width = 90 }: { value: number[]; onCommit: (t: number[]) => void; title?: string; width?: number }) {
  return <DraftInput value={formatTracks(value)} title={title} width={width} placeholder="—" onCommit={(text) => onCommit(parseTracks(text))} />
}

export function NotesField({ value, onCommit, title }: { value: number[]; onCommit: (n: number[]) => void; title?: string }) {
  return <DraftInput value={formatNotes(value)} title={title} width={180} onCommit={(text) => onCommit(parseNotes(text))} />
}

interface ChoiceProps {
  value: string | undefined
  choices: string[]
  onChange: (value: string | undefined) => void
  /** Offer "none" (undefined) */
  none?: string
  title?: string
}

/** A select over names; a value not among them (a reference by id) is still shown */
export function ChoiceField({ value, choices, onChange, none, title }: ChoiceProps) {
  const options = value !== undefined && !choices.includes(value) ? [value, ...choices] : choices
  return (
    <Select small value={value ?? ''} title={title} aria-label={title} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}>
      {none !== undefined && <option value="">{none}</option>}
      {options.map((c) => <option key={c} value={c}>{c}</option>)}
    </Select>
  )
}

export function CheckField({ value, onChange, title, children }: { value: boolean; onChange: (v: boolean) => void; title?: string; children?: ReactNode }) {
  return (
    <label className={s.check} title={title}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

/** Toggles for picking several names */
export function Chips({ options, selected, onToggle, title }: { options: string[]; selected: string[]; onToggle: (name: string) => void; title?: string }) {
  return (
    <span className={s.chips} title={title}>
      {options.map((o) => (
        <button type="button" key={o} className={cx(s.chip, selected.includes(o) && s.chipOn)} aria-pressed={selected.includes(o)} onClick={() => onToggle(o)}>
          {o}
        </button>
      ))}
    </span>
  )
}

/** Remove a row */
export function RemoveButton({ onClick, title }: { onClick: () => void; title: string }) {
  return <button type="button" className={s.remove} title={title} aria-label={title} onClick={onClick}>×</button>
}
