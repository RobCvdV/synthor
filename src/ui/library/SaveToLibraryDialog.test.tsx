// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { newModularInstrument } from '../../domain/factory'
import { saveToLibrary } from '../../persist/instrumentLibrary'
import { createMemoryBackend } from '../../persist/memoryBackend'
import { setStorage } from '../../persist/storage'
import { SaveToLibraryDialog } from './SaveToLibraryDialog'
import { instrumentLibrary } from './librarySource'

async function seed(name: string, category: string) {
  const synth = newModularInstrument(name)
  return saveToLibrary({ rootId: synth.id, instruments: { [synth.id]: synth }, samples: {} }, async () => null, { category, tags: ['warm'] })
}

describe('SaveToLibraryDialog', () => {
  beforeEach(() => setStorage(createMemoryBackend()))

  it('saves name, category and tags', async () => {
    const onSave = vi.fn()
    render(<SaveToLibraryDialog source={instrumentLibrary} defaultName="Keys" onSave={onSave} onCancel={() => {}} />)
    await screen.findByText('Save')
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Keys' } })
    const tag = screen.getByLabelText('Add tag')
    fireEvent.change(tag, { target: { value: 'soft' } })
    fireEvent.keyDown(tag, { key: 'Enter' })
    fireEvent.click(screen.getByText('Save'))
    expect(onSave).toHaveBeenCalledWith({ name: 'Keys', category: 'Keys', tags: ['soft'] })
  })

  it('offers replace or keep both when the name is taken', async () => {
    const id = await seed('Pad', 'Pads')
    const onSave = vi.fn()
    const { baseElement } = render(<SaveToLibraryDialog source={instrumentLibrary} defaultName="pad" onSave={onSave} onCancel={() => {}} />)
    await screen.findByText('Replace')
    expect(baseElement.innerHTML).toMatchSnapshot()
    fireEvent.click(screen.getByText('Replace'))
    expect(onSave).toHaveBeenLastCalledWith({ name: 'pad', category: '', tags: [], replaceId: id })
    fireEvent.click(screen.getByText('Keep both'))
    expect(onSave).toHaveBeenLastCalledWith({ name: 'pad', category: '', tags: [] })
  })

  it('requires a name', async () => {
    render(<SaveToLibraryDialog source={instrumentLibrary} defaultName="Keys" onSave={() => {}} onCancel={() => {}} />)
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: '  ' } })
    expect(screen.getByText('Save')).toBeDisabled()
  })
})
