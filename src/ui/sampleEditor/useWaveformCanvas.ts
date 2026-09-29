import { useEffect, useRef, type RefObject } from 'react'
import type { PcmData } from '../../audio/sampleEdit'
import type { Sel } from './selectionGestures'
import { drawEditor, renderWaveImage } from './waveCanvas'
import type { Lane } from './waveView'

interface View {
  pcm: PcmData | null
  width: number
  height: number
  lanes: Lane[]
  px: number
  scroll: number
  sel: Sel | null
  cursor: number | null
}

/** Draws the waveform into `canvas`; cursor and selection changes redraw only the overlay. */
export function useWaveformCanvas(canvas: RefObject<HTMLCanvasElement | null>, v: View): void {
  const image = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    image.current = renderWaveImage(v.pcm, v.width, v.height, v.lanes, v.px, v.scroll)
  }, [v.pcm, v.width, v.height, v.lanes, v.px, v.scroll])

  useEffect(() => {
    if (!canvas.current) return
    drawEditor(canvas.current, v.width, v.height, image.current, {
      lanes: v.lanes, sel: v.sel, cursor: v.cursor, px: v.px, scroll: v.scroll,
    })
  }, [canvas, v.pcm, v.width, v.height, v.lanes, v.px, v.scroll, v.sel, v.cursor])
}
