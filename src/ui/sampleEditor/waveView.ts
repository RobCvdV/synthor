/** Zoom is pixels per frame. */
export const MIN_PX = 0.001
export const MAX_PX = 64
const MIN_THUMB_PX = 24

export function clampZoom(px: number): number {
  return Math.max(MIN_PX, Math.min(MAX_PX, px))
}

/** The zoom that shows the whole sample in `width` pixels. */
export function fitZoom(width: number, frames: number): number {
  return clampZoom(width / frames)
}

export function visibleFrames(width: number, px: number): number {
  return width / Math.max(MIN_PX, px)
}

/** Keeps the view inside the sample: scroll is the first visible frame. */
export function clampScroll(scroll: number, frames: number, width: number, px: number): number {
  const max = Math.max(0, frames - visibleFrames(width, px))
  return Math.max(0, Math.min(max, scroll))
}

/** The frame under pixel `x`, rounded to the nearest frame boundary. */
export function frameAtX(x: number, scroll: number, px: number, frames: number): number {
  return Math.max(0, Math.min(frames, Math.round(scroll + x / Math.max(MIN_PX, px))))
}

/** Zooms by one wheel step while keeping the frame under `x` in place. Scroll is unclamped. */
export function zoomAround(px: number, scroll: number, x: number, zoomIn: boolean): { px: number; scroll: number } {
  const frame = scroll + x / Math.max(MIN_PX, px)
  const next = clampZoom(px * (zoomIn ? 1.1 : 1 / 1.1))
  return { px: next, scroll: frame - x / next }
}

/** Min and max sample value drawn in pixel column `x`, or null past the end. */
export function columnPeak(ch: Float32Array, x: number, px: number, scroll: number): [number, number] | null {
  const f0 = Math.floor(scroll + x / px)
  if (f0 >= ch.length) return null
  const f1 = Math.min(Math.ceil(scroll + (x + 1) / px) - 1, ch.length - 1)
  let min = ch[f0]
  let max = ch[f0]
  for (let f = f0 + 1; f <= f1; f++) {
    const v = ch[f]
    if (v < min) min = v
    if (v > max) max = v
  }
  return [min, max]
}

export interface Lane { top: number; height: number }

const LANE_PAD = 8
const LANE_GAP = 10
const MIN_LANE_H = 24

/** Splits `height` pixels into one lane per channel, with padding around and gaps between. */
export function laneLayout(height: number, lanes: number): Lane[] {
  if (lanes === 0) return []
  const h = Math.max(MIN_LANE_H, (height - 2 * LANE_PAD - (lanes - 1) * LANE_GAP) / lanes)
  return Array.from({ length: lanes }, (_, i) => ({ top: LANE_PAD + i * (h + LANE_GAP), height: h }))
}

/** Y of sample value `v` (-1..1) in a lane; +1 is the lane's top. */
export function amplitudeY(lane: Lane, v: number): number {
  return lane.top + ((1 - v) * lane.height) / 2
}

/** Index of the lane at `y` (the nearest one in a gap). */
export function laneAt(lanes: Lane[], y: number): number {
  let best = 0
  lanes.forEach((l, i) => {
    const d = Math.max(l.top - y, y - (l.top + l.height), 0)
    const bd = Math.max(lanes[best].top - y, y - (lanes[best].top + lanes[best].height), 0)
    if (d < bd) best = i
  })
  return best
}

/** Sample value at `y` in a lane, the inverse of `amplitudeY`, clamped to -1..1. */
export function valueAtY(lane: Lane, y: number): number {
  return Math.max(-1, Math.min(1, 1 - (2 * (y - lane.top)) / lane.height))
}

export interface Thumb { width: number; left: number; maxScroll: number }

/** Scrollbar thumb size and position for a track `trackWidth` pixels wide. */
export function scrollThumb(trackWidth: number, frames: number, visible: number, scroll: number): Thumb {
  const maxScroll = Math.max(0, frames - visible)
  const ratio = frames > 0 ? Math.min(1, visible / frames) : 1
  const width = Math.max(MIN_THUMB_PX, trackWidth * ratio)
  const left = maxScroll > 0 ? ((trackWidth - width) * scroll) / maxScroll : 0
  return { width, left, maxScroll }
}

/** The scroll that puts the thumb's grab point under pointer `x` (track-relative). */
export function scrollAtThumb(x: number, grabOffset: number, trackWidth: number, thumb: Thumb): number {
  return ((x - grabOffset) / Math.max(1, trackWidth - thumb.width)) * thumb.maxScroll
}
