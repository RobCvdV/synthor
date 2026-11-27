import { describe, expect, it, vi } from 'vitest'
import { createWavetableVfs, type WavetableVfsHost } from './wavetableVfs'
import { wavetableMipKey, type WavetableMipRequest } from '../engine/wavetableMips'

function fakeHost() {
  const store = new Map<string, Float32Array>()
  const host: WavetableVfsHost & { store: typeof store } = {
    store,
    listVfs: vi.fn(async () => new Set(store.keys())),
    updateVfs: vi.fn(async (vfs: Record<string, Float32Array>) => {
      for (const [k, v] of Object.entries(vfs)) store.set(k, v)
    }),
  }
  return host
}

const request = (hash: string, size: number, channels = 1): WavetableMipRequest => ({
  hash, size, keys: Array.from({ length: channels }, (_, c) => wavetableMipKey(hash, size, c)),
})
const pcm = (hash: string, channels = 1) => new Map([[hash, Array.from({ length: channels }, () => new Float32Array(512).fill(0.5))]])

describe('createWavetableVfs', () => {
  it('builds and uploads the wanted tables, then reports their keys', async () => {
    const host = fakeHost()
    const onChange = vi.fn()
    const mips = createWavetableVfs(host, onChange)
    mips.setPcm(pcm('a', 2))
    await mips.ensure([request('a', 256, 2)])
    expect([...mips.keys()].sort()).toEqual(['a:wt:256:c0', 'a:wt:256:c1'])
    expect(host.store.get('a:wt:256:c0')?.[1]).toBe(2) // two 256-frame cycles in 512 frames
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('skips tables already in the VFS and samples it has no audio for', async () => {
    const host = fakeHost()
    host.store.set('a:wt:256:c0', new Float32Array(1))
    const mips = createWavetableVfs(host, () => {})
    mips.setPcm(pcm('b'))
    await mips.ensure([request('a', 256), request('c', 256)])
    expect(host.updateVfs).not.toHaveBeenCalled()
    expect([...mips.keys()]).toEqual(['a:wt:256:c0'])
  })

  it('builds again what a prune dropped', async () => {
    const host = fakeHost()
    const onChange = vi.fn()
    const mips = createWavetableVfs(host, onChange)
    mips.setPcm(pcm('a'))
    await mips.ensure([request('a', 256)])
    const before = mips.revision()
    host.store.clear()
    mips.invalidate()
    await mips.ensure([request('a', 256)])
    expect(host.updateVfs).toHaveBeenCalledTimes(2)
    expect([...mips.keys()]).toEqual(['a:wt:256:c0'])
    // Same keys, but a graph compiled meanwhile may be silent: it must recompile.
    expect(mips.revision()).toBeGreaterThan(before)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('drops keys no wave module wants any more', async () => {
    const host = fakeHost()
    const mips = createWavetableVfs(host, () => {})
    mips.setPcm(pcm('a'))
    await mips.ensure([request('a', 256)])
    await mips.ensure([request('a', 128)])
    expect([...mips.keys()]).toEqual(['a:wt:128:c0'])
  })
})
