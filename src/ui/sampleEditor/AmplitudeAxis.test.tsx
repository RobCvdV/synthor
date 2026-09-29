// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { AmplitudeAxis } from './AmplitudeAxis'

const ticks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('span')).map((t) => [t.textContent, (t as HTMLElement).style.top])

describe('AmplitudeAxis', () => {
  it('labels a lane from full scale at the edges to 0 at the center', () => {
    const { container } = render(<AmplitudeAxis lanes={[{ top: 8, height: 100 }]} />)
    expect(ticks(container)).toEqual([['1.0', '8px'], ['0.5', '33px'], ['0', '58px'], ['0.5', '83px'], ['1.0', '108px']])
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('leaves out the bottom label of an upper stereo lane', () => {
    const { container } = render(<AmplitudeAxis lanes={[{ top: 8, height: 100 }, { top: 118, height: 100 }]} />)
    expect(ticks(container).map(([, top]) => top)).toEqual(
      ['8px', '33px', '58px', '83px', '118px', '143px', '168px', '193px', '218px'])
  })

  it('shows nothing without a sample', () => {
    const { container } = render(<AmplitudeAxis lanes={[]} />)
    expect(container.querySelectorAll('span')).toHaveLength(0)
  })
})
