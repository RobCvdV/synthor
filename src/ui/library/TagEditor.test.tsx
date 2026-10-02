// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TagEditor } from './TagEditor'

describe('TagEditor', () => {
  it('renders chips', () => {
    const { container } = render(<TagEditor tags={['warm', 'pad']} onChange={() => {}} />)
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('adds normalized tags on Enter and comma, and on blur', () => {
    const onChange = vi.fn()
    render(<TagEditor tags={['warm']} onChange={onChange} />)
    const input = screen.getByLabelText('Add tag')
    fireEvent.change(input, { target: { value: 'Soft Lo-Fi' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(['warm', 'soft', 'lo-fi'])
    fireEvent.change(input, { target: { value: 'WARM' } })
    fireEvent.keyDown(input, { key: ',' })
    expect(onChange).toHaveBeenLastCalledWith(['warm'])
    fireEvent.change(input, { target: { value: 'dark' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith(['warm', 'dark'])
  })

  it('removes with × and with Backspace on an empty input', () => {
    const onChange = vi.fn()
    render(<TagEditor tags={['a', 'b']} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Remove tag a'))
    expect(onChange).toHaveBeenLastCalledWith(['b'])
    fireEvent.keyDown(screen.getByLabelText('Add tag'), { key: 'Backspace' })
    expect(onChange).toHaveBeenLastCalledWith(['a'])
  })
})
