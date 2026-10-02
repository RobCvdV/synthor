/**
 * Electron main process — creates the BrowserWindow and loads the renderer.
 *
 * In development the renderer is served by Vite's dev server (localhost).
 * In production the renderer is loaded from the bundled `dist/` directory.
 */

import { app, BrowserWindow, ipcMain, Menu, session, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSettingsFile, type SettingsFile } from './appSettings.js'
import { createLibraryFs } from './libraryFs.js'
import { buildMenuTemplate } from './appMenu.js'
import { createOpenFileQueue, songPathsFromArgv } from './openFiles.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isDev = !app.isPackaged

// CDP debugging hook for packaged builds (Synthor.app --env SYNTHOR_CDP_PORT=9223).
if (process.env.SYNTHOR_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.SYNTHOR_CDP_PORT)
}

// Isolated profile for test runs (settings.json there can point libraryPath elsewhere).
if (process.env.SYNTHOR_USER_DATA) app.setPath('userData', process.env.SYNTHOR_USER_DATA)

let mainWindow: BrowserWindow | null = null

const openFiles = createOpenFileQueue((file) => mainWindow?.webContents.send('files:open', file))

function showMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

// One instance: a second launch (e.g. double-clicking a song on Windows/Linux) hands its files to the first.
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.quit()
app.on('second-instance', (_e, argv) => {
  for (const p of songPathsFromArgv(argv)) openFiles.open(p)
  showMainWindow()
})
// macOS delivers double-clicked files through open-file, possibly before ready.
app.on('will-finish-launching', () => {
  app.on('open-file', (e, p) => {
    e.preventDefault()
    openFiles.open(p)
    if (app.isReady() && !mainWindow) createWindow()
    showMainWindow()
  })
})
for (const p of songPathsFromArgv(process.argv.slice(1))) openFiles.open(p)

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e1014',
    title: 'Synthor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for AudioWorklet
    },
  })

  mainWindow = win
  win.on('closed', () => { if (mainWindow === win) mainWindow = null })
  // A (re)loading renderer has to ask for queued files again.
  win.webContents.on('did-start-loading', () => openFiles.resetRenderer())

  // Open external links in the default browser, not Electron.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    // Vite dev server — use the ELECTRON_DEV_PORT env var or default to 5193.
    const port = process.env.ELECTRON_DEV_PORT || '5193'
    void win.loadURL(`http://localhost:${port}`)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

/** Storage, settings and library IPC for the renderer (see preload.cts). */
function registerIpc(settingsFile: SettingsFile): void {
  const { settings } = settingsFile
  const libraryPath = settings.libraryPath ?? path.join(app.getPath('documents'), 'Synthor')
  fs.mkdirSync(libraryPath, { recursive: true })
  const lib = createLibraryFs(libraryPath)

  ipcMain.handle('storage:readText', (_e, rel: string) => lib.readText(rel))
  ipcMain.handle('storage:readBytes', (_e, rel: string) => lib.readBytes(rel))
  ipcMain.handle('storage:write', (_e, rel: string, data: string | Uint8Array) => lib.write(rel, data))
  ipcMain.handle('storage:list', (_e, rel: string) => lib.list(rel))
  ipcMain.handle('storage:exists', (_e, rel: string) => lib.exists(rel))
  ipcMain.handle('storage:remove', (_e, rel: string) => lib.remove(rel))

  // Sync so the renderer's persisted state hydrates before first render.
  ipcMain.on('settings:load', (e) => {
    e.returnValue = {
      libraryPath,
      importedBrowserOrigins: settings.importedBrowserOrigins ?? [],
      store: settings.store,
    }
  })
  ipcMain.on('settings:setItem', (_e, key: string, value: string | null) => settingsFile.setItem(key, value))
  ipcMain.handle('settings:markBrowserStorageImported', (_e, origin: string) => {
    const origins = settings.importedBrowserOrigins ?? []
    if (!origins.includes(origin)) settingsFile.update({ importedBrowserOrigins: [...origins, origin] })
  })

  ipcMain.handle('library:reveal', () => shell.openPath(libraryPath))
  ipcMain.handle('files:take', () => openFiles.take())
}

void app.whenReady().then(() => {
  if (!isPrimaryInstance) return
  const settingsFile = createSettingsFile(path.join(app.getPath('userData'), 'settings.json'))
  app.on('before-quit', settingsFile.flush)
  registerIpc(settingsFile)

  // Cross-origin isolation so the renderer gets SharedArrayBuffer (Elementary
  // needs it). loadFile can't set headers, so inject them on file:// responses.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith('file://')) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Cross-Origin-Opener-Policy': ['same-origin'],
          'Cross-Origin-Embedder-Policy': ['require-corp'],
        },
      })
    } else {
      callback({ responseHeaders: details.responseHeaders })
    }
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(process.platform, (command) => {
    if (mainWindow) mainWindow.webContents.send('menu:command', command)
    else createWindow()
  })))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
