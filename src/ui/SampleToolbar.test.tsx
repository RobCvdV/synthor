// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { newSampleEntity } from '../domain/factory'
import { createMemoryBackend } from '../persist/memoryBackend'
import { listLibrarySamples, saveSampleToLibrary } from '../persist/sampleLibrary'
import { setStorage } from '../persist/storage'
import { SampleToolbar } from './SampleToolbar'
import { resetStores, stubHost } from './test/testUtils'

const pickFiles = vi.hoisted(() => vi.fn(async (): Promise<File[]> => []))
vi.mock('./pickFiles', () => ({ pickFiles }))
vi.mock('../audio/sampleLoader', () => ({
  loadAudioFile: async (file: File) => ({ hash: `h-${file.name}`, sampleRate: 48000, channels: 1, frames: 10, sampleData: new Float32Array(10) }),
}))

const choose = (label: string) => {
  const select = screen.getByLabelText('Add sample') as HTMLSelectElement
  fireEvent.change(select, { target: { value: Array.from(select.options).find((o) => o.text === label)!.value } })
}

describe('SampleToolbar', () => {
  beforeEach(() => {
    resetStores()
    setStorage(createMemoryBackend())
  })

  it('renders the add menu, library button and count', () => {
    const { container } = render(<SampleToolbar host={stubHost()} count={2} onSelect={() => {}} onCreate={() => {}} />)
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('hides the library without storage, and Create hands off to the page', () => {
    setStorage(null)
    const onCreate = vi.fn()
    render(<SampleToolbar host={stubHost()} count={0} onSelect={() => {}} onCreate={onCreate} />)
    expect(screen.queryByText('Library')).toBeNull()
    expect(Array.from((screen.getByLabelText('Add sample') as HTMLSelectElement).options).map((o) => o.text))
      .toEqual(['Add Sample +', 'Import…', 'Create…'])
    choose('Create…')
    expect(onCreate).toHaveBeenCalled()
  })

  it('imports files, then offers to keep the ones the library lacks', async () => {
    await saveSampleToLibrary(newSampleEntity('Old', 'h-old.wav', 'old.wav', 48000, 1, 10), new ArrayBuffer(1))
    pickFiles.mockResolvedValueOnce([new File(['x'], 'new.wav'), new File(['y'], 'old.wav')])
    const onSelect = vi.fn()
    render(<SampleToolbar host={stubHost()} count={0} onSelect={onSelect} onCreate={() => {}} />)

    choose('Import…')
    await screen.findByText('Add to Library?')
    expect(onSelect).toHaveBeenCalled()
    expect(screen.getByText('2 samples were added to the song. Keep them in your library too?')).toBeTruthy()
    fireEvent.click(screen.getByText('Add 1 to library'))
    await vi.waitFor(async () => expect((await listLibrarySamples()).map((i) => i.fileName).sort()).toEqual(['new.wav', 'old.wav']))
  })

  it('previews library samples through the host', async () => {
    await saveSampleToLibrary(newSampleEntity('Kick', 'hk', 'kick.wav', 48000, 1, 10), new Uint8Array([3]).buffer)
    const host = stubHost()
    const play = vi.fn(async () => {})
    host.playSamplePreview = play
    render(<SampleToolbar host={host} count={0} onSelect={() => {}} onCreate={() => {}} />)
    choose('From library…')
    fireEvent.click(await screen.findByLabelText('Play Kick'))
    await vi.waitFor(() => expect(play).toHaveBeenCalledWith('hk', expect.any(ArrayBuffer)))
    fireEvent.click(screen.getByText('Kick'))
    expect(screen.getByText(/^Mono · 48000 Hz · /)).toBeTruthy()
  })
})
