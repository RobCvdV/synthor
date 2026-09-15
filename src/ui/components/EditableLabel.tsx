import { memo, useCallback, useRef, useState } from 'react'

export interface EditableLabelProps {
  value: string
  onCommit: (v: string) => void
  /** Commit on blur (Toolbar, ChannelStrip) or cancel (TrackerGrid, ModuleNode, ArrangeTab). */
  commitOnBlur?: boolean
  className: string
  inputClassName: string
  title?: string
}

/** Double-click → inline rename. Enter commits, Escape cancels. */
export const EditableLabel = memo(function EditableLabel({
  value, onCommit, commitOnBlur, className, inputClassName, title,
}: EditableLabelProps) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = useCallback(() => setEditing(true), [])
  const commit = useCallback(() => {
    setEditing(false)
    const v = inputRef.current?.value
    if (v !== undefined && v !== value) onCommit(v)
  }, [onCommit, value])
  const cancel = useCallback(() => setEditing(false), [])

  if (!editing) {
    return (
      <span className={className} title={title ?? 'Double-click to rename'} onDoubleClick={startEdit}>
        {value}
      </span>
    )
  }

  return (
    <input
      ref={inputRef}
      className={inputClassName}
      defaultValue={value}
      autoFocus
      onFocus={(e) => e.target.select()}
      onBlur={() => { commitOnBlur ? commit() : cancel() }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') cancel()
      }}
    />
  )
})