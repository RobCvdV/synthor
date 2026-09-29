import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { clampScroll, clampZoom, fitZoom, zoomAround } from './waveView'

/** Inner size of an element, kept current with a ResizeObserver. */
export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize((s) =>
      s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [ref])
  return size
}

/**
 * Zoom (pixels per frame) and scroll (first visible frame) for a waveform `width` pixels wide.
 * The wheel scrolls; Cmd/Ctrl+wheel zooms around the pointer.
 */
export function useWaveView(frames: number, width: number, wheelTarget: RefObject<HTMLElement | null>) {
  const [px, setPx] = useState(0.05)
  const [scroll, setScrollRaw] = useState(0)
  const live = useRef({ frames, width, px, scroll })
  live.current = { frames, width, px, scroll }

  const setScroll = useCallback((sc: number, atPx = live.current.px) => {
    const { frames: f, width: w } = live.current
    setScrollRaw(clampScroll(sc, f, w, atPx))
  }, [])

  // Shrinking the sample or zooming out can leave the scroll past the end.
  useEffect(() => {
    setScrollRaw((sc) => clampScroll(sc, frames, width, px))
  }, [frames, width, px])

  const zoomBy = useCallback((factor: number) => setPx((p) => clampZoom(p * factor)), [])

  const fit = useCallback(() => {
    const { frames: f, width: w } = live.current
    if (f > 0 && w > 0) {
      setPx(fitZoom(w, f))
      setScrollRaw(0)
    }
  }, [])

  useEffect(() => {
    const el = wheelTarget.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (live.current.frames === 0) return
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const x = e.clientX - el.getBoundingClientRect().left
        const next = zoomAround(live.current.px, live.current.scroll, x, e.deltaY < 0)
        setPx(next.px)
        setScroll(next.scroll, next.px)
      } else {
        setScroll(live.current.scroll + (e.deltaY + e.deltaX) * 2)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [wheelTarget, setScroll])

  return { px, scroll, setScroll, zoomBy, fit }
}
