import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain .mjs release script
import { icns, stampSvg, versionDigits, versionRow } from './stamp-version.mjs'

describe('stamp-version', () => {
  it('writes the version as a tracker row', () => {
    expect(versionRow('0.1.5')).toBe('C-0 01 05')
    expect(versionRow('deploy-v1.0.0')).toBe('C-1 00 00')
    expect(versionRow('v0.12.34')).toBe('C-0 12 34')
  })

  it('refuses versions the row cannot show', () => {
    expect(() => versionDigits('10.0.0')).toThrow(/doesn't fit/)
    expect(() => versionDigits('0.100.0')).toThrow(/doesn't fit/)
    expect(() => versionDigits('0.1')).toThrow(/Not a version/)
  })

  it('points the logo digit slots at the version, and only those', () => {
    const svg = readFileSync('public/favicon.svg', 'utf8')
    const out = stampSvg(svg, '1.23.45')
    const slots = [...out.matchAll(/<use id="(v-[a-z0-9-]+)" href="#digit-(\d)"/g)].map((m) => `${m[1]}=${m[2]}`)
    expect(slots).toEqual(['v-major=1', 'v-minor-1=2', 'v-minor-2=3', 'v-patch-1=4', 'v-patch-2=5'])
    expect(stampSvg(out, '0.1.5').replace(/digit-\d"/g, '')).toBe(svg.replace(/digit-\d"/g, ''))
  })

  it('packs PNGs into an icns container', () => {
    const png = (n: number) => Buffer.alloc(n, 1)
    const file = icns(new Map([16, 32, 64, 128, 256, 512, 1024].map((s) => [s, png(s)])))
    expect(file.toString('ascii', 0, 4)).toBe('icns')
    expect(file.readUInt32BE(4)).toBe(file.length)
    expect(file.toString('ascii', 8, 12)).toBe('icp4')
    expect(file.readUInt32BE(12)).toBe(8 + 16)
  })
})
