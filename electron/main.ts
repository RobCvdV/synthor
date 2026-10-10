/**
 * Electron main process — creates the BrowserWindow and loads the renderer.
 *
 * In development the renderer is served by Vite's dev server (localhost).
 * In production the renderer is loaded from the bundled `dist/` directory.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSettingsFile, type SettingsFile } from './appSettings.js'
import { createLibraryFs } from './libraryFs.js'
import { copyLibrary, libraryTargetProblem } from './libraryFolder.js'
import { icloudDocumentsPath, loadICloudAddon } from './icloud.js'
import { resolveLibrary, type LibraryLocation } from './libraryLocation.js'
import { buildMenuTemplate } from './appMenu.js'
import { createOpenFileQueue, songPathsFromArgv } from './openFiles.js'
import { checkForUpdatesInteractive, installUpdate, pendingUpdate, setupUpdater } from './updater.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isDev = !app.isPackaged

// CDP debugging hook for packaged builds (Synthor.app --env SYNTHOR_CDP_PORT=9223).
if (process.env.SYNTHOR_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.SYNTHOR_CDP_PORT)
}

// Isolated profile for test runs (settings.json there can point libraryPath elsewhere).
if (process.env.SYNTHOR_USER_DATA) app.setPath('userData', process.env.SYNTHOR_USER_DATA)

let mainWindow: BrowserWindow | null = null
/** Set once the library is resolved and IPC is registered; windows can't load before that. */
let started = false

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
    if (started && !mainWindow) createWindow()
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

const SAVE_BEFORE_QUIT_TIMEOUT_MS = 5000

/** Has the renderer save the song before quitting into an update; gives up after a few seconds. */
function saveBeforeQuit(): Promise<void> {
  const win = mainWindow
  if (!win || win.isDestroyed()) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      ipcMain.removeListener('app:saved', done)
      resolve()
    }
    const timer = setTimeout(done, SAVE_BEFORE_QUIT_TIMEOUT_MS)
    ipcMain.once('app:saved', done)
    win.webContents.send('app:save-before-quit')
  })
}

/** This launch's library, resolved before the window opens. */
let library: LibraryLocation

/**
 * Picks a new library folder (or takes `icloud`, the app's iCloud Drive folder), optionally copies
 * the library there, and relaunches on it.
 */
async function changeLibraryFolder(settingsFile: SettingsFile, icloud?: string): Promise<void> {
  const current = library.path
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  let target = icloud
  if (!target) {
    const picked = await (win ? dialog.showOpenDialog(win, LIBRARY_PICKER) : dialog.showOpenDialog(LIBRARY_PICKER))
    target = picked.canceled ? undefined : picked.filePaths[0]
  }
  if (!target) return

  const problem = libraryTargetProblem(current, target)
  const ask = (opts: Electron.MessageBoxOptions) => win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)
  if (problem) {
    await ask({ type: 'warning', message: 'Can’t use that folder', detail: problem })
    return
  }
  const { response } = await ask({
    type: 'question',
    buttons: ['Copy and Switch', 'Switch Only', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: icloud ? 'Keep the library in iCloud Drive › Synthor?' : `Use “${path.basename(target)}” as the library folder?`,
    detail: `Copy and Switch copies your songs, instruments and samples from ${current} (files already in the new folder are kept). `
      + 'Switch Only uses the new folder as it is. The current library stays where it is. Synthor restarts afterwards.',
  })
  if (response === 2) return

  await saveBeforeQuit()
  if (response === 0) {
    try {
      await copyLibrary(current, target)
    } catch (err) {
      await ask({ type: 'error', message: 'Copying the library failed', detail: err instanceof Error ? err.message : String(err) })
      return
    }
  }
  settingsFile.update(icloud ? { libraryPath: undefined, icloudLibrary: true } : { libraryPath: target })
  settingsFile.flush()
  app.relaunch()
  app.quit()
}

const LIBRARY_PICKER: Electron.OpenDialogOptions = {
  title: 'Choose Library Folder',
  buttonLabel: 'Use Folder',
  properties: ['openDirectory', 'createDirectory'],
}

/** The app's iCloud Drive folder, looked up once (null without iCloud or the entitlement). */
let icloudPath: Promise<string | null> = Promise.resolve(null)

function lookUpICloud(): void {
  const addon = loadICloudAddon([
    path.join(process.resourcesPath, 'icloud.node'),
    path.join(__dirname, '..', 'native', 'icloud', 'build', 'Release', 'icloud.node'),
  ])
  icloudPath = icloudDocumentsPath(addon)
  void icloudPath.then((p) => console.log('[icloud]', p ?? 'not available'))
}

/** Storage, settings and library IPC for the renderer (see preload.cts). */
function registerIpc(settingsFile: SettingsFile): void {
  const { settings } = settingsFile
  const libraryPath = library.path
  fs.mkdirSync(libraryPath, { recursive: true })
  const lib = createLibraryFs(libraryPath, {
    onCloudWait: (rel, waiting) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('storage:cloudWait', { path: rel, waiting })
    },
  })
  // Files iCloud moved off the Mac come back now rather than when a song needs them.
  void lib.prefetch().then((n) => { if (n) console.log(`[library] downloaded ${n} evicted files`) })

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
      libraryKind: library.kind,
      libraryNotice: library.notice ?? null,
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
  ipcMain.handle('icloud:path', () => icloudPath)
  ipcMain.handle('library:change', () => changeLibraryFolder(settingsFile))
  ipcMain.handle('library:useICloud', async () => {
    const icloud = await icloudPath
    if (icloud) await changeLibraryFolder(settingsFile, icloud)
  })
  ipcMain.handle('update:pending', () => pendingUpdate())
  ipcMain.handle('update:install', () => installUpdate(() => mainWindow, saveBeforeQuit))
  ipcMain.handle('files:take', () => openFiles.take())
}

void app.whenReady().then(async () => {
  if (!isPrimaryInstance) return
  const settingsFile = createSettingsFile(path.join(app.getPath('userData'), 'settings.json'))
  app.on('before-quit', settingsFile.flush)
  lookUpICloud()
  library = await resolveLibrary({
    settings: settingsFile.settings,
    icloudDocs: icloudPath,
    localDefault: path.join(app.getPath('documents'), 'Synthor'),
    update: (patch) => settingsFile.update(patch),
  })
  console.log(`[library] ${library.kind}: ${library.path}`)
  registerIpc(settingsFile)
  started = true

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
  }, {
    checkForUpdates: () => void checkForUpdatesInteractive(() => mainWindow, saveBeforeQuit),
    changeLibraryFolder: () => void changeLibraryFolder(settingsFile),
  })))
  createWindow()
  setupUpdater(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
