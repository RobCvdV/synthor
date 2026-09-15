import { memo, useCallback } from 'react'
import { Dialog } from '../Dialog'

export interface ConfirmDialogProps {
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Yes/No prompt built on Dialog. Danger mode makes the confirm button red. */
export const ConfirmDialog = memo(function ConfirmDialog({
  message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const handleConfirm = useCallback(() => { onConfirm(); onCancel() }, [onConfirm, onCancel])

  return (
    <Dialog onClose={onCancel}>
      <p style={{ margin: '0 0 12px' }}>{message}</p>
      <div className="dialog-actions">
        <button onClick={onCancel}>{cancelLabel}</button>
        <button
          onClick={handleConfirm}
          style={danger ? { background: '#c44', color: '#fff' } : undefined}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
})