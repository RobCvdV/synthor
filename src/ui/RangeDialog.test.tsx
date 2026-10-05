// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RangeDialog } from './components/RangeDialog'

describe('RangeDialog', () => {
  it('prefills and submits both values with Enter', () => {
    const onSubmit = vi.fn()
    const { asFragment } = render(<RangeDialog message="Interpolate Panning" start="10" end=""
      onSubmit={onSubmit} onCancel={() => {}} />)
    expect(asFragment()).toMatchSnapshot()
    const end = screen.getByLabelText('End')
    fireEvent.change(end, { target: { value: 'ff' } })
    fireEvent.keyDown(end, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith({ start: 16 / 255, end: 1 })
  })

  it('blocks submitting until both values are valid hex', () => {
    const onSubmit = vi.fn()
    render(<RangeDialog message="Interpolate" start="" end="" confirmLabel="Fill" onSubmit={onSubmit} onCancel={() => {}} />)
    expect(screen.getByText('Fill')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: 'G0' } })
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '80' } })
    expect(screen.getByText('Enter hex values 00–FF')).toBeTruthy()
    fireEvent.keyDown(screen.getByLabelText('Start'), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cancels', () => {
    const onCancel = vi.fn()
    render(<RangeDialog message="Interpolate" start="" end="" onSubmit={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })
})
