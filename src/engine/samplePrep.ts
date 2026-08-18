/**
 * Sample preparation for VFS upload.
 *
 * Elementary's one-shot sample node (mc.sample) applies a ~4 ms fade-in on
 * every trigger. A drum hit's first milliseconds carry the transient, so the
 * fade would eat the attack — pad one-shot samples with leading silence so
 * the fade lands on silence instead of signal.
 */

/** Peak below this is considered silence. */
const SILENCE_THRESHOLD = 1e-4

function hasLeadingSilence(ch: Float32Array, pad: number): boolean {
  const n = Math.min(ch.length, pad)
  for (let i = 0; i < n; i++) {
    if (Math.abs(ch[i]) > SILENCE_THRESHOLD) return false
  }
  return true
}

/**
 * Prepend `ms` of silence to every channel unless the sample already starts
 * with that much silence. Returns the original arrays when no padding is
 * needed, otherwise new padded copies (all channels padded identically so
 * they stay frame-aligned).
 */
export function ensureLeadingSilence(
  channels: Float32Array[],
  sampleRate: number,
  ms = 5,
): Float32Array[] {
  const pad = Math.ceil((ms / 1000) * sampleRate)
  if (pad <= 0) return channels
  if (channels.every((ch) => hasLeadingSilence(ch, pad))) return channels
  return channels.map((ch) => {
    const out = new Float32Array(ch.length + pad)
    out.set(ch, pad)
    return out
  })
}
