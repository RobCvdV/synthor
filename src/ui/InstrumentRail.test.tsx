// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { newModularInstrument } from '../domain/factory'
import type { Instrument } from '../domain/types'
import { packInstrumentFile } from '../persist/instrumentFile'
import { listLibraryInstruments, saveToLibrary } from '../persist/instrumentLibrary'
import { createMemoryBackend } from '../persist/memoryBackend'
import { setStorage } from '../persist/storage'
import { useDialogStore } from '../state/dialogStore'
import { useDocStore } from '../state/docStore'
import { InstrumentRail } from './InstrumentRail'
import { resetStores } from './test/testUtils'

const pickFiles = vi.hoisted(() => vi.fn(async (): Promise<File[]> => []))
vi.mock('./pickFiles', () => ({ pickFiles }))

const instruments = () => Object.values(useDocStore.getState().doc.entities.instruments) as Instrument[]

function renderRail(onSelect = vi.fn()) {
  render(<InstrumentRail instruments={instruments()} selectedId={null} usage={() => 0} onSelect={onSelect} />)
  return onSelect
}

const choose = (label: string) => {
  const select = screen.getByLabelText('Add instrument') as HTMLSelectElement
  const option = Array.from(select.options).find((o) => o.text === label)!
  fireEvent.change(select, { target: { value: option.value } })
}

describe('InstrumentRail', () => {
  beforeEach(() => {
    resetStores()
    setStorage(createMemoryBackend())
  })

  it('renders the add menu, library button and instrument list', () => {
    const { container } = render(<InstrumentRail instruments={instruments()} selectedId={instruments()[0].id} usage={() => 1} onSelect={() => {}} />)
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('hides library entries without storage', () => {
    setStorage(null)
    renderRail()
    const options = Array.from((screen.getByLabelText('Add instrument') as HTMLSelectElement).options).map((o) => o.text)
    expect(options).toEqual(['Add Instrument +', 'Import…', 'New Synth…', 'New Drum Kit…'])
    expect(screen.queryByText('Library')).toBeNull()
  })

  it('names and creates an empty synth', async () => {
    const onSelect = renderRail()
    choose('New Synth…')
    await vi.waitFor(() => expect(useDialogStore.getState().request).toMatchObject({ kind: 'text', defaultValue: 'Synth' }))
    act(() => useDialogStore.getState().answer('Sub Bass'))
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalled())
    const created = useDocStore.getState().doc.entities.instruments[onSelect.mock.calls[0][0]]
    expect(created).toMatchObject({ kind: 'modular', name: 'Sub Bass', connections: {} })
  })

  it('imports several files, then offers to keep the new ones in the library', async () => {
    await saveToLibrary((() => { const i = newModularInstrument('Old'); return { rootId: i.id, instruments: { [i.id]: i }, samples: {} } })(), async () => null)
    const file = async (name: string) => {
      const inst = newModularInstrument(name)
      return new File([await packInstrumentFile({ rootId: inst.id, instruments: { [inst.id]: inst }, samples: {} }, async () => null) as BlobPart], `${name}.synthinst`)
    }
    pickFiles.mockResolvedValueOnce([await file('New'), await file('Old')])
    const onSelect = renderRail()

    choose('Import…')
    await screen.findByText('Add to Library?')
    expect(onSelect).toHaveBeenCalled()
    expect(screen.getByText('already in library')).toBeTruthy()
    fireEvent.click(screen.getByText('Add 1 to library'))

    await vi.waitFor(async () => expect((await listLibraryInstruments()).map((i) => i.name).sort()).toEqual(['New', 'Old']))
    expect(screen.queryByText('Add to Library?')).toBeNull()
  })

  it('opens the library to pick from and to manage', async () => {
    renderRail()
    choose('From library…')
    expect(await screen.findByText('Add Instruments from Library')).toBeTruthy()
    fireEvent.click(screen.getByText('Cancel'))
    fireEvent.click(screen.getByText('Library'))
    expect(await screen.findByText('Instrument Library')).toBeTruthy()
  })
})
