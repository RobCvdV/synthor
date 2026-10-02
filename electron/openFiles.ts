/** Song files opened from the OS (double-click, "Open With", command line), handed to the renderer once it's ready. */
import fs from 'node:fs/promises'
import path from 'node:path'

export const SONG_FILE_EXT = '.synthor'

export interface OpenedFile {
  name: string
  bytes: Uint8Array
}

/** Song file paths among command-line arguments. */
export function songPathsFromArgv(argv: string[]): string[] {
  return argv.filter((arg) => !arg.startsWith('-') && path.extname(arg).toLowerCase() === SONG_FILE_EXT)
}

/** Queues paths until the renderer takes them, then pushes new ones straight through `deliver`. */
export function createOpenFileQueue(deliver: (file: OpenedFile) => void, readFile = fs.readFile) {
  let pending: string[] = []
  let rendererReady = false
  const read = async (p: string): Promise<OpenedFile | null> => {
    try {
      return { name: path.basename(p), bytes: new Uint8Array(await readFile(p)) }
    } catch {
      return null
    }
  }

  return {
    open(p: string) {
      if (!rendererReady) {
        pending.push(p)
        return
      }
      void read(p).then((file) => { if (file) deliver(file) })
    },
    /** Called by the renderer once it can handle files; returns what arrived before that. */
    async take(): Promise<OpenedFile[]> {
      rendererReady = true
      const paths = pending
      pending = []
      return (await Promise.all(paths.map(read))).filter((f): f is OpenedFile => f !== null)
    },
    /** A reloaded renderer must take the queue again. */
    resetRenderer() {
      rendererReady = false
    },
  }
}
