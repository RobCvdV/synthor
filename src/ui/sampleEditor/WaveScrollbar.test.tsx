// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { WaveScrollbar } from './WaveScrollbar'

describe('WaveScrollbar', () => {
  it('shows no thumb when the whole sample fits', () => {
    const { container } = render(<WaveScrollbar width={200} frames={100} visible={200} scroll={0} onScroll={() => {}} />)
    expect(container.firstElementChild).toHaveClass('disabled')
    expect(container.firstElementChild!.childElementCount).toBe(0)
  })

  it('sizes and places the thumb for the visible part', () => {
    const { container } = render(<WaveScrollbar width={200} frames={1000} visible={500} scroll={250} onScroll={() => {}} />)
    const thumb = container.querySelector('.thumb') as HTMLElement
    expect(thumb.style.width).toBe('100px')
    expect(thumb.style.left).toBe('50px')
  })

  it('scrolls to center the thumb where the track is pressed', () => {
    const onScroll = vi.fn()
    const { container } = render(<WaveScrollbar width={200} frames={1000} visible={500} scroll={0} onScroll={onScroll} />)
    const track = container.firstElementChild as HTMLElement
    track.getBoundingClientRect = () => ({ left: 0, width: 200 } as DOMRect)
    track.setPointerCapture = () => {}
    fireEvent.pointerDown(track, { clientX: 150, pointerId: 1 })
    // Thumb 100px wide centered at 150 → left 100 of 100 free pixels → the end.
    expect(onScroll).toHaveBeenLastCalledWith(500)
  })
})
