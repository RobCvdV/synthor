import { useMemo } from 'react'
import { useDocStore } from '../../state/docStore'
import type { SampleEntity } from '../../domain/types'

/** Name-sorted sample list, stable across unrelated doc edits (immer keeps
 *  entity references identical).  The sort order must match the engine's
 *  sample-table order so dropdowns and table-key lookups are consistent. */
export function useSortedSamples(): SampleEntity[] {
  const samples = useDocStore((s) => s.doc.entities.samples)
  return useMemo(
    () => [...Object.values(samples)].sort((a, b) => a.name.localeCompare(b.name)),
    [samples],
  )
}