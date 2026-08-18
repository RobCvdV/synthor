import { useRef, useState } from 'react'
import { Dialog } from './Dialog'

export function EditDialog({
  kind,
  onClose,
  onApplyVolume,
  onApplyFade,
}: {
  kind: 'volume' | 'fadeIn' | 'fadeOut'
  onClose: () => void
  onApplyVolume: (pct: number) => void
  onApplyFade: (from: number, to: number) => void
}) {
  const isFade = kind !== 'volume'
  const [v1, setV1] = useState(isFade ? (kind === 'fadeIn' ? '0' : '100') : '100')
  const [v2, setV2] = useState(isFade ? (kind === 'fadeIn' ? '100' : '0') : '100')
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const apply = () => {
    const a = parseFloat(v1)
    const b = parseFloat(v2)
    if (!isFade) {
      if (!isFinite(a) || a < 0 || a > 1000) {
        setErr('Volume must be 0–1000%')
        return
      }
      onApplyVolume(a)
    } else {
      if (!isFinite(a) || !isFinite(b) || a < 0 || a > 100 || b < 0 || b > 100) {
        setErr('Fade values must be 0–100%')
        return
      }
      onApplyFade(a, b)
    }
    onClose()
  }

  const nudge = (delta: number) => {
    setV1((v) => String(Math.max(0, Math.min(1000, (parseFloat(v) || 100) + delta))))
  }

  return (
    <Dialog onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        {isFade ? (
          <>
            <div className="dialog-row">
              <label>Begin</label>
              <input
                value={v1}
                onChange={(e) => setV1(e.target.value)}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onClose()
                }}
                autoFocus
              />
              <span className="muted">%</span>
            </div>
            <div className="dialog-row">
              <label>End</label>
              <input
                value={v2}
                onChange={(e) => setV2(e.target.value)}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onClose()
                }}
              />
              <span className="muted">%</span>
            </div>
          </>
        ) : (
          <div className="dialog-row">
            <label>Volume</label>
            <input
              ref={inputRef}
              value={v1}
              onChange={(e) => setV1(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose()
              }}
              autoFocus
            />
            <span className="muted">%</span>
            <button type="button" className="octbtn" onClick={() => nudge(-10)}>
              −10
            </button>
            <button type="button" className="octbtn" onClick={() => nudge(10)}>
              +10
            </button>
          </div>
        )}
        {err && <p className="dialog-err">{err}</p>}
        <div className="dialog-actions">
          <button type="submit" className="octbtn">
            OK
          </button>
          <button type="button" className="octbtn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}
