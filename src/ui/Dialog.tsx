import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

interface DialogProps {
  title?: string
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
  err?: string | null
  /** Focused and text-selected on mount, when given. */
  initialFocusRef?: RefObject<HTMLInputElement | null>
}

/** Modal shell shared by all dialogs — overlay click and Escape close it. */
export function Dialog({ title, onClose, children, actions, err, initialFocusRef }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = initialFocusRef?.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [initialFocusRef])

  return (
    <div
      ref={overlayRef}
      className="dialog-overlay"
      tabIndex={-1}
      autoFocus
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
        {title && <h3>{title}</h3>}
        {children}
        {err && <div className="dialog-err">{err}</div>}
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  )
}
