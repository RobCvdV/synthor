// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ParamSlider } from './components/ParamSlider'

function getSlider(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="range"]') as HTMLInputElement
}

describe('ParamSlider', () => {
  it('renders horizontal by default', () => {
    const { container } = render(
      <ParamSlider value={0.5} min={0} max={1} onChange={() => {}} />,
    )
    const input = getSlider(container)
    expect(input).toBeTruthy()
    expect(input.value).toBe('0.5')
    expect(input.style.writingMode).toBeFalsy()
  })

  it('renders vertical with writingMode', () => {
    const { container } = render(
      <ParamSlider value={0} min={-1} max={1} orientation="vertical" onChange={() => {}} />,
    )
    expect(getSlider(container).style.writingMode).toBe('vertical-lr')
  })

  it('renders disabled with reduced opacity', () => {
    const { container } = render(
      <ParamSlider value={50} min={0} max={100} disabled onChange={() => {}} />,
    )
    const input = getSlider(container)
    expect(input).toBeDisabled()
    expect(input.style.opacity).toBe('0.4')
  })

  it('shows formatted value readout', () => {
    const { container } = render(
      <ParamSlider value={0.75} min={0} max={1} onChange={() => {}} formatValue={(v) => v.toFixed(2)} />,
    )
    expect(container.textContent).toContain('0.75')
  })

  it('renders the slider element', () => {
    const { container } = render(
      <ParamSlider value={0} min={0} max={1} onChange={() => {}} />,
    )
    expect(getSlider(container)).toBeTruthy()
  })
})