import type { PcmData } from '../../audio/sampleEdit'
import type { Sel } from './selectionGestures'
import { amplitudeY, columnPeak, type Lane } from './waveView'

const WAVE_COLOR = '#4fd1c5'
const CENTER_COLOR = '#242a33'
const GRID_COLOR = 'rgba(36, 42, 51, 0.6)'
const LABEL_COLOR = 'rgba(107, 116, 128, 0.8)'
const SEL_FILL = 'rgba(79, 209, 197, 0.12)'
const SEL_EDGE = 'rgba(79, 209, 197, 0.55)'
const CURSOR_COLOR = 'rgba(79, 209, 197, 0.55)'

/** Amplitude grid lines, in addition to the center line. */
export const GRID_LEVELS = [1, 0.5, -0.5, -1]

/** Renders the visible waveform window into an offscreen canvas the size of the editor. */
export function renderWaveImage(pcm: PcmData | null, width: number, height: number, lanes: Lane[], px: number, scroll: number): HTMLCanvasElement | null {
  if (!pcm?.length || width === 0 || height === 0) return null
  const dpr = window.devicePixelRatio || 1
  const image = document.createElement('canvas')
  image.width = Math.ceil(width * dpr)
  image.height = Math.ceil(height * dpr)
  const ctx = image.getContext('2d')
  if (!ctx) return null
  ctx.scale(dpr, dpr)
  pcm.forEach((ch, i) => {
    const lane = lanes[i]
    if (!lane) return
    ctx.fillStyle = GRID_COLOR
    for (const v of GRID_LEVELS) ctx.fillRect(0, Math.round(amplitudeY(lane, v)), width, 1)
    ctx.fillStyle = CENTER_COLOR
    ctx.fillRect(0, Math.round(amplitudeY(lane, 0)), width, 1)
    ctx.fillStyle = WAVE_COLOR
    for (let x = 0; x < width; x++) {
      const peak = columnPeak(ch, x, px, scroll)
      if (!peak) break
      const y0 = amplitudeY(lane, peak[1])
      const y1 = amplitudeY(lane, peak[0])
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0))
    }
  })
  return image
}

export interface Overlay {
  lanes: Lane[]
  sel: Sel | null
  cursor: number | null
  px: number
  scroll: number
}

/** Draws the waveform image with lane labels, selection and cursor on top. */
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
  if (image) ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, width, height)
  if (!o.lanes.length) return

  ctx.font = '10px ui-monospace, monospace'
  ctx.fillStyle = LABEL_COLOR
  const labels = o.lanes.length === 2 ? ['L', 'R'] : ['Mono']
  o.lanes.forEach((lane, i) => ctx.fillText(labels[i] ?? '', 4, lane.top + 11))

  const top = o.lanes[0].top
  const last = o.lanes[o.lanes.length - 1]
  const spanH = last.top + last.height - top
  const xOf = (frame: number) => (frame - o.scroll) * o.px
  if (o.sel && o.px > 0) {
    const x0 = xOf(o.sel.start)
    const x1 = xOf(o.sel.end)
    const from = Math.max(0, x0)
    const to = Math.min(width, x1)
    if (to > from) {
      ctx.fillStyle = SEL_FILL
      ctx.fillRect(from, top, to - from, spanH)
      ctx.fillStyle = SEL_EDGE
      ctx.fillRect(x0 - 1, top, 2, spanH)
      ctx.fillRect(x1 - 1, top, 2, spanH)
    }
  }
  if (o.cursor !== null) {
    const x = xOf(o.cursor)
    if (x >= -2 && x <= width + 2) {
      ctx.fillStyle = CURSOR_COLOR
      ctx.fillRect(x - 1, top, 2, spanH)
    }
  }
}
