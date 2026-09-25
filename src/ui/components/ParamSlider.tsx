import { memo, useCallback } from 'react'
import { clamp } from '../format'
import { cx } from './cx'
import s from './ParamSlider.module.css'

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
  /** Applied to the outer element. */
  className?: string
  title?: string
}

/** One slider for every view. Silent+commit (onChange/onCommit), direct-commit
 *  (onCommit only), vertical, readOnly, and optional value readout. */
export const ParamSlider = memo(function ParamSlider({
  value, min, max, step = 0.01, orientation = 'horizontal', disabled,
  onChange, onCommit, formatValue, className, title,
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

  return (
    <span className={cx(s.slider, orientation === 'vertical' && s.vertical, className)}>
      <input
        type="range"
        className={s.input}
        min={min}
        max={max}
        step={step}
        value={clampedVal}
        disabled={disabled}
        title={title}
        onChange={handleChange}
        onMouseUp={handleMouseUp}
        onMouseDown={(e) => e.stopPropagation()}
      />
      {formatValue && <span className={s.readout}>{formatValue(clampedVal)}</span>}
    </span>
  )
})
