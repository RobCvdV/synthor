import { useRef } from 'react'

/** Stable ref that always holds the latest value — avoids re-running effects
 *  that read stale closures when their real deps change rarely. */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  ref.current = value
  return ref
}