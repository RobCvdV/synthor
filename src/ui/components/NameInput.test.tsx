// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NameInput } from './NameInput'

describe('NameInput', () => {
  it('keeps trailing spaces while typing and commits the trimmed name on blur', () => {
    const onCommit = vi.fn()
    render(<NameInput aria-label="Name" value="Kick" onCommit={onCommit} />)
    const input = screen.getByLabelText('Name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Kick ' } })
    expect(input.value).toBe('Kick ')
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Kick 2 ' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith('Kick 2')
  })

  it('reverts on Escape, on an empty name and when nothing changed', () => {
    const onCommit = vi.fn()
    render(<NameInput aria-label="Name" value="Kick" onCommit={onCommit} />)
    const input = screen.getByLabelText('Name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Snare' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('Kick')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(input.value).toBe('Kick')
    fireEvent.change(input, { target: { value: ' Kick ' } })
    fireEvent.blur(input)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('follows outside renames', () => {
    const { rerender } = render(<NameInput aria-label="Name" value="Kick" onCommit={() => {}} />)
    rerender(<NameInput aria-label="Name" value="Kick 808" onCommit={() => {}} />)
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Kick 808')
  })
})
