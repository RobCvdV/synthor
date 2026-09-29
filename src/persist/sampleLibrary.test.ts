import { beforeEach, describe, expect, it } from 'vitest'
import { newSampleEntity } from '../domain/factory'
import { createMemoryBackend } from './memoryBackend'
import {
  deleteLibrarySample, listLibrarySamples, readLibrarySampleAudio, readLibrarySampleItem, safeAudioFileName,
  saveSampleToLibrary, updateLibrarySample,
} from './sampleLibrary'
import { setStorage } from './storage'

const kick = () => newSampleEntity('Kick', 'aa11', 'kick 01.wav', 48000, 1, 4800)
const audio = () => new Uint8Array([1, 2, 3]).buffer

describe('sample library', () => {
  let mem: ReturnType<typeof createMemoryBackend>
  beforeEach(() => {
    mem = createMemoryBackend()
    setStorage(mem)
  })

  it('stores the audio under its original file name next to sample.json', async () => {
    const id = await saveSampleToLibrary(kick(), audio(), { category: ' Drums ', tags: ['Punchy'] })
    expect(id).toBe('kick')
    expect([...mem.files.keys()].sort()).toEqual(['samples/kick/kick 01.wav', 'samples/kick/sample.json'])
    const [item] = await listLibrarySamples()
    expect(item).toMatchObject({
      id: 'kick', name: 'Kick', fileName: 'kick 01.wav', category: 'Drums', tags: ['punchy'],
      sample: { hash: 'aa11', originalName: 'kick 01.wav', sampleRate: 48000, channels: 1, frames: 4800 },
    })
    const back = await readLibrarySampleAudio(id)
    expect([...new Uint8Array(back!.bytes)]).toEqual([1, 2, 3])
  })

  it('saves under another name and keeps same-named samples apart', async () => {
    expect(await saveSampleToLibrary(kick(), audio(), { name: 'Big Kick' })).toBe('big-kick')
    expect(await saveSampleToLibrary(kick(), audio(), { name: 'Big Kick' })).toBe('big-kick-2')
    expect((await readLibrarySampleItem('big-kick-2'))!.name).toBe('Big Kick')
  })

  it('replaces in place, keeping the creation date', async () => {
    const id = await saveSampleToLibrary(kick(), audio())
    const created = (await readLibrarySampleItem(id))!.createdAt
    const other = newSampleEntity('Kick', 'bb22', 'kick-v2.wav', 44100, 2, 10)
    await saveSampleToLibrary(other, audio(), { replaceId: id })
    const item = (await readLibrarySampleItem(id))!
    expect(item).toMatchObject({ fileName: 'kick-v2.wav', createdAt: created, sample: { hash: 'bb22', channels: 2 } })
    expect(await mem.exists('samples/kick/kick 01.wav')).toBe(false)
  })

  it('applies overlapping edits in order', async () => {
    const id = await saveSampleToLibrary(kick(), audio())
    await Promise.all([
      updateLibrarySample(id, { name: 'Kick 2' }),
      updateLibrarySample(id, { category: 'Drums' }),
      updateLibrarySample(id, { tags: ['a', 'A'] }),
    ])
    expect(await readLibrarySampleItem(id)).toMatchObject({ name: 'Kick 2', category: 'Drums', tags: ['a'] })
  })

  it('skips unreadable entries, reports missing audio, and deletes', async () => {
    const id = await saveSampleToLibrary(kick(), audio())
    await mem.write('samples/bad/sample.json', '{"format":"other"}')
    await mem.write('samples/loose.wav', 'x')
    expect((await listLibrarySamples()).map((i) => i.id)).toEqual([id])
    await mem.remove('samples/kick/kick 01.wav')
    expect(await readLibrarySampleAudio(id)).toBeNull()
    await deleteLibrarySample(id)
    expect(await readLibrarySampleItem(id)).toBeNull()
  })

  it('makes safe audio file names', () => {
    expect(safeAudioFileName('a/b:c.wav')).toBe('a_b_c.wav')
    expect(safeAudioFileName('..hidden.wav')).toBe('hidden.wav')
    expect(safeAudioFileName('sample.json')).toBe('audio.wav')
    expect(safeAudioFileName('')).toBe('audio.wav')
  })
})
