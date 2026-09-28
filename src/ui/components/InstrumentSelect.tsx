import { memo, useCallback } from 'react'
import type { Instrument } from '../../domain/types'

export interface InstrumentSelectProps {
  instruments: Instrument[]
  value: string
  onChange: (id: string) => void
  className?: string
  title?: string
  /** Shown when there are no instruments. */
  emptyLabel?: string
}

/** Instrument dropdown — reads the list from the caller, handles blur. */
export const InstrumentSelect = memo(function InstrumentSelect({
  instruments, value, onChange, className, title, emptyLabel,
}: InstrumentSelectProps) {
  // Blur so note keys don't change the selection afterwards.
  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value) onChange(e.target.value)
    e.target.blur()
  }, [onChange])

  return (
    <select className={className} value={value} onChange={handleChange} title={title}>
      {instruments.length === 0 && emptyLabel && <option value="">{emptyLabel}</option>}
      {instruments.map((inst) => (
        <option key={inst.id} value={inst.id}>{inst.name}</option>
      ))}
    </select>
  )
})