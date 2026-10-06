/**
 * Auto-update from GitHub Releases (the `latest*.yml` feeds the release workflow uploads).
 * Checks on launch, every few hours and on focus; downloads in the background, but only
 * installs when the user agrees — through the toolbar's update button or the menu.
 */
import { app, dialog, type BrowserWindow, type MessageBoxOptions, type MessageBoxSyncOptions } from 'electron'
import electronUpdater from 'electron-updater'

// CommonJS default export: the named import breaks under ESM interop.
const { autoUpdater } = electronUpdater

const HOUR_MS = 60 * 60 * 1000
const CHECK_INTERVAL_MS = 6 * HOUR_MS
const FOCUS_CHECK_MIN_GAP_MS = HOUR_MS

type GetWindow = () => BrowserWindow | null
type CheckResult = { kind: 'available'; version: string } | { kind: 'none' } | { kind: 'error'; error: unknown }

/** The downloaded update waiting for the user's OK, or null. */
let downloadedVersion: string | null = null
let lastCheckAt = 0
let notifyRenderer: (version: string | null) => void = () => {}

/** Starts background checks. A no-op in development: updating needs the packaged, signed app. */
export function setupUpdater(getWindow: GetWindow): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  notifyRenderer = (version) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('update:downloaded', version)
  }
  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info.version
    notifyRenderer(info.version)
  })
  // Best-effort: a failed check (offline, rate limit) must never interrupt the app.
  autoUpdater.on('error', (err) => console.error('[updater]', err instanceof Error ? err.message : err))

  void check()
  setInterval(() => void check(), CHECK_INTERVAL_MS)
  app.on('browser-window-focus', () => {
    if (!downloadedVersion && Date.now() - lastCheckAt >= FOCUS_CHECK_MIN_GAP_MS) void check()
  })
}

/** The current downloaded update, so a reloaded renderer can show its button again. */
export function pendingUpdate(): string | null {
  return downloadedVersion
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
  if (!downloadedVersion) return
  downloadedVersion = null
  notifyRenderer(null)
}

/** Asks to restart; on yes, runs `prepareQuit` (save the song) and relaunches into the update. */
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
  await prepareQuit()
  // Show the brief installer on Windows, and always relaunch afterwards.
  autoUpdater.quitAndInstall(false, true)
  return true
}

/**
 * The toolbar's update button. Re-checks first so a superseded download is never installed:
 * a newer release starts downloading instead. A failed re-check (offline) still installs.
 */
export async function installUpdate(getWindow: GetWindow, prepareQuit: () => Promise<void>): Promise<boolean> {
  const pending = downloadedVersion
  const result = await check()
  if (result.kind === 'available' && result.version !== pending) {
    box(getWindow, { type: 'info', message: `A newer update v${result.version} is available`, detail: "Downloading now — you'll be asked to restart when it's ready." })
    return false
  }
  if (result.kind === 'none' && !downloadedVersion) {
    box(getWindow, { type: 'info', message: "You're up to date", detail: `v${app.getVersion()} is the latest version.` })
    return false
  }
  return promptAndInstall(getWindow, prepareQuit)
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
    box(getWindow, { type: 'info', message: `Update v${result.version} available`, detail: "Downloading now — you'll be asked to restart when it's ready." })
  }
}

function box(getWindow: GetWindow, opts: MessageBoxOptions): void {
  const win = getWindow()
  void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))
}
