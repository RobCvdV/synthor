import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ICLOUD_CONTAINER, icloudDocumentsPath, loadICloudAddon } from './icloud'

describe('loadICloudAddon', () => {
  it('only exists on macOS, and is null when no build is found', () => {
    expect(loadICloudAddon(['/nowhere/icloud.node'], 'win32')).toBeNull()
    expect(loadICloudAddon(['/nowhere/icloud.node', '/also/missing.node'], 'darwin')).toBeNull()
  })
})

describe('icloudDocumentsPath', () => {
  let tmp: string | undefined
  afterEach(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true })
    tmp = undefined
  })

  it('creates and returns the container’s Documents folder', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'synthor-icloud-'))
    const containerPath = vi.fn(async () => tmp!)
    const docs = await icloudDocumentsPath({ containerPath })
    expect(containerPath).toHaveBeenCalledWith(ICLOUD_CONTAINER)
    expect(docs).toBe(path.join(tmp, 'Documents'))
    expect((await fs.stat(docs!)).isDirectory()).toBe(true)
  })

  it('is null without an addon, without iCloud, or when the lookup fails', async () => {
    expect(await icloudDocumentsPath(null)).toBeNull()
    expect(await icloudDocumentsPath({ containerPath: async () => null })).toBeNull()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await icloudDocumentsPath({ containerPath: async () => { throw new Error('no') } })).toBeNull()
  })
})
