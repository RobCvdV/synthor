import { memo, useCallback, type CSSProperties } from 'react'
import { clamp } from '../format'

export interface ParamSliderProps {
  value: number
  min: number
  max: number
  step?: number
  orientation?: 'horizontal' | 'vertical'
  disabled?: boolean
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  formatValue?: (v: number) => string
  className?: string
  style?: CSSProperties
  title?: string
}

/** One slider for every view. Silent+commit (onChange/onCommit), direct-commit
 *  (onCommit only), vertical, readOnly, and optional value readout. */
export const ParamSlider = memo(function ParamSlider({
  value, min, max, step = 0.01, orientation = 'horizontal', disabled,
  onChange, onCommit, formatValue, className, style, title,
}: ParamSliderProps) {
  const clampedVal = clamp(value, min, max)

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    if (!isNaN(v)) onChange(clamp(v, min, max))
  }, [onChange, min, max])

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    if (onCommit) {
      const v = parseFloat((e.target as HTMLInputElement).value)
      if (!isNaN(v)) onCommit(clamp(v, min, max))
    }
  }, [onCommit, min, max])

  const isVert = orientation === 'vertical'
  const vertStyle: CSSProperties = isVert
    ? { writingMode: 'vertical-lr', direction: 'rtl', width: 14, height: '100%' }
    : { width: style?.width ?? '100%', height: style?.height ?? 14 }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, ...style }}>
      <input
        type="range"
        className={className}
        min={min}
        max={max}
        step={step}
        value={clampedVal}
        disabled={disabled}
        title={title}
        onChange={handleChange}
        onMouseUp={handleMouseUp}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ...vertStyle, ...(disabled ? { opacity: 0.4 } : {}) }}
      />
      {formatValue && (
        <span style={{ fontSize: 10, color: 'var(--muted)', minWidth: 32, textAlign: 'right' }}>
          {formatValue(clampedVal)}
        </span>
      )}
    </span>
  )
})