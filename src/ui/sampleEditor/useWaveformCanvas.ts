import { useEffect, useRef, type RefObject } from 'react'
import type { PcmData } from '../../audio/sampleEdit'
import type { Sel } from './selectionGestures'
import { drawEditor, renderWaveImage } from './waveCanvas'

interface View {
  pcm: PcmData | null
  width: number
  px: number
  scroll: number
  sel: Sel | null
  cursor: number | null
}

/** Draws the waveform into `canvas`; cursor and selection changes redraw only the overlay. */
export function useWaveformCanvas(canvas: RefObject<HTMLCanvasElement | null>, box: RefObject<HTMLElement | null>, v: View): void {
  const image = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    image.current = renderWaveImage(v.pcm, v.width, v.px, v.scroll)
  }, [v.pcm, v.width, v.px, v.scroll])

  useEffect(() => {
    if (!canvas.current || !box.current) return
    drawEditor(canvas.current, v.width, box.current.clientHeight, image.current, {
      lanes: v.pcm?.length ?? 0, sel: v.sel, cursor: v.cursor, px: v.px, scroll: v.scroll,
    })
  }, [canvas, box, v.pcm, v.width, v.px, v.scroll, v.sel, v.cursor])
}
