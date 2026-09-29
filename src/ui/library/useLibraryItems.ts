import { useCallback, useEffect, useState } from 'react'
import type { LibraryItem } from '../../domain/library'
import { hasStorage } from '../../persist/storage'

/** A library's items (null while loading), with ways to patch the list. `list` must be stable. */
export function useLibraryItems<T extends LibraryItem>(list: () => Promise<T[]>) {
  const [items, setItems] = useState<T[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    if (!hasStorage()) {
      setItems([])
      return
    }
    list().then(setItems, (err: Error) => {
      setItems([])
      setError(err.message)
    })
  }, [list])
  useEffect(reload, [reload])

  const replaceItem = useCallback((item: T) => {
    setItems((prev) => prev && prev.map((i) => (i.id === item.id ? item : i)))
  }, [])
  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev && prev.filter((i) => i.id !== id))
  }, [])

  return { items, error, reload, replaceItem, removeItem }
}
