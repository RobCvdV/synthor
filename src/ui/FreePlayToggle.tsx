import { useAppStore } from '../state/appStore'

/** Free play on: the current instrument gets its own live voices (costs DSP).
 *  Off: live notes play through the tracker slots. */
export function FreePlayToggle() {
  const freePlay = useAppStore((s) => s.freePlay)
  const setFreePlay = useAppStore((s) => s.setFreePlay)
  return (
    <button
      className={'octbtn' + (freePlay ? ' active' : '')}
      aria-pressed={freePlay}
      title={freePlay
        ? 'Free play on — the current instrument has its own polyphonic voices'
        : 'Free play off — live notes play through the tracker slots (no extra CPU)'}
      onClick={() => setFreePlay(!freePlay)}
    >
      FREE
    </button>
  )
}
