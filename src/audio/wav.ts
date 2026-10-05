/**
 * Canonical PCM WAV encoder (16-bit, 1 or 2 channels).
 * Deterministic: identical input PCM + sampleRate always produce byte-identical
 * output — sample files are content-addressed, so hash stability depends on it.
 */

/**
 * Encode mono (`[ch0]`) or stereo (`[L, R]`) float PCM to a 16-bit WAV. With `cycleLength`, a
 * `clm ` chunk records the frames per cycle, the marker wavetable synths (Serum and others) read.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number, cycleLength?: number): ArrayBuffer {
  const chCount = channels.length
  const frames = channels[0]?.length ?? 0
  if (chCount === 0 || frames === 0) throw new Error('Cannot encode empty PCM')
  if (channels.some((ch) => ch.length !== frames)) {
    throw new Error('All channels must have equal length')
  }

  const clm = cycleLength ? `<!>${Math.round(cycleLength)} 00000000 wavetable (synthor)` : ''
  const clmChunk = clm ? 8 + clm.length + (clm.length % 2) : 0
  const dataSize = frames * chCount * 2
  const buf = new ArrayBuffer(44 + clmChunk + dataSize)
  const dv = new DataView(buf)

  const writeAscii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i))
  }

  writeAscii(0, 'RIFF')
  dv.setUint32(4, 36 + clmChunk + dataSize, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  dv.setUint32(16, 16, true) // fmt chunk size
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, chCount, true)
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * chCount * 2, true) // byte rate
  dv.setUint16(32, chCount * 2, true) // block align
  dv.setUint16(34, 16, true) // bits per sample
  if (clm) {
    writeAscii(36, 'clm ')
    dv.setUint32(40, clm.length, true)
    writeAscii(44, clm)
  }
  writeAscii(36 + clmChunk, 'data')
  dv.setUint32(40 + clmChunk, dataSize, true)

  let off = 44 + clmChunk
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < chCount; c++) {
      // Round (not truncate) so reverse/re-encode round-trips stay bit-identical.
      const v = Math.max(-32768, Math.min(32767, Math.round(channels[c][f] * 32767)))
      dv.setInt16(off, v, true)
      off += 2
    }
  }
  return buf
}

/**
 * Frames per cycle a WAV file declares for wavetable use: its `clm ` chunk, else a whole number
 * of 2048-frame cycles (the common wavetable layout). In the file's own frames and rate; null
 * for anything else (not a WAV, a single cycle, or no such layout).
 */
export function readWavCycleLength(bytes: ArrayBuffer): { cycleLength: number; sampleRate: number } | null {
  const dv = new DataView(bytes)
  const ascii = (off: number, n: number) => String.fromCharCode(...new Uint8Array(bytes, off, Math.min(n, bytes.byteLength - off)))
  if (bytes.byteLength < 12 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return null
  let sampleRate = 0
  let blockAlign = 0
  let frames = 0
  let clm: number | null = null
  for (let off = 12; off + 8 <= bytes.byteLength;) {
    const id = ascii(off, 4)
    const size = dv.getUint32(off + 4, true)
    if (id === 'fmt ' && size >= 16) {
      sampleRate = dv.getUint32(off + 12, true)
      blockAlign = dv.getUint16(off + 20, true)
    } else if (id === 'clm ') {
      const n = /<!>(\d+)/.exec(ascii(off + 8, size))
      if (n) clm = Number(n[1])
    } else if (id === 'data' && blockAlign) {
      frames = Math.floor(Math.min(size, bytes.byteLength - off - 8) / blockAlign)
    }
    off += 8 + size + (size % 2)
  }
  if (!sampleRate) return null
  if (clm && clm > 0) return { cycleLength: clm, sampleRate }
  return frames > 2048 && frames % 2048 === 0 && frames / 2048 <= 256 ? { cycleLength: 2048, sampleRate } : null
}
