import { memo, useCallback } from 'react'
import type { Instrument } from '../../domain/types'

export interface InstrumentSelectProps {
  instruments: Instrument[]
  value: string
  onChange: (id: string) => void
  className?: string
  title?: string
}

/** Instrument dropdown — reads the list from the caller, handles blur. */
export const InstrumentSelect = memo(function InstrumentSelect({
  instruments, value, onChange, className, title,
}: InstrumentSelectProps) {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value); (e.target as HTMLSelectElement).blur()
  }, [onChange])

  return (
    <select className={className} value={value} onChange={handleChange} title={title}>
      {instruments.map((inst) => (
        <option key={inst.id} value={inst.id}>{inst.name}</option>
      ))}
    </select>
  )
})