import { describe, expect, it } from 'vitest'
import {
  MAX_PX, MIN_PX, amplitudeY, clampScroll, laneLayout, columnPeak, fitZoom, frameAtX, scrollAtThumb, scrollThumb, zoomAround,
} from './waveView'

describe('waveView', () => {
  it('fits the whole sample in the width, within the zoom limits', () => {
    expect(fitZoom(1000, 48000)).toBeCloseTo(1000 / 48000)
    expect(fitZoom(1000, 1)).toBe(MAX_PX)
    expect(fitZoom(1, 1e9)).toBe(MIN_PX)
  })

  it('keeps the scroll inside the sample', () => {
    // 1000 frames, 100 px at 1 px/frame → 100 visible, so 900 is the last start.
    expect(clampScroll(950, 1000, 100, 1)).toBe(900)
    expect(clampScroll(-5, 1000, 100, 1)).toBe(0)
    expect(clampScroll(50, 80, 100, 1)).toBe(0)
  })

  it('maps a pixel to the nearest frame, clamped to the sample', () => {
    expect(frameAtX(10, 100, 2, 1000)).toBe(105)
    expect(frameAtX(-50, 0, 1, 1000)).toBe(0)
    expect(frameAtX(5000, 0, 1, 1000)).toBe(1000)
  })

  it('zooms around the pointer so the frame under it stays put', () => {
    const { px, scroll } = zoomAround(1, 100, 40, true)
    expect(px).toBeCloseTo(1.1)
    expect(scroll + 40 / px).toBeCloseTo(140)
  })

  it('finds the min and max of the frames under a pixel column', () => {
    // Four frames per pixel column.
    const ch = new Float32Array([0, 0.5, -0.25, 0.125, 0.75, -0.5, 0, 0])
    expect(columnPeak(ch, 0, 0.25, 0)).toEqual([-0.25, 0.5])
    expect(columnPeak(ch, 1, 0.25, 0)).toEqual([-0.5, 0.75])
    expect(columnPeak(ch, 2, 0.25, 0)).toBeNull()
  })

  it('splits the full height into lanes', () => {
    // 300 px: 8 padding top and bottom, one 10 px gap → two lanes of 137.
    expect(laneLayout(300, 2)).toEqual([{ top: 8, height: 137 }, { top: 155, height: 137 }])
    expect(laneLayout(300, 1)).toEqual([{ top: 8, height: 284 }])
    expect(laneLayout(10, 1)[0].height).toBe(24)
    expect(laneLayout(300, 0)).toEqual([])
  })

  it('maps amplitude to lane height, full scale at the lane edges', () => {
    const lane = { top: 8, height: 100 }
    expect([1, 0, -1, 0.5].map((v) => amplitudeY(lane, v))).toEqual([8, 58, 108, 33])
  })

  it('sizes and places the scrollbar thumb, with a minimum width', () => {
    expect(scrollThumb(200, 1000, 500, 250)).toEqual({ width: 100, left: 50, maxScroll: 500 })
    expect(scrollThumb(200, 1e6, 100, 0).width).toBe(24)
    expect(scrollThumb(200, 50, 100, 0)).toEqual({ width: 200, left: 0, maxScroll: 0 })
  })

  it('turns a thumb drag back into a scroll', () => {
    const thumb = scrollThumb(200, 1000, 500, 0)
    expect(scrollAtThumb(150, 50, 200, thumb)).toBe(500)
  })
})
