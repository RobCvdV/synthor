/**
 * Electron main process — creates the BrowserWindow and loads the renderer.
 *
 * In development the renderer is served by Vite's dev server (localhost).
 * In production the renderer is loaded from the bundled `dist/` directory.
 */

import { app, BrowserWindow, Menu, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isDev = !app.isPackaged

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
    // Vite dev server — use the ELECTRON_DEV_PORT env var or default to 5173.
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
      { type: 'separator' as const },
      { role: 'cut' as const },
      { role: 'copy' as const },
      { role: 'paste' as const },
      { role: 'selectAll' as const },
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
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
