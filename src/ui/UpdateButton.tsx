import { useEffect, useState } from 'react'
import { electronApi } from '../persist/electronBridge'

/** Shows a downloaded app update in the Electron app; clicking asks to restart into it. */
export function UpdateButton() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    const api = electronApi()
    if (!api) return
    let live = true
    void api.pendingUpdate().then((v) => { if (live) setVersion(v) })
    const unsubscribe = api.onUpdateDownloaded(setVersion)
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  if (!version) return null
  return (
    <button className="update-btn" title="A new version is downloaded — restart to install it"
      onClick={() => void electronApi()?.installUpdate()}>
      ⬆ Update v{version}
    </button>
  )
}
