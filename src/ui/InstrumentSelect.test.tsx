// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { InstrumentSelect } from './components/InstrumentSelect'
import { newModularInstrument } from '../domain/factory'

function inst(id: string, name: string) {
  const i = newModularInstrument(name)
  i.id = id
  return i
}

describe('InstrumentSelect', () => {
  it('lists the instruments and reports the picked id, then blurs', () => {
    const onChange = vi.fn()
    render(<InstrumentSelect instruments={[inst('a', 'Bass'), inst('b', 'Lead')]} value="a" onChange={onChange} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    select.focus()
    fireEvent.change(select, { target: { value: 'b' } })
    expect(onChange).toHaveBeenCalledWith('b')
    expect(document.activeElement).not.toBe(select)
    expect(Array.from(select.options).map((o) => o.text)).toEqual(['Bass', 'Lead'])
  })

  it('shows the empty label without instruments and never reports an empty id', () => {
    const onChange = vi.fn()
    render(<InstrumentSelect instruments={[]} value="" onChange={onChange} emptyLabel="No instruments" />)
    const select = screen.getByRole('combobox')
    expect(select.textContent).toBe('No instruments')
    fireEvent.change(select, { target: { value: '' } })
    expect(onChange).not.toHaveBeenCalled()
  })
})
