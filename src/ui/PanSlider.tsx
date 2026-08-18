/** Pan/balance slider used by the mixer strips. */
export function PanSlider({ value, onSilent, onCommit }: { value: number; onSilent: (pan: number) => void; onCommit: (pan: number) => void }) {
  return (
    <input type="range" min={-1} max={1} step={0.01} value={value}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => onSilent(parseFloat(e.target.value))}
      onMouseUp={(e) => onCommit(parseFloat((e.target as HTMLInputElement).value))}
      style={{ width: '100%', height: 14 }} />
  )
}
