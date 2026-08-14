/**
 * Canonical PCM WAV encoder (16-bit, 1 or 2 channels).
 * Deterministic: identical input PCM + sampleRate always produce byte-identical
 * output — sample files are content-addressed, so hash stability depends on it.
 */

/** Encode mono (`[ch0]`) or stereo (`[L, R]`) float PCM to a 16-bit WAV. */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const chCount = channels.length
  const frames = channels[0]?.length ?? 0
  if (chCount === 0 || frames === 0) throw new Error('Cannot encode empty PCM')
  if (channels.some((ch) => ch.length !== frames)) {
    throw new Error('All channels must have equal length')
  }

  const dataSize = frames * chCount * 2
  const buf = new ArrayBuffer(44 + dataSize)
  const dv = new DataView(buf)

  const writeAscii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i))
  }

  writeAscii(0, 'RIFF')
  dv.setUint32(4, 36 + dataSize, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  dv.setUint32(16, 16, true) // fmt chunk size
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, chCount, true)
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * chCount * 2, true) // byte rate
  dv.setUint16(32, chCount * 2, true) // block align
  dv.setUint16(34, 16, true) // bits per sample
  writeAscii(36, 'data')
  dv.setUint32(40, dataSize, true)

  let off = 44
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
