import { useEffect, useRef, useState } from 'react'
import { loadStartupSong } from './songActions'

/** Loads the last session's song once; false until it's in place, so the placeholder doc never renders. */
export function useStartupSong(): boolean {
  const [ready, setReady] = useState(false)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void loadStartupSong().then(() => setReady(true))
  }, [])
  return ready
}
