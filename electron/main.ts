/**
 * Electron main process — creates the BrowserWindow and loads the renderer.
 *
 * In development the renderer is served by Vite's dev server (localhost).
 * In production the renderer is loaded from the bundled `dist/` directory.
 */

import { app, BrowserWindow, Menu, session, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isDev = !app.isPackaged

// CDP debugging hook for packaged builds (Synthor.app --env SYNTHOR_CDP_PORT=9223).
if (process.env.SYNTHOR_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.SYNTHOR_CDP_PORT)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e1014',
    title: 'Synthor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for AudioWorklet
    },
  })

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

// Basic application menu (macOS-friendly).
const template: Electron.MenuItemConstructorOptions[] = [
  {
    label: 'Synthor',
    submenu: [
      { role: 'about' as const },
      { type: 'separator' as const },
      { role: 'quit' as const },
    ],
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' as const },
      { role: 'redo' as const },
    ],
  },
  {
    label: 'View',
    submenu: [
      { role: 'reload' as const },
      { role: 'forceReload' as const },
      { role: 'toggleDevTools' as const },
      { type: 'separator' as const },
      { role: 'resetZoom' as const },
      { role: 'zoomIn' as const },
      { role: 'zoomOut' as const },
    ],
  },
  {
    label: 'Window',
    submenu: [
      { role: 'minimize' as const },
      { role: 'zoom' as const },
      { type: 'separator' as const },
      { role: 'front' as const },
    ],
  },
]

void app.whenReady().then(() => {
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

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
