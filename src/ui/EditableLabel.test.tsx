// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { EditableLabel } from './components/EditableLabel'

describe('EditableLabel', () => {
  it('renders the value as a span initially', () => {
    const { container } = render(
      <EditableLabel value="Test" onCommit={() => {}} className="lbl" inputClassName="inp" />,
    )
    expect(container.querySelector('span.lbl')?.textContent).toBe('Test')
    expect(container.querySelector('input')).toBeNull()
  })

  it('switches to an input on double-click', () => {
    const { container } = render(
      <EditableLabel value="Test" onCommit={() => {}} className="lbl" inputClassName="inp" />,
    )
    fireEvent.doubleClick(container.querySelector('span.lbl')!)
    const input = container.querySelector('input.inp')!
    expect(input).toBeTruthy()
    expect(input).toHaveValue('Test')
  })

  it('commits on Enter and hides the input', () => {
    const onCommit = vi.fn()
    const { container } = render(
      <EditableLabel value="Old" onCommit={onCommit} className="lbl" inputClassName="inp" />,
    )
    fireEvent.doubleClick(container.querySelector('span.lbl')!)
    const input = container.querySelector('input.inp')!
    fireEvent.change(input, { target: { value: 'New' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('New')
    expect(container.querySelector('input.inp')).toBeNull()
  })

  it('cancels on Escape without committing', () => {
    const onCommit = vi.fn()
    const { container } = render(
      <EditableLabel value="Old" onCommit={onCommit} className="lbl" inputClassName="inp" />,
    )
    fireEvent.doubleClick(container.querySelector('span.lbl')!)
    fireEvent.keyDown(container.querySelector('input.inp')!, { key: 'Escape' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(container.querySelector('input.inp')).toBeNull()
  })

  it('commits on blur when commitOnBlur is true', () => {
    const onCommit = vi.fn()
    const { container } = render(
      <EditableLabel value="Old" onCommit={onCommit} className="lbl" inputClassName="inp" commitOnBlur />,
    )
    fireEvent.doubleClick(container.querySelector('span.lbl')!)
    const input = container.querySelector('input.inp')!
    fireEvent.change(input, { target: { value: 'Blurred' } })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledWith('Blurred')
  })
})