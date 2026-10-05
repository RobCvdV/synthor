import { useDialogStore } from '../../state/dialogStore'
import { ConfirmDialog } from './ConfirmDialog'
import { PromptDialog } from './PromptDialog'
import { RangeDialog } from './RangeDialog'

/** Renders the pending `askConfirm` / `askText` / `askRange` dialog; mounted once in App. */
export function DialogHost() {
  const request = useDialogStore((s) => s.request)
  const answer = useDialogStore((s) => s.answer)
  if (!request) return null
  if (request.kind === 'text') {
    return (
      <PromptDialog message={request.message} defaultValue={request.defaultValue}
        confirmLabel={request.confirmLabel} validate={request.validate}
        onSubmit={answer} onCancel={() => answer(null)} />
    )
  }
  if (request.kind === 'range') {
    return (
      <RangeDialog message={request.message} start={request.start} end={request.end}
        confirmLabel={request.confirmLabel} onSubmit={answer} onCancel={() => answer(null)} />
    )
  }
  return (
    <ConfirmDialog message={request.message} confirmLabel={request.confirmLabel} cancelLabel={request.cancelLabel} danger={request.danger}
      onConfirm={() => answer(true)} onCancel={() => answer(false)} />
  )
}
