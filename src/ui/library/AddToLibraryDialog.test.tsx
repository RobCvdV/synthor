// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AddToLibraryDialog } from './AddToLibraryDialog'

const choices = [
  { key: 'a', name: 'Pad', fileName: 'pad.synthinst', inLibrary: false },
  { key: 'b', name: 'Bass', fileName: 'bass.synthinst', inLibrary: true },
  { key: 'c', name: 'Kit', fileName: 'kit.synthinst', inLibrary: false },
]

describe('AddToLibraryDialog', () => {
  it('pre-checks the instruments not yet in the library', () => {
    const { baseElement } = render(<AddToLibraryDialog choices={choices} onConfirm={() => {}} onCancel={() => {}} />)
    expect(baseElement.innerHTML).toMatchSnapshot()
  })

  it('toggles all/none and confirms the checked keys in list order', () => {
    const onConfirm = vi.fn()
    render(<AddToLibraryDialog choices={choices} onConfirm={onConfirm} onCancel={() => {}} />)
    fireEvent.click(screen.getByText('Select all'))
    expect(screen.getByText('Add 3 to library')).toBeTruthy()
    fireEvent.click(screen.getByText('Select none'))
    expect(screen.getByText('Add to library')).toBeDisabled()
    fireEvent.click(screen.getByText('Kit'))
    fireEvent.click(screen.getByText('Pad'))
    fireEvent.click(screen.getByText('Add 2 to library'))
    expect(onConfirm).toHaveBeenCalledWith(['a', 'c'])
  })

  it('skips the toggle for a single file', () => {
    render(<AddToLibraryDialog choices={choices.slice(0, 1)} onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.queryByText(/Select (all|none)/)).toBeNull()
  })
})
