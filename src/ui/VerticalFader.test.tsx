// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { VerticalFader } from './VerticalFader'

describe('VerticalFader', () => {
  it('takes a fixed share of the strip instead of stretching to fill it', () => {
    const { container } = render(<VerticalFader value={1} onDrag={() => {}} onCommit={() => {}} />)
    const box = container.firstElementChild as HTMLElement
    expect(box.style.flex).toBe('0 1 40%')
    expect(box.style.minHeight).toBe('60px')
    expect(container.innerHTML).toMatchSnapshot()
  })
})
