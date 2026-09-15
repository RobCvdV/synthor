import { ParamSlider } from './components/ParamSlider'

/** Pan/balance slider used by the mixer strips. */
export function PanSlider({ value, onSilent, onCommit }: { value: number; onSilent: (pan: number) => void; onCommit: (pan: number) => void }) {
  return (
    <ParamSlider value={value} min={-1} max={1} step={0.01}
      onChange={onSilent} onCommit={onCommit}
      style={{ display: 'block', width: '100%' }} />
  )
}