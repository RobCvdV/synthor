// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ParamControl } from './components/ParamControl'
import type { ParamDef } from '../domain/moduleDefs'

const level: ParamDef = { key: 'gain', label: 'Level', min: 0, max: 2, default: 1, step: 0.01 }
const shape: ParamDef = { key: 'waveform', label: 'Shape', min: 0, max: 2, default: 0, step: 1, enumLabels: ['sine', 'saw', 'square'] }

describe('ParamControl', () => {
  it('renders a number param as a slider with the value next to the label', () => {
    const onChange = vi.fn()
    const { container } = render(<ParamControl param={level} value={0.5} onChange={onChange} />)
    expect(screen.getByText('0.5')).toBeTruthy()
    fireEvent.change(container.querySelector('input[type="range"]')!, { target: { value: '1.2' } })
    expect(onChange).toHaveBeenCalledWith(1.2)
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('renders a choice param as a dropdown that commits the picked index', () => {
    const onChange = vi.fn()
    const onCommit = vi.fn()
    render(<ParamControl param={shape} value={1} onChange={onChange} onCommit={onCommit} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('1')
    fireEvent.change(select, { target: { value: '2' } })
    expect(onCommit).toHaveBeenCalledWith(2)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('uses choices over the param labels, with a placeholder when empty', () => {
    render(<ParamControl param={{ ...level, key: 'sampleIndex' }} value={0} choices={[]} onChange={() => {}} />)
    expect(screen.getByRole('combobox').textContent).toBe('(none)')
  })

  it('shows a custom readout without a control when read-only', () => {
    const { container } = render(<ParamControl param={level} value={7} readOnly readout="CC 7" onChange={() => {}} />)
    expect(screen.getByText('CC 7')).toBeTruthy()
    expect(container.querySelector('input, select')).toBeNull()
  })
})
