// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { StorageLocation } from './StoreTab'

const actions = vi.hoisted(() => ({
  backupLibrary: vi.fn(async () => {}),
  restoreLibrary: vi.fn(async () => true),
  stopUsingFolder: vi.fn(async () => {}),
  moveLibraryToFolder: vi.fn(async () => {}),
}))
vi.mock('../libraryLocationActions', () => actions)

describe('StorageLocation', () => {
  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI
  })

  it('names browser storage on the web', () => {
    const { container } = render(<StorageLocation />)
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('shows the library folder and iCloud Drive in Electron, reveals and changes it', async () => {
    const revealLibrary = vi.fn(async () => '')
    const changeLibraryFolder = vi.fn(async () => {})
    const icloudPath = vi.fn(async () => '/Users/me/Library/Mobile Documents/iCloud~nl~akiar~synthor/Documents')
    Object.assign(window, { electronAPI: { libraryPath: '/Users/me/Documents/Synthor', revealLibrary, changeLibraryFolder, icloudPath } })
    const { container, getByText, findByText } = render(<StorageLocation />)
    await findByText('iCloud Drive: Synthor folder available')
    expect(container.innerHTML).toMatchSnapshot()
    fireEvent.click(getByText('Reveal'))
    expect(revealLibrary).toHaveBeenCalled()
    fireEvent.click(getByText('Change…'))
    expect(changeLibraryFolder).toHaveBeenCalled()
  })

  it('offers a folder where the browser supports it, and backup/restore everywhere', async () => {
    Object.assign(navigator, { storage: { getDirectory: async () => ({}) } })
    Object.assign(window, { showDirectoryPicker: vi.fn() })
    const onRestored = vi.fn()
    try {
      const { getByText } = render(<StorageLocation onRestored={onRestored} />)
      fireEvent.click(getByText('Use a folder…'))
      expect(actions.moveLibraryToFolder).toHaveBeenCalled()
      fireEvent.click(getByText('Back up library'))
      expect(actions.backupLibrary).toHaveBeenCalled()
      fireEvent.click(getByText('Restore…'))
      await vi.waitFor(() => expect(onRestored).toHaveBeenCalled())
    } finally {
      delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker
    }
  })
})
