import type { PcmData } from '../../audio/sampleEdit'
import type { Sel } from './selectionGestures'
import { columnPeak } from './waveView'

export const LANE_H = 56
export const LANE_GAP = 10
const WAVE_COLOR = '#4fd1c5'
const CENTER_COLOR = '#242a33'
const LABEL_COLOR = 'rgba(107, 116, 128, 0.8)'
const SEL_FILL = 'rgba(79, 209, 197, 0.12)'
const SEL_EDGE = 'rgba(79, 209, 197, 0.55)'
const CURSOR_COLOR = 'rgba(79, 209, 197, 0.55)'

export function lanesHeight(lanes: number): number {
  return lanes * LANE_H + Math.max(0, lanes - 1) * LANE_GAP
}

/** Renders the visible waveform window, one lane per channel, into an offscreen canvas. */
export function renderWaveImage(pcm: PcmData | null, width: number, px: number, scroll: number): HTMLCanvasElement | null {
  if (!pcm?.length || width === 0) return null
  const dpr = window.devicePixelRatio || 1
  const image = document.createElement('canvas')
  image.width = Math.ceil(width * dpr)
  image.height = Math.ceil(lanesHeight(pcm.length) * dpr)
  const ctx = image.getContext('2d')
  if (!ctx) return null
  ctx.scale(dpr, dpr)
  pcm.forEach((ch, lane) => {
    const top = lane * (LANE_H + LANE_GAP)
    ctx.fillStyle = CENTER_COLOR
    ctx.fillRect(0, top + LANE_H / 2, width, 1)
    ctx.fillStyle = WAVE_COLOR
    for (let x = 0; x < width; x++) {
      const peak = columnPeak(ch, x, px, scroll)
      if (!peak) break
      const y0 = top + ((1 - peak[1]) * LANE_H) / 2
      const y1 = top + ((1 - peak[0]) * LANE_H) / 2
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0))
    }
  })
  return image
}

export interface Overlay {
  lanes: number
  sel: Sel | null
  cursor: number | null
  px: number
  scroll: number
}

/** Draws the waveform image centered in the canvas, with lane labels, selection and cursor on top. */
export function drawEditor(canvas: HTMLCanvasElement, width: number, height: number, image: HTMLCanvasElement | null, o: Overlay): void {
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.ceil(width * dpr) || canvas.height !== Math.ceil(height * dpr)) {
    canvas.width = Math.ceil(width * dpr)
    canvas.height = Math.ceil(height * dpr)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  const contentH = lanesHeight(o.lanes)
  const top = Math.max(8, (height - contentH) / 2)
  if (image) ctx.drawImage(image, 0, 0, image.width, image.height, 0, top, width, contentH)

  ctx.font = '10px ui-monospace, monospace'
  ctx.fillStyle = LABEL_COLOR
  const labels = o.lanes === 2 ? ['L', 'R'] : ['Mono']
  labels.forEach((label, lane) => ctx.fillText(label, 4, top + lane * (LANE_H + LANE_GAP) + 11))

  const xOf = (frame: number) => (frame - o.scroll) * o.px
  if (o.sel && o.px > 0) {
    const x0 = xOf(o.sel.start)
    const x1 = xOf(o.sel.end)
    const from = Math.max(0, x0)
    const to = Math.min(width, x1)
    if (to > from) {
      ctx.fillStyle = SEL_FILL
      ctx.fillRect(from, top, to - from, contentH)
      ctx.fillStyle = SEL_EDGE
      ctx.fillRect(x0 - 1, top, 2, contentH)
      ctx.fillRect(x1 - 1, top, 2, contentH)
    }
  }
  if (o.cursor !== null) {
    const x = xOf(o.cursor)
    if (x >= -2 && x <= width + 2) {
      ctx.fillStyle = CURSOR_COLOR
      ctx.fillRect(x - 1, top, 2, contentH)
    }
  }
}
