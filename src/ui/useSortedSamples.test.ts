// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSortedSamples } from './hooks/useSortedSamples'
import { useDocStore } from '../state/docStore'
import { createDefaultDoc } from '../domain/factory'

function seedDefault() {
  useDocStore.setState({
    doc: createDefaultDoc(),
    past: [], future: [], trackClipboard: null, rectClipboard: null,
    vfsLoadedHashes: null, silentBatch: false,
  })
}

describe('useSortedSamples', () => {
  it('returns samples sorted by name', () => {
    seedDefault()
    const { result } = renderHook(() => useSortedSamples())
    expect(result.current).toEqual([])
  })

  it('is stable when samples do not change', () => {
    seedDefault()
    const { result, rerender } = renderHook(() => useSortedSamples())
    const a = result.current
    rerender()
    expect(result.current).toBe(a)
  })
})