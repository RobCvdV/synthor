export function VerticalFader({ value, onDrag, onCommit }: { value: number; onDrag: (v: number) => void; onCommit: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 80 }}>
      <input type="range" min={0} max={2} step={0.01} value={value}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onDrag(parseFloat(e.target.value))}
        onMouseUp={(e) => onCommit(parseFloat((e.target as HTMLInputElement).value))}
        style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 100, width: 24 }} />
      <div style={{ fontSize: 8, color: '#aaa' }}>{(value * 100).toFixed(0)}%</div>
    </div>
  )
}
