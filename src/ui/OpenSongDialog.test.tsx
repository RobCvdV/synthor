// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createDefaultDoc } from '../domain/factory'
import { createMemoryBackend } from '../persist/memoryBackend'
import { makeSongFile } from '../persist/serialize'
import { writeSong } from '../persist/songStore'
import { setStorage } from '../persist/storage'
import { OpenSongDialog } from './OpenSongDialog'

const meta = (name: string) => ({ name, createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' })
const names = () => screen.getAllByRole('listitem').map((li) => li.querySelector('span')?.textContent)

describe('OpenSongDialog', () => {
  beforeEach(async () => {
    setStorage(createMemoryBackend())
    for (const n of ['Groove', 'ambient drift', 'Groove Night']) await writeSong(makeSongFile(createDefaultDoc(), meta(n)))
  })

  it('lists songs by name and marks the open one', async () => {
    const { baseElement } = render(<OpenSongDialog currentSlug="groove" onOpen={() => {}} onClose={() => {}} />)
    await screen.findByText('Groove Night')
    expect(names()).toEqual(['ambient drift', 'Groove', 'Groove Night'])
    expect(baseElement.innerHTML).toMatchSnapshot()
  })

  it('searches, and opens the only match with Enter', async () => {
    const onOpen = vi.fn()
    render(<OpenSongDialog currentSlug="" onOpen={onOpen} onClose={() => {}} />)
    await screen.findByText('Groove')
    const search = screen.getByLabelText('Search songs')
    fireEvent.change(search, { target: { value: 'night' } })
    expect(names()).toEqual(['Groove Night'])
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('groove-night')
  })

  it('opens the selected song, or one on double-click', async () => {
    const onOpen = vi.fn()
    render(<OpenSongDialog currentSlug="" onOpen={onOpen} onClose={() => {}} />)
    expect(screen.getByText('Open')).toBeDisabled()
    fireEvent.click(await screen.findByText('Groove'))
    fireEvent.click(screen.getByText('Open'))
    expect(onOpen).toHaveBeenLastCalledWith('groove')
    fireEvent.doubleClick(screen.getByText('ambient drift'))
    expect(onOpen).toHaveBeenLastCalledWith('ambient-drift')
  })

  it('says when there are no songs', async () => {
    setStorage(createMemoryBackend())
    render(<OpenSongDialog currentSlug="" onOpen={() => {}} onClose={() => {}} />)
    expect(await screen.findByText('No saved songs yet.')).toBeTruthy()
  })
})
