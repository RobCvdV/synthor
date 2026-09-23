import { ParamSlider } from './components/ParamSlider'

/** Volume fader for a mixer strip: 40% of the strip's height, shrinking to 60px. */
export function VerticalFader({ value, onDrag, onCommit }: { value: number; onDrag: (v: number) => void; onCommit: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 1 40%', minHeight: 60 }}>
      <ParamSlider value={value} min={0} max={2} step={0.01} orientation="vertical"
        onChange={onDrag} onCommit={onCommit}
        formatValue={(v) => `${(v * 100).toFixed(0)}%`}
        style={{ flex: 1, minHeight: 0 }} />
    </div>
  )
}
