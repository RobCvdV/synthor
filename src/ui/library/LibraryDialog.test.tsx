// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { newDrumKitInstrument, newModularInstrument } from '../../domain/factory'
import type { Instrument } from '../../domain/types'
import { listLibraryInstruments, saveToLibrary } from '../../persist/instrumentLibrary'
import { createMemoryBackend } from '../../persist/memoryBackend'
import { setStorage } from '../../persist/storage'
import { useDialogStore } from '../../state/dialogStore'
import { LibraryDialog } from './LibraryDialog'
import { instrumentLibrary } from './librarySource'

const downloadBlob = vi.hoisted(() => vi.fn())
vi.mock('../download', () => ({ downloadBlob }))

async function seed(inst: Instrument, category: string, tags: string[]) {
  return saveToLibrary({ rootId: inst.id, instruments: { [inst.id]: inst }, samples: {} }, async () => null, { category, tags })
}

const rowNames = () => screen.getAllByRole('listitem').map((li) => li.querySelector('span:nth-of-type(2)')?.textContent)

describe('LibraryDialog', () => {
  beforeEach(async () => {
    setStorage(createMemoryBackend())
    useDialogStore.setState({ request: null, resolve: null })
    await seed(newModularInstrument('Warm Pad'), 'Pads', ['warm'])
    await seed(newModularInstrument('acid bass'), 'Bass', ['303'])
    await seed(newDrumKitInstrument('Kit 808'), 'Drums', ['warm'])
  })

  it('lists instruments sorted by name', async () => {
    const { baseElement } = render(<LibraryDialog source={instrumentLibrary} mode="pick" onAdd={() => {}} onClose={() => {}} />)
    await screen.findByText('Warm Pad')
    expect(rowNames()).toEqual(['acid bass', 'Kit 808', 'Warm Pad'])
    expect(baseElement.innerHTML).toMatchSnapshot()
    fireEvent.click(screen.getByLabelText('Toggle sort direction'))
    expect(rowNames()).toEqual(['Warm Pad', 'Kit 808', 'acid bass'])
  })

  it('filters by text and category', async () => {
    render(<LibraryDialog source={instrumentLibrary} mode="pick" onAdd={() => {}} onClose={() => {}} />)
    await screen.findByText('Warm Pad')
    fireEvent.change(screen.getByLabelText('Search library'), { target: { value: 'warm' } })
    expect(rowNames()).toEqual(['Kit 808', 'Warm Pad'])
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Pads' } })
    expect(rowNames()).toEqual(['Warm Pad'])
    fireEvent.change(screen.getByLabelText('Search library'), { target: { value: 'zzz' } })
    expect(screen.getByText('No instruments match.')).toBeTruthy()
  })

  it('picks several (select all applies to the visible ones) and adds them in list order', async () => {
    const onAdd = vi.fn()
    render(<LibraryDialog source={instrumentLibrary} mode="pick" onAdd={onAdd} onClose={() => {}} />)
    await screen.findByText('Warm Pad')
    fireEvent.change(screen.getByLabelText('Search library'), { target: { value: 'warm' } })
    fireEvent.click(screen.getByText('Select all'))
    fireEvent.change(screen.getByLabelText('Search library'), { target: { value: '' } })
    fireEvent.click(screen.getByLabelText('Select acid bass'))
    fireEvent.click(screen.getByText('Add 3 to song'))
    expect(onAdd).toHaveBeenCalledWith(['acid-bass', 'kit-808', 'warm-pad'])
  })

  it('adds one on double-click', async () => {
    const onAdd = vi.fn()
    render(<LibraryDialog source={instrumentLibrary} mode="pick" onAdd={onAdd} onClose={() => {}} />)
    fireEvent.doubleClick(await screen.findByText('Kit 808'))
    expect(onAdd).toHaveBeenCalledWith(['kit-808'])
  })

  it('edits name, category and tags of the selected instrument', async () => {
    render(<LibraryDialog source={instrumentLibrary} mode="manage" onClose={() => {}} />)
    fireEvent.click(await screen.findByText('acid bass'))
    const details = screen.getByLabelText('Name').closest('div')!
    fireEvent.change(within(details).getByLabelText('Name'), { target: { value: 'Acid Bass' } })
    fireEvent.blur(within(details).getByLabelText('Name'))
    fireEvent.change(within(details).getByLabelText('Category'), { target: { value: 'Basses' } })
    fireEvent.keyDown(within(details).getByLabelText('Category'), { key: 'Enter' })
    fireEvent.change(within(details).getByLabelText('Add tag'), { target: { value: 'squelch' } })
    fireEvent.keyDown(within(details).getByLabelText('Add tag'), { key: 'Enter' })
    await vi.waitFor(async () => {
      const item = (await listLibraryInstruments()).find((i) => i.id === 'acid-bass')
      expect(item).toMatchObject({ name: 'Acid Bass', category: 'Basses', tags: ['303', 'squelch'] })
    })
    expect(await screen.findByText('Acid Bass')).toBeTruthy()
  })

  it('manage mode exports and deletes after confirming; pick mode has neither', async () => {
    const { unmount } = render(<LibraryDialog source={instrumentLibrary} mode="pick" onAdd={() => {}} onClose={() => {}} />)
    fireEvent.click(await screen.findByText('Kit 808'))
    expect(screen.queryByText('Export')).toBeNull()
    unmount()

    render(<LibraryDialog source={instrumentLibrary} mode="manage" onClose={() => {}} />)
    fireEvent.click(await screen.findByText('Kit 808'))
    fireEvent.click(screen.getByText('Export'))
    await vi.waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Kit 808.synthinst'))

    fireEvent.click(screen.getByText('Delete'))
    await vi.waitFor(() => expect(useDialogStore.getState().request).not.toBeNull())
    act(() => useDialogStore.getState().answer(true))
    await vi.waitFor(() => expect(screen.queryByText('Kit 808')).toBeNull())
    expect((await listLibraryInstruments()).map((i) => i.id).sort()).toEqual(['acid-bass', 'warm-pad'])
  })

  it('explains an empty library', async () => {
    setStorage(createMemoryBackend())
    render(<LibraryDialog source={instrumentLibrary} mode="manage" onClose={() => {}} />)
    expect(await screen.findByText(/The library is empty/)).toBeTruthy()
  })
})
