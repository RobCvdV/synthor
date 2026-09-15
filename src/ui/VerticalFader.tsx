import { ParamSlider } from './components/ParamSlider'

export function VerticalFader({ value, onDrag, onCommit }: { value: number; onDrag: (v: number) => void; onCommit: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 80 }}>
      <ParamSlider value={value} min={0} max={2} step={0.01} orientation="vertical"
        onChange={onDrag} onCommit={onCommit}
        formatValue={(v) => `${(v * 100).toFixed(0)}%`} />
    </div>
  )
}