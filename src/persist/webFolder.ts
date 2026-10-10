/**
 * Web only (Chromium): keep the library in a real folder the user picked instead
 * of browser storage. The folder handle survives reloads in IndexedDB; the
 * browser may need a click to grant access again in a new session.
 */
import { electronApi } from './electronBridge'
import { LIBRARY_ROOTS } from './libraryBackup'
import { createDirectoryBackend, createOpfsBackend, isOpfsSupported } from './opfsBackend'
import { copyTree, setStorage, storage, trackReads, type StorageBackend } from './storage'

/** The parts of a FileSystemDirectoryHandle this module needs beyond the DOM typings. */
export interface FolderHandle extends FileSystemDirectoryHandle {
  queryPermission(opts: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(opts: { mode: 'readwrite' }): Promise<PermissionState>
}

export interface HandleStore {
  get(): Promise<FolderHandle | null>
  set(handle: FolderHandle): Promise<void>
  clear(): Promise<void>
}

const COPIED = [...LIBRARY_ROOTS, 'recent']

let connected: string | null = null

/** Name of the folder the library lives in this session, or null for browser storage. */
export function connectedFolderName(): string | null {
  return connected
}

export function isFolderAccessSupported(): boolean {
  return !electronApi() && isOpfsSupported() && typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/** Copies songs, instruments, samples and the recent marker; `overwrite` makes `from` win. */
export async function copyLibrary(from: StorageBackend, to: StorageBackend, overwrite = false): Promise<void> {
  for (const path of COPIED) {
    if ((await from.list(path)).length > 0) {
      await copyTree(from, path, to, path, overwrite)
    } else if (overwrite || !await to.exists(path)) {
      const data = await from.readBytes(path)
      if (data) await to.write(path, data)
    }
  }
}

function useFolder(handle: FolderHandle, backendFor: (h: FolderHandle) => StorageBackend) {
  setStorage(trackReads(backendFor(handle)))
  connected = handle.name
}

const folderBackend = (h: FolderHandle) => createDirectoryBackend(async () => h)

/**
 * At startup: switch storage to the saved folder when access is still granted; when the browser
 * needs a click, `askReconnect` gets the folder name (a yes counts as that click). Otherwise browser storage stays.
 */
export async function openSavedFolder(
  askReconnect: (folderName: string) => Promise<boolean>,
  store: HandleStore = idbHandleStore,
  backendFor: (h: FolderHandle) => StorageBackend = folderBackend,
): Promise<void> {
  if (!isFolderAccessSupported()) return
  const handle = await store.get().catch(() => null)
  if (!handle) return
  let state = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied' as const)
  if (state === 'prompt' && await askReconnect(handle.name)) {
    state = await handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied' as const)
  }
  if (state === 'granted') useFolder(handle, backendFor)
}

/** Lets the user pick a folder, copies the library into it (its own files win) and remembers it. Reload afterwards. */
export async function connectFolder(store: HandleStore = idbHandleStore): Promise<string | null> {
  let handle: FolderHandle
  try {
    handle = await (window as unknown as { showDirectoryPicker(o: object): Promise<FolderHandle> })
      .showDirectoryPicker({ id: 'synthor-library', mode: 'readwrite' })
  } catch {
    return null // cancelled
  }
  if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') return null
  const current = storage()
  if (current) await copyLibrary(current, folderBackend(handle))
  await store.set(handle)
  return handle.name
}

/** Goes back to browser storage, taking the folder's library along (it wins). Reload afterwards. */
export async function disconnectFolder(store: HandleStore = idbHandleStore): Promise<void> {
  const current = storage()
  if (connected && current) await copyLibrary(current, createOpfsBackend(), true)
  await store.clear()
}

// --- IndexedDB persistence of the handle ---

const DB = 'synthor'
const STORE = 'handles'
const KEY = 'library'

function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const req = run(open.result.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => { resolve(req.result); open.result.close() }
      req.onerror = () => { reject(req.error); open.result.close() }
    }
  })
}

export const idbHandleStore: HandleStore = {
  get: () => withStore<FolderHandle | undefined>('readonly', (s) => s.get(KEY)).then((h) => h ?? null),
  set: (handle) => withStore('readwrite', (s) => s.put(handle, KEY)).then(() => {}),
  clear: () => withStore('readwrite', (s) => s.delete(KEY)).then(() => {}),
}
