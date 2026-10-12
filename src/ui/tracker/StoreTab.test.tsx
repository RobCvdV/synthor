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

  const icloudDocs = '/Users/me/Library/Mobile Documents/iCloud~nl~akiar~synthor/Documents'
  const fakeApi = (libraryPath: string, libraryKind: string, icloud: string | null) => {
    const api = {
      libraryPath, libraryKind,
      revealLibrary: vi.fn(async () => ''),
      changeLibraryFolder: vi.fn(async () => {}),
      useICloudLibrary: vi.fn(async () => {}),
      icloudPath: vi.fn(async () => icloud),
    }
    Object.assign(window, { electronAPI: api })
    return api
  }

  it('shows a local library in Electron, reveals and changes it, and offers iCloud Drive', async () => {
    const api = fakeApi('/Users/me/Documents/Synthor', 'local', icloudDocs)
    const { container, getByText, findByText } = render(<StorageLocation />)
    await findByText('iCloud Drive is available')
    expect(container.innerHTML).toMatchSnapshot()
    fireEvent.click(getByText('Reveal'))
    expect(api.revealLibrary).toHaveBeenCalled()
    fireEvent.click(getByText('Change…'))
    expect(api.changeLibraryFolder).toHaveBeenCalled()
    fireEvent.click(getByText('Move to iCloud Drive…'))
    expect(api.useICloudLibrary).toHaveBeenCalled()
  })

  it('names the iCloud Drive library, and says when iCloud Drive is missing', async () => {
    fakeApi(icloudDocs, 'icloud', icloudDocs)
    const { getByText, queryByText, unmount } = render(<StorageLocation />)
    expect(getByText('iCloud Drive › Synthor')).toBeTruthy()
    expect(queryByText('Move to iCloud Drive…')).toBeNull()
    unmount()
    fakeApi('/Users/me/Documents/Synthor', 'local', null)
    expect(await render(<StorageLocation />).findByText('iCloud Drive: not available')).toBeTruthy()
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
