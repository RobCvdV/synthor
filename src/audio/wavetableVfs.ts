import { buildWavetableMips, type WavetableMipRequest } from '../engine/wavetableMips'

/** The slice of `AudioHost` this needs (a fake in tests). */
export interface WavetableVfsHost {
  listVfs(): Promise<Set<string>>
  updateVfs(vfs: Record<string, Float32Array>): Promise<void>
}

export interface WavetableVfs {
  /** Table keys in the VFS for the wanted requests — pass to the compile. */
  keys(): ReadonlySet<string>
  /** Bumps whenever `keys()` changes or a table already reported had to be
   *  built again — a graph compiled before then may be playing silence. */
  revision(): number
  /** The decoded audio to build tables from (see `decodeSamplesToVfs`). */
  setPcm(pcm: ReadonlyMap<string, Float32Array[]>): void
  /** The tables the doc's wave modules can use; builds what's missing in the background. */
  want(requests: WavetableMipRequest[]): void
  /** The VFS may have lost tables (a prune): check it again. */
  invalidate(): void
  /** Wants `requests` and resolves once their tables are in (or can't be built). */
  ensure(requests: WavetableMipRequest[]): Promise<void>
}

/**
 * Keeps the band-limited wave tables the doc needs in the VFS. It reconciles
 * against what the VFS actually holds, so tables a prune dropped are built
 * again. `onChange` fires when `keys()` changes — recompile then.
 */
export function createWavetableVfs(host: WavetableVfsHost, onChange: () => void): WavetableVfs {
  let pcm: ReadonlyMap<string, Float32Array[]> = new Map()
  let wanted: WavetableMipRequest[] = []
  let wantedSig = ''
  let keys: ReadonlySet<string> = new Set()
  let rev = 0
  let running: Promise<void> | null = null
  let again = false

  const reconcile = async (): Promise<void> => {
    const present = await host.listVfs()
    let rebuiltInUse = false
    for (const r of wanted) {
      if (r.keys.every((k) => present.has(k))) continue
      const channels = pcm.get(r.hash)
      if (!channels || channels.length < r.keys.length) continue
      const upload: Record<string, Float32Array> = {}
      r.keys.forEach((k, ch) => { upload[k] = buildWavetableMips(channels[ch], r.size) })
      await host.updateVfs(upload)
      if (r.keys.some((k) => keys.has(k))) rebuiltInUse = true
      r.keys.forEach((k) => present.add(k))
      // Long tables take a while: let the UI breathe between them.
      await new Promise((res) => setTimeout(res, 0))
    }
    const next = new Set(wanted.flatMap((r) => r.keys).filter((k) => present.has(k)))
    if (rebuiltInUse || next.size !== keys.size || [...next].some((k) => !keys.has(k))) {
      keys = next
      rev++
      onChange()
    }
  }

  const kick = (): Promise<void> => {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        try {
          await reconcile()
        } catch (err) {
          console.error('[wavetableVfs] building tables failed:', err)
        }
      } while (again)
      running = null
    })()
    return running
  }

  const setWanted = (requests: WavetableMipRequest[]): boolean => {
    const sig = requests.map((r) => r.keys.join('+')).sort().join(',')
    if (sig === wantedSig) return false
    wanted = requests
    wantedSig = sig
    return true
  }

  return {
    keys: () => keys,
    revision: () => rev,
    setPcm(next) {
      pcm = next
      void kick()
    },
    want(requests) {
      if (setWanted(requests)) void kick()
    },
    invalidate() {
      void kick()
    },
    ensure(requests) {
      setWanted(requests)
      return kick()
    },
  }
}
