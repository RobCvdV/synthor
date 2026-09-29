import { sampleChoices } from '../../domain/sampleChoices'
import type { Id, ModuleType } from '../../domain/types'
import { useSortedSamples } from '../hooks/useSortedSamples'
import { ParamControl } from './ParamControl'

/** Dropdown of the samples a module can use; a missing sample shows as "—" until one is picked. */
export function SamplePicker({ moduleType, label, sampleId, onChange, className }: {
  moduleType: ModuleType
  label: string
  sampleId: Id | undefined
  onChange: (sampleId: Id) => void
  className?: string
}) {
  const choices = sampleChoices(moduleType, useSortedSamples())
  const index = choices.findIndex((smp) => smp.id === sampleId)
  const missing = index < 0 && choices.length > 0
  const names = choices.map((smp) => smp.name)
  return (
    <ParamControl className={className}
      param={{ key: 'sampleId', label, min: 0, max: 0, default: 0, step: 1 }}
      value={missing ? 0 : Math.max(index, 0)}
      choices={missing ? ['—', ...names] : names}
      onChange={(i) => {
        const picked = choices[missing ? i - 1 : i]
        if (picked) onChange(picked.id)
      }} />
  )
}
