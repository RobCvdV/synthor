import { useEffect, useState } from 'react'
import { electronApi, type UpdateStatus } from '../persist/electronBridge'

/** The Electron app's update in the toolbar: its download progress, then a button that installs it. */
export function UpdateButton() {
  const [status, setStatus] = useState<UpdateStatus>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    const api = electronApi()
    if (!api) return
    let live = true
    void api.updateStatus().then((s) => { if (live) setStatus(s) })
    const unsubscribe = api.onUpdateStatus(setStatus)
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  if (!status) return null
  if (status.state === 'downloading') {
    return (
      <span className="update-btn downloading" title={`Downloading update v${status.version}`}>
        ⬇ v{status.version} {status.percent}%
      </span>
    )
  }
  const install = () => {
    setInstalling(true)
    void electronApi()?.installUpdate().then((ok) => { if (!ok) setInstalling(false) })
  }
  return (
    <button className="update-btn" disabled={installing}
      title={`Install v${status.version}: saves your song and restarts`} onClick={install}>
      {installing ? 'Installing…' : `⬆ Install v${status.version}`}
    </button>
  )
}
