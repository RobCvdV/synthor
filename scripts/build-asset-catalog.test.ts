import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain .mjs build script
import { appIconContents } from './build-asset-catalog.mjs'

describe('appIconContents', () => {
  it('fills every macOS icon slot from a stamped PNG that exists', () => {
    const { images } = appIconContents() as { images: { size: string; scale: string; filename: string }[] }
    expect(images.map((i) => `${i.size}@${i.scale}`)).toEqual([
      '16x16@1x', '16x16@2x', '32x32@1x', '32x32@2x', '128x128@1x', '128x128@2x', '256x256@1x', '256x256@2x', '512x512@1x', '512x512@2x',
    ])
    expect(images.find((i) => i.size === '512x512' && i.scale === '2x')?.filename).toBe('icon-1024x1024.png')
    for (const { filename } of images) expect(existsSync(path.join('public', 'icons', filename)), filename).toBe(true)
  })
})
