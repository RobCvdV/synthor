/**
 * Auto-update from GitHub Releases (the `latest*.yml` feeds the release workflow uploads).
 * Checks on launch, hourly and on focus; downloads in the background and reports its progress
 * to the toolbar, but only installs when the user clicks the toolbar's button or agrees in the menu.
 */
import { app, dialog, type BrowserWindow, type MessageBoxOptions, type MessageBoxSyncOptions } from 'electron'
import electronUpdater from 'electron-updater'

// CommonJS default export: the named import breaks under ESM interop.
const { autoUpdater } = electronUpdater

const HOUR_MS = 60 * 60 * 1000
const CHECK_INTERVAL_MS = HOUR_MS
const FOCUS_CHECK_MIN_GAP_MS = 15 * 60 * 1000

type GetWindow = () => BrowserWindow | null
type CheckResult = { kind: 'available'; version: string } | { kind: 'none' } | { kind: 'error'; error: unknown }
/** Mirrors `UpdateStatus` in src/persist/electronBridge.ts. */
export type UpdateStatus = { state: 'downloading'; version: string; percent: number } | { state: 'ready'; version: string } | null

/** The downloaded update waiting for the user's OK, or null. */
let downloadedVersion: string | null = null
let status: UpdateStatus = null
let lastCheckAt = 0
let notifyRenderer: (status: UpdateStatus) => void = () => {}

function setStatus(next: UpdateStatus): void {
  status = next
  downloadedVersion = next?.state === 'ready' ? next.version : null
  notifyRenderer(next)
}

/** Starts background checks. A no-op in development: updating needs the packaged, signed app. */
export function setupUpdater(getWindow: GetWindow): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  notifyRenderer = (next) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('update:status', next)
  }
  autoUpdater.on('update-available', (info) => {
    if (downloadedVersion !== info.version) setStatus({ state: 'downloading', version: info.version, percent: 0 })
  })
  autoUpdater.on('download-progress', (progress) => {
    if (status?.state === 'downloading') setStatus({ ...status, percent: Math.floor(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => setStatus({ state: 'ready', version: info.version }))
  // Best-effort: a failed check or download (offline, rate limit) must never interrupt the app; the next check retries.
  autoUpdater.on('error', (err) => {
    console.error('[updater]', err instanceof Error ? err.message : err)
    if (status?.state === 'downloading') setStatus(null)
  })

  void check()
  setInterval(() => void check(), CHECK_INTERVAL_MS)
  app.on('browser-window-focus', () => {
    if (!downloadedVersion && Date.now() - lastCheckAt >= FOCUS_CHECK_MIN_GAP_MS) void check()
  })
}

/** The current download or downloaded update, so a reloaded renderer can show it again. */
export function updateStatus(): UpdateStatus {
  return status
}

/** Always a fresh fetch; a download that is no longer the newest release is forgotten. */
async function check(): Promise<CheckResult> {
  lastCheckAt = Date.now()
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result?.isUpdateAvailable) {
      forget()
      return { kind: 'none' }
    }
    const version = result.updateInfo.version
    if (downloadedVersion && downloadedVersion !== version) forget()
    return { kind: 'available', version }
  } catch (error) {
    console.error('[updater] check failed', error)
    return { kind: 'error', error }
  }
}

function forget(): void {
  if (status) setStatus(null)
}

/** Runs `prepareQuit` (save the song) and relaunches into the downloaded update. */
async function install(prepareQuit: () => Promise<void>): Promise<boolean> {
  if (!downloadedVersion) return false
  await prepareQuit()
  // Show the brief installer on Windows, and always relaunch afterwards.
  autoUpdater.quitAndInstall(false, true)
  return true
}

/** Asks to restart; on yes, installs. */
async function promptAndInstall(getWindow: GetWindow, prepareQuit: () => Promise<void>): Promise<boolean> {
  if (!downloadedVersion) return false
  const win = getWindow()
  const opts: MessageBoxSyncOptions = {
    type: 'question',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: `Restart to update to v${downloadedVersion}?`,
    detail: 'Your song is saved first and reopens after the update.',
  }
  const choice = win ? dialog.showMessageBoxSync(win, opts) : dialog.showMessageBoxSync(opts)
  if (choice !== 0) return false
  return install(prepareQuit)
}

/**
 * The toolbar's install button: installs right away, no questions. Re-checks first so a
 * superseded download is never installed — the toolbar then shows the newer one downloading.
 * A failed re-check (offline) still installs.
 */
export async function installUpdate(prepareQuit: () => Promise<void>): Promise<boolean> {
  const pending = downloadedVersion
  const result = await check()
  if (result.kind === 'available' && result.version !== pending) return false
  return install(prepareQuit)
}

/** The menu's "Check for Updates…": reports the newest release, and offers to install it once downloaded. */
export async function checkForUpdatesInteractive(getWindow: GetWindow, prepareQuit: () => Promise<void>): Promise<void> {
  if (!app.isPackaged) {
    box(getWindow, { type: 'info', message: 'Updates are only available in the installed app.', detail: 'This is a development build.' })
    return
  }
  const pending = downloadedVersion
  const result = await check()
  if (result.kind === 'error') {
    box(getWindow, { type: 'warning', message: 'Update check failed', detail: result.error instanceof Error ? result.error.message : String(result.error) })
  } else if (result.kind === 'none') {
    box(getWindow, { type: 'info', message: "You're up to date", detail: `v${app.getVersion()} is the latest version.` })
  } else if (result.version === pending) {
    await promptAndInstall(getWindow, prepareQuit)
  } else {
    box(getWindow, { type: 'info', message: `Update v${result.version} available`, detail: 'Downloading now. When it is ready, click Install in the toolbar.' })
  }
}

function box(getWindow: GetWindow, opts: MessageBoxOptions): void {
  const win = getWindow()
  void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))
}
