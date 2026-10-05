import { useRef, useState, type KeyboardEvent } from 'react'
import { parseHex } from '../../domain/effects'
import type { RangeAnswer } from '../../state/dialogStore'
import { Dialog } from '../Dialog'
import { Button } from './Button'
import s from './RangeDialog.module.css'

export interface RangeDialogProps {
  message: string
  start: string
  end: string
  confirmLabel?: string
  onSubmit: (value: RangeAnswer) => void
  onCancel: () => void
}

/** Start/end prompt for two hex values (00–FF). */
export function RangeDialog({ message, start, end, confirmLabel = 'OK', onSubmit, onCancel }: RangeDialogProps) {
  const [from, setFrom] = useState(start)
  const [to, setTo] = useState(end)
  const startRef = useRef<HTMLInputElement>(null)
  const a = parseHex(from)
  const b = parseHex(to)
  const touched = from.trim() !== '' && to.trim() !== ''
  const error = a === null || b === null ? (touched ? 'Enter hex values 00–FF' : '') : null
  const submit = () => { if (a !== null && b !== null) onSubmit({ start: a, end: b }) }
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Enter') submit() }

  return (
    <Dialog onClose={onCancel} err={error || null} initialFocusRef={startRef}
      actions={<>
        <Button onClick={onCancel}>Cancel</Button>
        <Button active disabled={error !== null} onClick={submit}>{confirmLabel}</Button>
      </>}>
      <p>{message}</p>
      <div className={s.fields}>
        <label>Start <input ref={startRef} className={s.input} value={from} maxLength={2} placeholder="00"
          onChange={(e) => setFrom(e.target.value)} onKeyDown={onKeyDown} /></label>
        <label>End <input className={s.input} value={to} maxLength={2} placeholder="FF"
          onChange={(e) => setTo(e.target.value)} onKeyDown={onKeyDown} /></label>
      </div>
    </Dialog>
  )
}
