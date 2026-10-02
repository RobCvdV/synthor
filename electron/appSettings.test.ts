import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSettingsFile, loadSettings } from './appSettings'

describe('appSettings', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synthor-settings-'))
    file = path.join(dir, 'nested', 'settings.json')
  })
  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('defaults to an empty store when the file is missing or corrupt', () => {
    expect(loadSettings(file)).toEqual({ store: {} })
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{oops')
    expect(loadSettings(file)).toEqual({ store: {} })
  })

  it('debounces writes and round-trips through the file', () => {
    vi.useFakeTimers()
    const s = createSettingsFile(file)
    s.setItem('a', '1')
    s.setItem('b', '2')
    s.setItem('a', null)
    s.update({ importedBrowserOrigins: ['file://'] })
    expect(fs.existsSync(file)).toBe(false)
    vi.runAllTimers()
    expect(loadSettings(file)).toEqual({ importedBrowserOrigins: ['file://'], store: { b: '2' } })
  })

  it('flush writes a pending change immediately and is a no-op otherwise', () => {
    vi.useFakeTimers()
    const s = createSettingsFile(file)
    s.flush()
    expect(fs.existsSync(file)).toBe(false)
    s.setItem('k', 'v')
    s.flush()
    expect(loadSettings(file).store).toEqual({ k: 'v' })
    expect(fs.readdirSync(path.dirname(file))).toEqual(['settings.json'])
  })
})
