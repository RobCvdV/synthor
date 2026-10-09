import { useEffect, useState } from 'react'
import { electronApi } from '../persist/electronBridge'
import { onReadActivity } from '../persist/storage'
import { oldestWait, useStorageStatus, type StorageWait } from '../state/storageStatus'
import { Button } from './components/Button'

/** Quick reads never flash the banner. */
const SHOW_AFTER_MS = 1000
const UNAVAILABLE_AFTER_MS = 20_000

export interface StorageWaitMessage {
  text: string
  /** Waited long enough to call the library unavailable. */
  unavailable: boolean
}

/** What the banner says about the oldest pending read, or null while it is still quick. */
export function storageWaitMessage(w: StorageWait, pending: number, now: number): StorageWaitMessage | null {
  const elapsed = now - w.since
  if (elapsed < SHOW_AFTER_MS) return null
  const secs = Math.round(elapsed / 1000)
  const what = pending > 1 ? `${w.path} and ${pending - 1} more` : w.path
  if (elapsed < UNAVAILABLE_AFTER_MS) {
    return {
      unavailable: false,
      text: w.cloud ? `Downloading ${what} from iCloud… ${secs} s` : `Waiting for the library to deliver ${what}… ${secs} s`,
    }
  }
  return {
    unavailable: true,
    text: w.cloud
      ? `The library isn't available: iCloud hasn't delivered ${what} after ${secs} s. Check your internet connection and free disk space. Synthor carries on as soon as it arrives.`
      : `The library isn't available: ${what} hasn't loaded after ${secs} s. Check that the library folder is reachable. Synthor carries on as soon as it arrives.`,
  }
}

/** Feeds storage reads (and the main process's iCloud notices) into the status store. */
function useStorageStatusFeed(): void {
  useEffect(() => {
    const { beginRead, endRead, markCloud } = useStorageStatus.getState()
    const offReads = onReadActivity(({ path, done }) => done ? endRead(path) : beginRead(path, Date.now()))
    const offCloud = electronApi()?.storage.onCloudWait(({ path, waiting }) => { if (waiting) markCloud(path) })
    return () => {
      offReads()
      offCloud?.()
    }
  }, [])
}

/** A banner while the library is slow to deliver files, instead of a silently blank or stuck app. */
export function StorageStatus() {
  useStorageStatusFeed()
  const waits = useStorageStatus((s) => s.waits)
  const [now, setNow] = useState(() => Date.now())
  const oldest = oldestWait(waits)

  useEffect(() => {
    if (!oldest) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [oldest])

  const msg = oldest && storageWaitMessage(oldest, Object.keys(waits).length, now)
  if (!msg) return null
  const api = electronApi()
  return (
    <div className={`storage-status${msg.unavailable ? ' unavailable' : ''}`} role={msg.unavailable ? 'alert' : 'status'}>
      <span>{msg.text}</span>
      {msg.unavailable && api && <Button size="sm" onClick={() => void api.revealLibrary()}>Show Library Folder</Button>}
    </div>
  )
}
