import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultDoc } from '../domain/factory'
import { makeSongFile, serializeSong } from '../persist/serialize'
import { useDialogStore, type TextRequest } from '../state/dialogStore'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { useAppStore } from '../state/appStore'
import type { SongFile } from '../persist/serialize'
import { createMemoryBackend } from '../persist/memoryBackend'
import { setStorage } from '../persist/storage'
import { createNewSong, importSongFile, loadStartupSong, renameCurrentSong, saveCurrentSongAs } from './songActions'
import { storage } from '../persist/storage'

const saved = vi.hoisted(() => ({ slugs: [] as string[], recent: null as string | null, files: {} as Record<string, SongFile> }))
const saveCurrentSong = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('../persist/songStore', async (orig) => ({
  ...(await orig<object>()),
  listSongs: async () => saved.slugs.map((slug) => ({ slug, meta: {} })),
  saveRecent: async () => {},
  loadRecent: async () => saved.recent,
  readSong: async (slug: string) => saved.files[slug] ?? null,
}))
vi.mock('../persist/saveCurrent', () => ({ saveCurrentSong }))

/** Waits for the next dialog and returns its request. */
async function nextDialog(): Promise<TextRequest> {
  await vi.waitFor(() => expect(useDialogStore.getState().request).not.toBeNull())
  return useDialogStore.getState().request as TextRequest
}

const answer = (a: string | boolean | null) => useDialogStore.getState().answer(a)

describe('songActions', () => {
  beforeEach(() => {
    setStorage(createMemoryBackend())
    saved.slugs = []
    saved.recent = null
    saved.files = {}
    saveCurrentSong.mockClear()
    useDialogStore.setState({ request: null, resolve: null })
    useProjectStore.getState().reset('Current', '2026-01-01T00:00:00.000Z')
  })

  it('creates a new song under a free suggested name and saves it', async () => {
    saved.slugs = ['untitled', 'current']
    useProjectStore.getState().markDirty()
    const done = createNewSong()

    const prompt = await nextDialog()
    expect(prompt.defaultValue).toBe('Untitled 2')
    expect(prompt.validate?.('Current')).toMatch(/already/)
    answer('Groove')
    await done

    expect(useProjectStore.getState()).toMatchObject({ name: 'Groove', slug: 'groove' })
    // Once to settle the edited song, once to save the new one.
    expect(saveCurrentSong).toHaveBeenCalledTimes(2)
  })

  it('keeps the current song when the name prompt is cancelled', async () => {
    const doc = useDocStore.getState().doc
    const done = createNewSong()
    await nextDialog()
    answer(null)
    await done
    expect(useProjectStore.getState().name).toBe('Current')
    expect(useDocStore.getState().doc).toBe(doc)
  })

  it('renames directly when the name is free', async () => {
    await renameCurrentSong('Better name')
    expect(useProjectStore.getState().name).toBe('Better name')
    expect(useDialogStore.getState().request).toBeNull()
  })

  it('asks for another name when a different song uses it', async () => {
    saved.slugs = ['current', 'taken']
    const done = renameCurrentSong('Taken')
    const prompt = await nextDialog()
    expect(prompt.message).toMatch(/already used/)
    answer('Free')
    await done
    expect(useProjectStore.getState().name).toBe('Free')
  })

  it('imports a song as a new song instead of over the current one', async () => {
    saved.slugs = ['current', 'groove']
    const file = makeSongFile(createDefaultDoc(), { name: 'Groove', createdAt: '2026-02-02T00:00:00.000Z', modifiedAt: '2026-02-02T00:00:00.000Z' })
    await importSongFile(new TextEncoder().encode(serializeSong(file)).buffer as ArrayBuffer)
    expect(useProjectStore.getState()).toMatchObject({ name: 'Groove 2', slug: 'groove-2', savedSlug: 'groove-2' })
  })

  it('opens the last session’s song and fits the saved cursor and instrument to it', async () => {
    const doc = createDefaultDoc()
    saved.recent = 'groove'
    saved.files.groove = makeSongFile(doc, { name: 'Groove', createdAt: '2026-03-03T00:00:00.000Z', modifiedAt: '2026-03-03T00:00:00.000Z' })
    useAppStore.setState({ trackerCursor: { row: 999, track: 99, col: 0, laneIndex: null }, selectedInstrumentId: 'gone' })

    await loadStartupSong()

    expect(useProjectStore.getState()).toMatchObject({ name: 'Groove', slug: 'groove' })
    expect(useDocStore.getState().doc.entities.instruments).toEqual(doc.entities.instruments)
    const { trackerCursor, selectedInstrumentId } = useAppStore.getState()
    expect(trackerCursor.track).toBe(doc.entities.patterns[doc.patternId].trackIds.length - 1)
    expect(Object.keys(doc.entities.instruments)).toContain(selectedInstrumentId)
  })

  it('names the default song Untitled without a previous session', async () => {
    await loadStartupSong()
    expect(useProjectStore.getState().name).toBe('Untitled')
  })

  it('saves as a new name, copying the samples and leaving the original', async () => {
    saved.slugs = ['current']
    const s = storage()!
    await s.write('songs/current/samples/abc.bin', new Uint8Array([1]).buffer)
    await s.write('songs/current/song.json', '{}')
    const doc = useDocStore.getState().doc
    const done = saveCurrentSongAs()

    const prompt = await nextDialog()
    expect(prompt.defaultValue).toBe('Current copy')
    expect(prompt.validate?.('current')).toMatch(/already/)
    answer('Current v2')
    await done

    expect(useProjectStore.getState()).toMatchObject({ name: 'Current v2', slug: 'current-v2', savedSlug: 'current-v2' })
    expect(await s.exists('songs/current-v2/samples/abc.bin')).toBe(true)
    expect(await s.exists('songs/current/samples/abc.bin')).toBe(true)
    expect(useDocStore.getState().doc).toBe(doc)
    expect(saveCurrentSong).toHaveBeenCalledTimes(1)
  })

  it('keeps the current song when Save As is cancelled', async () => {
    const done = saveCurrentSongAs()
    await nextDialog()
    answer(null)
    await done
    expect(useProjectStore.getState().name).toBe('Current')
    expect(saveCurrentSong).not.toHaveBeenCalled()
  })
})
