// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { StorageLocation } from './StoreTab'

describe('StorageLocation', () => {
  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI
  })

  it('names browser storage on the web', () => {
    const { container } = render(<StorageLocation />)
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('shows the library folder in Electron and reveals it', () => {
    const revealLibrary = vi.fn(async () => '')
    Object.assign(window, { electronAPI: { libraryPath: '/Users/me/Documents/Synthor', revealLibrary } })
    const { container, getByText } = render(<StorageLocation />)
    expect(container.innerHTML).toMatchSnapshot()
    fireEvent.click(getByText('Reveal'))
    expect(revealLibrary).toHaveBeenCalled()
  })
})
