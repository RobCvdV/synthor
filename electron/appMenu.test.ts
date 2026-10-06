import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { buildMenuTemplate } from './appMenu'

const fileMenu = (platform: NodeJS.Platform, send = vi.fn()) =>
  (buildMenuTemplate(platform, send, vi.fn()).find((m) => m.label === 'File')!.submenu as MenuItemConstructorOptions[])

describe('buildMenuTemplate', () => {
  it('has the File commands with their shortcuts', () => {
    const items = fileMenu('darwin').filter((i) => i.label).map((i) => [i.label, i.accelerator])
    expect(items).toEqual([
      ['New Song…', 'CmdOrCtrl+N'],
      ['Open Song…', 'CmdOrCtrl+O'],
      ['Save', 'CmdOrCtrl+S'],
      ['Save As…', 'Shift+CmdOrCtrl+S'],
      ['Import Song…', undefined],
      ['Export Song…', undefined],
      ['Show Library in Finder', undefined],
    ])
  })

  it('sends the command when an item is clicked', () => {
    const send = vi.fn()
    const save = fileMenu('darwin', send).find((i) => i.label === 'Save')!
    ;(save.click as () => void)()
    expect(send).toHaveBeenCalledWith('save')
  })

  it('puts the app menu first on macOS, and Quit under File elsewhere', () => {
    expect(buildMenuTemplate('darwin', vi.fn(), vi.fn())[0].label).toBe('Synthor')
    const win = buildMenuTemplate('win32', vi.fn(), vi.fn())
    expect(win[0].label).toBe('File')
    expect(fileMenu('win32').at(-1)).toEqual({ role: 'quit' })
    expect(fileMenu('linux').some((i) => i.label === 'Show Library Folder')).toBe(true)
  })

  it('checks for updates from the app menu on macOS, and from Help elsewhere', () => {
    const check = vi.fn()
    const find = (platform: NodeJS.Platform, menu: string) =>
      (buildMenuTemplate(platform, vi.fn(), check).find((m) => m.label === menu)!.submenu as MenuItemConstructorOptions[])
        .find((i) => i.label === 'Check for Updates…')!
    ;(find('darwin', 'Synthor').click as () => void)()
    ;(find('win32', 'Help').click as () => void)()
    expect(check).toHaveBeenCalledTimes(2)
    expect(buildMenuTemplate('darwin', vi.fn(), check).some((m) => m.label === 'Help')).toBe(false)
  })
})
