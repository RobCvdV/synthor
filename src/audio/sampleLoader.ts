/**
 * Decode uploaded audio files into raw Float32Array data for Elementary's VFS.
 * Uses the Web Audio API (AudioContext.decodeAudioData) to decode any format the
 * browser supports (WAV, MP3, OGG, FLAC, etc.).
 */

let _decodeCtx: AudioContext | null = null

/** Shared offline AudioContext for decoding — created once, reused. */
function decodeCtx(): AudioContext {
  if (!_decodeCtx) _decodeCtx = new AudioContext()
  return _decodeCtx
}

export interface LoadedSample {
  /** Content-addressed SHA-256 hash for dedup and OPFS filename. */
  hash: string
  /** Raw PCM data for VFS. Mono → single Float32Array, stereo → [L, R]. */
  sampleData: Float32Array | Float32Array[]
  /** Original sample rate in Hz. */
  sampleRate: number
  /** 1 = mono, 2 = stereo. */
  channels: number
  /** Total frames per channel. */
  frames: number
}

/** Compute SHA-256 hex digest of an ArrayBuffer, used as the content hash. */
export async function computeHash(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Extract per-channel Float32Array data from an AudioBuffer. */
export function extractChannelData(
  buffer: AudioBuffer,
): { sampleData: Float32Array | Float32Array[]; channels: number; frames: number } {
  const channels = buffer.numberOfChannels
  const frames = buffer.length
  if (channels === 1) {
    return { sampleData: new Float32Array(buffer.getChannelData(0)), channels: 1, frames }
  }
  // Stereo (or more): collect per-channel arrays for VFS.
  const chData: Float32Array[] = []
  for (let ch = 0; ch < channels; ch++) {
    chData.push(new Float32Array(buffer.getChannelData(ch)))
  }
  return { sampleData: chData, channels, frames }
}

/**
 * Load an audio file: decode, hash, extract PCM data.
 * The original file's raw bytes are hashed (before decode) so the hash is
 * stable across browsers and independent of AudioContext sample rate.
 */
export async function loadAudioFile(file: File): Promise<LoadedSample> {
  const rawBytes = await file.arrayBuffer()
  const hash = await computeHash(rawBytes)
  const decoded = await decodeCtx().decodeAudioData(rawBytes.slice(0))
  const { sampleData, channels, frames } = extractChannelData(decoded)
  return { hash, sampleData, sampleRate: decoded.sampleRate, channels, frames }
}
