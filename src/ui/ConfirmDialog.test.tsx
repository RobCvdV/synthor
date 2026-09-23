// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ConfirmDialog } from './components/ConfirmDialog'

describe('ConfirmDialog', () => {
  it('renders the message and action buttons', () => {
    const { container } = render(
      <ConfirmDialog message="Delete this?" onConfirm={() => {}} onCancel={() => {}} />,
    )
    expect(container.textContent).toContain('Delete this?')
    expect(container.textContent).toContain('OK')
    expect(container.textContent).toContain('Cancel')
  })

  it('calls onConfirm then onCancel when OK is clicked', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { getByText } = render(
      <ConfirmDialog message="Go?" onConfirm={onConfirm} onCancel={onCancel} />,
    )
    fireEvent.click(getByText('OK'))
    expect(onConfirm).toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('calls onCancel when Cancel is clicked', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { getByText } = render(
      <ConfirmDialog message="Go?" onConfirm={onConfirm} onCancel={onCancel} />,
    )
    fireEvent.click(getByText('Cancel'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('renders danger confirm button in red', () => {
    const { getByText } = render(
      <ConfirmDialog message="Delete" danger onConfirm={() => {}} onCancel={() => {}} />,
    )
    expect(getByText('OK').style.background).toBe('rgb(204, 68, 68)')
  })
})