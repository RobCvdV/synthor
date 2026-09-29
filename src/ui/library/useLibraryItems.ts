import { useCallback, useEffect, useState } from 'react'
import type { LibraryItem } from '../../domain/library'
import { listLibraryInstruments } from '../../persist/instrumentLibrary'
import { hasStorage } from '../../persist/storage'

/** The library's instruments (null while loading), with a way to patch or reload the list. */
export function useLibraryItems() {
  const [items, setItems] = useState<LibraryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    if (!hasStorage()) {
      setItems([])
      return
    }
    listLibraryInstruments().then(setItems, (err: Error) => {
      setItems([])
      setError(err.message)
    })
  }, [])
  useEffect(reload, [reload])

  const replaceItem = useCallback((item: LibraryItem) => {
    setItems((prev) => prev && prev.map((i) => (i.id === item.id ? item : i)))
  }, [])
  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev && prev.filter((i) => i.id !== id))
  }, [])

  return { items, error, reload, replaceItem, removeItem }
}
