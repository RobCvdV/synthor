import { beforeEach, describe, expect, it } from 'vitest'
import { oldestWait, useStorageStatus } from './storageStatus'

const st = () => useStorageStatus.getState()

describe('storageStatus', () => {
  beforeEach(() => useStorageStatus.setState({ waits: {} }))

  it('tracks a file until its last concurrent read ends', () => {
    st().beginRead('songs/a/song.json', 100)
    st().beginRead('songs/a/song.json', 200)
    st().endRead('songs/a/song.json')
    expect(st().waits['songs/a/song.json']).toEqual({ path: 'songs/a/song.json', since: 100, reads: 1, cloud: false })
    st().endRead('songs/a/song.json')
    st().endRead('songs/a/song.json')
    expect(st().waits).toEqual({})
  })

  it('marks pending reads as iCloud downloads, ignoring unknown paths', () => {
    st().beginRead('a', 0)
    st().markCloud('a')
    st().markCloud('b')
    expect(Object.values(st().waits).map((w) => [w.path, w.cloud])).toEqual([['a', true]])
  })

  it('finds the oldest wait', () => {
    expect(oldestWait({})).toBeNull()
    st().beginRead('new', 50)
    st().beginRead('old', 10)
    expect(oldestWait(st().waits)?.path).toBe('old')
  })
})
