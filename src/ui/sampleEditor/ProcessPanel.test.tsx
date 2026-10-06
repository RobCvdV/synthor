// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LIVE_PROCESSES } from './liveProcesses'
import { ProcessPanel } from './ProcessPanel'

describe('ProcessPanel', () => {
  it('shows each param and reports slider, Done and Cancel', () => {
    const on = { onChange: vi.fn(), onLoop: vi.fn(), onDone: vi.fn(), onCancel: vi.fn() }
    const { container } = render(
      <ProcessPanel def={LIVE_PROCESSES.crush} values={{ bits: 8, hold: 2 }} ctx={{ sampleRate: 44100 }} target="whole sample" busy={false} {...on} />,
    )
    expect(screen.getByText('22.1 kHz')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '99' } })
    expect(on.onChange).toHaveBeenCalledWith('hold', 32)
    fireEvent.change(screen.getAllByRole('slider')[0], { target: { value: '4' } })
    expect(on.onChange).toHaveBeenCalledWith('bits', 4)
    fireEvent.click(screen.getByText('Done'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(on.onDone).toHaveBeenCalled()
    expect(on.onCancel).toHaveBeenCalled()
    expect(container.innerHTML).toMatchSnapshot()
  })
})
