// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { newSampleEntity } from '../domain/factory'
import { createMemoryBackend } from '../persist/memoryBackend'
import { setStorage } from '../persist/storage'
import { useDocStore } from '../state/docStore'
import { SampleLibraryView } from './SampleLibraryView'
import { resetStores, stubHost } from './test/testUtils'

describe('SampleLibraryView library attributes', () => {
  beforeEach(() => {
    resetStores()
    setStorage(createMemoryBackend())
  })

  it('edits the category and tags a sample keeps in the song', () => {
    const smp = newSampleEntity('Kick', 'h', 'kick.wav', 48000, 1, 4800)
    useDocStore.getState().addSampleEntity(smp)
    const host = { ...stubHost(), stopSamplePreviews: () => {}, playSamplePreview: async () => {} }
    render(<SampleLibraryView host={host as unknown as ReturnType<typeof stubHost>} />)
    const category = screen.getByLabelText('Category')
    fireEvent.change(category, { target: { value: 'Drums' } })
    fireEvent.keyDown(category, { key: 'Enter' })
    const tag = screen.getByLabelText('Add tag')
    fireEvent.change(tag, { target: { value: 'punchy' } })
    fireEvent.keyDown(tag, { key: 'Enter' })
    expect(useDocStore.getState().doc.entities.samples[smp.id].library).toEqual({ category: 'Drums', tags: ['punchy'] })
    expect(screen.getByText('punchy')).toBeTruthy()
  })
})
