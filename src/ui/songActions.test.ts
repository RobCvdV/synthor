import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultDoc } from '../domain/factory'
import { makeSongFile, serializeSong } from '../persist/serialize'
import { useDialogStore, type TextRequest } from '../state/dialogStore'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { createNewSong, importSongFile, renameCurrentSong } from './songActions'

const saved = vi.hoisted(() => ({ slugs: [] as string[] }))
const saveCurrentSong = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('../persist/opfsStore', async (orig) => ({
  ...(await orig<object>()),
  isOpfsSupported: () => true,
  listSongs: async () => saved.slugs.map((slug) => ({ slug, meta: {} })),
  saveRecent: async () => {},
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
    saved.slugs = []
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
})
