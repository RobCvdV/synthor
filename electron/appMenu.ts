/** The application menu. File commands are sent to the renderer, which owns the song logic. */
import type { MenuItemConstructorOptions } from 'electron'

/** Keep in sync with `AppCommand` in `src/persist/electronBridge.ts`. */
export type AppCommand = 'newSong' | 'openSong' | 'save' | 'saveAs' | 'importSong' | 'exportSong' | 'revealLibrary'

export function buildMenuTemplate(
  platform: NodeJS.Platform,
  send: (command: AppCommand) => void,
  checkForUpdates: () => void,
): MenuItemConstructorOptions[] {
  const isMac = platform === 'darwin'
  const item = (label: string, command: AppCommand, accelerator?: string): MenuItemConstructorOptions =>
    ({ label, accelerator, click: () => send(command) })

  const updates: MenuItemConstructorOptions = { label: 'Check for Updates…', click: checkForUpdates }

  const file: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      item('New Song…', 'newSong', 'CmdOrCtrl+N'),
      item('Open Song…', 'openSong', 'CmdOrCtrl+O'),
      { type: 'separator' },
      item('Save', 'save', 'CmdOrCtrl+S'),
      item('Save As…', 'saveAs', 'Shift+CmdOrCtrl+S'),
      { type: 'separator' },
      item('Import Song…', 'importSong'),
      item('Export Song…', 'exportSong'),
      { type: 'separator' },
      item(isMac ? 'Show Library in Finder' : 'Show Library Folder', 'revealLibrary'),
      ...(isMac ? [] : [{ type: 'separator' } as const, { role: 'quit' } as const]),
    ],
  }

  return [
    ...(isMac ? [{
      label: 'Synthor',
      submenu: [{ role: 'about' }, updates, { type: 'separator' }, { role: 'quit' }],
    } as MenuItemConstructorOptions] : []),
    file,
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }] },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' } as const, { role: 'front' } as const] : [])] },
    ...(isMac ? [] : [{ label: 'Help', submenu: [updates] }]),
  ]
}
