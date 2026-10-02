import { describe, expect, it, vi } from 'vitest'
import { createOpenFileQueue, songPathsFromArgv } from './openFiles'

const fakeRead = vi.fn(async (p: string) => {
  if (p.includes('missing')) throw new Error('ENOENT')
  return Buffer.from(p)
})

describe('songPathsFromArgv', () => {
  it('keeps .synthor paths, skipping flags and other files', () => {
    expect(songPathsFromArgv(['/App/Synthor', '--flag', '/a/Song.SYNTHOR', 'b.txt', 'c.synthor'])).toEqual(['/a/Song.SYNTHOR', 'c.synthor'])
  })
})

describe('createOpenFileQueue', () => {
  it('holds files until the renderer takes them, then delivers new ones directly', async () => {
    const deliver = vi.fn()
    const q = createOpenFileQueue(deliver, fakeRead as never)
    q.open('/songs/a.synthor')
    q.open('/songs/missing.synthor')
    expect(deliver).not.toHaveBeenCalled()

    const taken = await q.take()
    expect(taken.map((f) => [f.name, Buffer.from(f.bytes).toString()])).toEqual([['a.synthor', '/songs/a.synthor']])

    q.open('/songs/b.synthor')
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ name: 'b.synthor' })))
    expect(await q.take()).toEqual([])
  })

  it('queues again after the renderer reloads', async () => {
    const deliver = vi.fn()
    const q = createOpenFileQueue(deliver, fakeRead as never)
    await q.take()
    q.resetRenderer()
    q.open('/songs/c.synthor')
    expect(deliver).not.toHaveBeenCalled()
    expect((await q.take()).map((f) => f.name)).toEqual(['c.synthor'])
  })
})
