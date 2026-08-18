import type { AudioHost } from '../audio/host'

/** Waveform colour for the output oscilloscope. */
const SCOPE_COLOR = '#4af'

/** Clip LED threshold for the output node. */
export const CLIP_THRESHOLD = 0.95

/** Draw the host's current waveform onto a canvas (one frame, called from rAF). */
export function drawScope(canvas: HTMLCanvasElement, host: AudioHost) {
  const buf = host.getWaveform()
  if (buf.length === 0) return
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== w * dpr) canvas.width = w * dpr
  if (canvas.height !== h * dpr) canvas.height = h * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.strokeStyle = SCOPE_COLOR
  ctx.lineWidth = 1
  ctx.beginPath()
  const mid = h / 2
  const n = buf.length
  for (let x = 0; x < w; x++) {
    const idx = Math.floor((x / w) * n)
    const y = mid + buf[idx] * mid * 0.85
    if (x === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}
