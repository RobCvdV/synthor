import { useRef, useState } from 'react'
import { Dialog } from '../Dialog'
import { Button } from '../components/Button'

export function EditDialog({
  kind,
  onClose,
  onApplyVolume,
  onApplyFade,
  onApplyPitch,
}: {
  kind: 'volume' | 'fadeIn' | 'fadeOut' | 'pitch'
  onClose: () => void
  onApplyVolume: (pct: number) => void
  onApplyFade: (from: number, to: number) => void
  onApplyPitch: (semitones: number) => void
}) {
  const isFade = kind === 'fadeIn' || kind === 'fadeOut'
  const isPitch = kind === 'pitch'
  const [v1, setV1] = useState(isFade ? (kind === 'fadeIn' ? '0' : '100') : isPitch ? '0' : '100')
  const [v2, setV2] = useState(isFade ? (kind === 'fadeIn' ? '100' : '0') : '100')
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const apply = () => {
    const a = parseFloat(v1)
    const b = parseFloat(v2)
    if (isPitch) {
      if (!isFinite(a) || a < -48 || a > 48) {
        setErr('Pitch must be −48 to 48 semitones')
        return
      }
      onApplyPitch(a)
    } else if (!isFade) {
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
        ) : isPitch ? (
          <div className="dialog-row">
            <label>Pitch</label>
            <input
              value={v1}
              onChange={(e) => setV1(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose()
              }}
              autoFocus
            />
            <span className="muted">semitones (changes the length)</span>
          </div>
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
            <Button onClick={() => nudge(-10)}>
              −10
            </Button>
            <Button onClick={() => nudge(10)}>
              +10
            </Button>
          </div>
        )}
        {err && <p className="dialog-err">{err}</p>}
        <div className="dialog-actions">
          <Button type="submit">
            OK
          </Button>
          <Button onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
