import { useEffect, useState } from 'react'
import { Dialog } from './Dialog'
import { sampleDialogOpenRef } from './sampleDialogRef'
import { Button } from './components/Button'

export function SaveAsDialog({
  defaultName,
  busy,
  onClose,
  onSave,
}: {
  defaultName: string
  busy: boolean
  onClose: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(defaultName)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    sampleDialogOpenRef.current = true
    return () => {
      sampleDialogOpenRef.current = false
    }
  }, [])

  const save = () => {
    const n = name.trim()
    if (!n) {
      setErr('Name is required')
      return
    }
    onSave(n)
  }

  return (
    <Dialog onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <div className="dialog-row">
          <label>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
            }}
            autoFocus
          />
        </div>
        {err && <p className="dialog-err">{err}</p>}
        <div className="dialog-actions">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
