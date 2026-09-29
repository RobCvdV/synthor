import { useRef } from 'react'
import { cx } from '../components/cx'
import { scrollAtThumb, scrollThumb } from './waveView'
import s from './WaveScrollbar.module.css'

/** Thin horizontal scrollbar: drag the thumb, or press the track to center the thumb there. */
export function WaveScrollbar({ width, frames, visible, scroll, onScroll }: {
  /** Track width used for the thumb's size and position. */
  width: number
  frames: number
  visible: number
  scroll: number
  onScroll: (scroll: number) => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const thumbEl = useRef<HTMLDivElement>(null)
  const grab = useRef<number | null>(null)
  const thumb = scrollThumb(width || 1, frames, visible, scroll)

  const scrollTo = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect()
    if (!rect || grab.current === null) return
    onScroll(scrollAtThumb(clientX - rect.left, grab.current, rect.width, scrollThumb(rect.width, frames, visible, scroll)))
  }

  return (
    <div
      ref={track}
      className={cx(s.track, thumb.maxScroll <= 0 && s.disabled)}
      onPointerDown={(e) => {
        const rect = track.current?.getBoundingClientRect()
        if (thumb.maxScroll <= 0 || !rect) return
        const t = scrollThumb(rect.width, frames, visible, scroll)
        grab.current = e.target === thumbEl.current ? e.clientX - rect.left - t.left : t.width / 2
        e.currentTarget.setPointerCapture(e.pointerId)
        scrollTo(e.clientX)
      }}
      onPointerMove={(e) => scrollTo(e.clientX)}
      onPointerUp={(e) => {
        grab.current = null
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
    >
      {thumb.maxScroll > 0 && <div ref={thumbEl} className={s.thumb} style={{ width: thumb.width, left: thumb.left }} />}
    </div>
  )
}
