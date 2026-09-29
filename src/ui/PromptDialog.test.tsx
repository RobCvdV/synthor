// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PromptDialog } from './components/PromptDialog'

const noTaken = (v: string) => (v === 'Taken' ? 'Already used' : null)

describe('PromptDialog', () => {
  it('submits the trimmed value with Enter', () => {
    const onSubmit = vi.fn()
    render(<PromptDialog message="Name" defaultValue="Untitled" onSubmit={onSubmit} onCancel={() => {}} />)
    const input = screen.getByLabelText('Name')
    fireEvent.change(input, { target: { value: '  Groove ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('Groove')
  })

  it('shows the validation error and blocks submitting', () => {
    const onSubmit = vi.fn()
    render(<PromptDialog message="Name" defaultValue="Taken" confirmLabel="Create" validate={noTaken}
      onSubmit={onSubmit} onCancel={() => {}} />)
    expect(screen.getByText('Already used')).toBeTruthy()
    expect(screen.getByText('Create')).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cancels', () => {
    const onCancel = vi.fn()
    render(<PromptDialog message="Name" defaultValue="" onSubmit={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })
})
