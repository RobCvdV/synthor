import { useEffect, useState, type InputHTMLAttributes } from 'react'

export interface NameInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string
  /** Called with the trimmed name on blur or Enter, only when it changed and isn't empty. */
  onCommit: (name: string) => void
}

/** A text field for names: edits stay local until blur or Enter, Escape reverts. */
export function NameInput({ value, onCommit, onBlur, onKeyDown, ...rest }: NameInputProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const commit = () => {
    const name = draft.trim()
    if (name && name !== value) onCommit(name)
    else setDraft(value)
  }

  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => { commit(); onBlur?.(e) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') { setDraft(value); e.stopPropagation() }
        onKeyDown?.(e)
      }}
    />
  )
}
