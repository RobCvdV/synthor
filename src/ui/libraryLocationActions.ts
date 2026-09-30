import { exportLibraryZip, restoreLibraryZip } from '../persist/libraryBackup'
import { requireStorage } from '../persist/storage'
import { connectFolder, disconnectFolder } from '../persist/webFolder'
import { askConfirm } from '../state/dialogStore'
import { downloadBlob } from './download'
import { pickFiles } from './pickFiles'
import { saveNow } from './songActions'

const reload = () => location.reload()

/** Web: moves the library into a folder the user picks, then restarts on it. */
export async function moveLibraryToFolder(): Promise<void> {
  await saveNow()
  if (await connectFolder()) reload()
}

/** Web: back to browser storage, bringing the folder's library along. */
export async function stopUsingFolder(): Promise<void> {
  if (!await askConfirm({
    message: 'Keep the library in this browser instead? Its songs, instruments and samples are copied back; the folder stays as it is.',
    confirmLabel: 'Use browser storage',
  })) return
  await saveNow()
  await disconnectFolder()
  reload()
}

/** Downloads every song, instrument and sample as one zip. */
export async function backupLibrary(now = new Date()): Promise<void> {
  try {
    await saveNow()
    const zip = await exportLibraryZip(requireStorage(), now)
    downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `Synthor library ${now.toISOString().slice(0, 10)}.zip`)
  } catch (err) {
    alert(`Backup failed: ${(err as Error).message}`)
  }
}

/** Adds a backup's songs, instruments and samples; anything already here is kept. Returns whether anything changed. */
export async function restoreLibrary(): Promise<boolean> {
  const [file] = await pickFiles({ accept: '.zip,application/zip' })
  if (!file) return false
  try {
    const { added, kept } = await restoreLibraryZip(requireStorage(), new Uint8Array(await file.arrayBuffer()))
    alert(`Restored ${added} file${added === 1 ? '' : 's'}${kept ? `; ${kept} already here were kept` : ''}.`)
    return added > 0
  } catch (err) {
    alert(`Restore failed: ${(err as Error).message}`)
    return false
  }
}
