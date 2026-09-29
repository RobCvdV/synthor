import { useMemo } from 'react'
import { useDocStore } from '../../state/docStore'
import { sortSamples } from '../../domain/sampleChoices'
import type { SampleEntity } from '../../domain/types'

/** Name-sorted sample list, stable across unrelated doc edits (immer keeps entity references identical). */
export function useSortedSamples(): SampleEntity[] {
  const samples = useDocStore((s) => s.doc.entities.samples)
  return useMemo(() => sortSamples(samples), [samples])
}
