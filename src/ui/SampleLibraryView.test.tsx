// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { newSampleEntity } from '../domain/factory'
import { createMemoryBackend } from '../persist/memoryBackend'
import { setStorage } from '../persist/storage'
import { writeSampleData } from '../persist/sampleStorage'
import { useAppStore } from '../state/appStore'
import { useProjectStore } from '../state/projectStore'
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

describe('SampleLibraryView key preview', () => {
  beforeEach(() => {
    resetStores()
    setStorage(createMemoryBackend())
    useProjectStore.setState({ slug: 'song' })
  })

  function setup(frames: number) {
    const smp = newSampleEntity('Cycle', 'h', 'cycle.wav', 48000, 1, frames)
    useDocStore.getState().addSampleEntity(smp)
    useAppStore.setState({ octave: 5 })
    const host = { ...stubHost(), stopSamplePreviews: vi.fn(), stopSamplePreview: vi.fn(), playSamplePreview: vi.fn(async () => {}) }
    render(<SampleLibraryView host={host as unknown as ReturnType<typeof stubHost>} />)
    return host
  }

  it('loops a single cycle at the key pitch until the key is released', async () => {
    await writeSampleData('song', 'h', new ArrayBuffer(8))
    const host = setup(2048)
    fireEvent.keyDown(window, { code: 'KeyZ' }) // C-4
    await waitFor(() => expect(host.playSamplePreview).toHaveBeenCalled())
    const [, , rate, loopKey] = host.playSamplePreview.mock.calls[0] as unknown as [string, ArrayBuffer, number, string]
    expect(rate * 48000 / 2048).toBeCloseTo(261.63, 1)
    expect(loopKey).toBe('KeyZ')
    fireEvent.keyUp(window, { code: 'KeyZ' })
    expect(host.stopSamplePreview).toHaveBeenCalledWith('KeyZ')
  })

  it('plays longer samples once', async () => {
    await writeSampleData('song', 'h', new ArrayBuffer(8))
    const host = setup(48000)
    fireEvent.keyDown(window, { code: 'KeyZ' })
    await waitFor(() => expect(host.playSamplePreview).toHaveBeenCalled())
    expect((host.playSamplePreview.mock.calls[0] as unknown[])[3]).toBeUndefined()
  })
})
