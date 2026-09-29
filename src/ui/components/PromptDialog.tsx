import { useRef, useState } from 'react'
import { Dialog } from '../Dialog'
import { Button } from './Button'
import s from './PromptDialog.module.css'

export interface PromptDialogProps {
  message: string
  defaultValue: string
  confirmLabel?: string
  validate?: (value: string) => string | null
  onSubmit: (value: string) => void
  onCancel: () => void
}

/** Text prompt built on Dialog; the confirm button stays disabled while `validate` reports an error. */
export function PromptDialog({ message, defaultValue, confirmLabel = 'OK', validate, onSubmit, onCancel }: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const error = validate?.(value) ?? null
  const submit = () => { if (!error) onSubmit(value.trim()) }

  return (
    <Dialog onClose={onCancel} err={error} initialFocusRef={inputRef}
      actions={<>
        <Button onClick={onCancel}>Cancel</Button>
        <Button active disabled={error !== null} onClick={submit}>{confirmLabel}</Button>
      </>}>
      <p>{message}</p>
      <input ref={inputRef} className={s.input} value={value} aria-label={message}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
    </Dialog>
  )
}
