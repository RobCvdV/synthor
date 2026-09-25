import { memo, useCallback } from 'react'
import { Dialog } from '../Dialog'
import { Button } from './Button'

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
      <p>{message}</p>
      <div className="dialog-actions">
        <Button onClick={onCancel}>{cancelLabel}</Button>
        <Button active={danger} tone="danger" onClick={handleConfirm}>{confirmLabel}</Button>
      </div>
    </Dialog>
  )
})