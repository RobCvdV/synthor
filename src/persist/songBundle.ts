/**
 * Reading a `.synthor` container (or plain song JSON) into memory — pure, no
 * storage. The app writes the samples to its library; the headless player
 * decodes them straight into the VFS.
 */

import { unzipSync, strFromU8 } from 'fflate'
import { deserializeSong, type SongFile } from './serialize'

export interface SongBundle {
  file: SongFile
  /** Encoded sample files by content hash (empty for a JSON-only song). */
  samples: Map<string, ArrayBuffer>
}

/** Parse a `.synthor` zip or `.synthor.json` song. Throws on malformed input. */
export function unpackSongBundle(data: ArrayBuffer | Uint8Array): SongBundle {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data)

  // JSON starts with '{', a zip with 'PK'.
  if (view[0] === 0x7B) {
    return { file: deserializeSong(new TextDecoder().decode(view)), samples: new Map() }
  }

  const entries = unzipSync(view)
  const songEntry = entries['song.json']
  if (!songEntry) throw new Error('Not a valid song file: missing song.json in zip')

  const samples = new Map<string, ArrayBuffer>()
  for (const [path, bytes] of Object.entries(entries)) {
    const match = /^samples\/([0-9a-f]+)\.bin$/.exec(path)
    if (!match) continue
    samples.set(match[1], bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  }

  return { file: deserializeSong(strFromU8(songEntry)), samples }
}
