import type { SampleEntity } from '../domain/types'
import type { AudioHost } from './host'
import { readSampleAsset } from '../persist/sampleStorage'
import { ensureLeadingSilence } from '../engine/samplePrep'

/** Shared AudioContext reused for all VFS decoding — avoids hitting browser limits. */
let _sharedCtx: AudioContext | null = null
function sharedCtx(): AudioContext {
  if (!_sharedCtx || _sharedCtx.state === 'closed') {
    _sharedCtx = new AudioContext()
  }
  return _sharedCtx
}

/**
 * Load sample PCM data from OPFS into Elementary's VFS so they're playable.
 * Call on song load and whenever the sample list changes.
 *
 * Returns the hashes that were successfully loaded into VFS, plus each
 * sample's L1 sum (Σ|channel 0|) — the compiler uses it to normalize
 * convolution IRs so a conv effect can never amplify beyond the dry peak.
 * Sample entities whose OPFS files are missing or unparseable are NOT
 * in this set — the caller should prune them from the doc.
 */
export async function syncSamplesToVfs(
  host: AudioHost,
  samples: SampleEntity[],
  slug: string,
  /** Hashes played one-shot (drumkit slots) — padded so Elementary's
   *  per-trigger fade-in lands on silence, not the sample's attack. */
  padHashes: ReadonlySet<string> = new Set(),
): Promise<{ loaded: Set<string>; l1Sums: Record<string, number> }> {
  const vfs: Record<string, Float32Array | Float32Array[]> = {}
  const loaded = new Set<string>()
  const l1Sums: Record<string, number> = {}

  for (const s of samples) {
    const raw = await readSampleAsset(slug, s.hash)
    if (!raw) {
      console.warn(`Sample "${s.name}" (hash ${s.hash.slice(0, 8)}…) not found in OPFS — skipping VFS load`)
      continue
    }

    try {
      const ctx = sharedCtx()
      const buffer = await ctx.decodeAudioData(raw.slice(0))

      // Extract per-channel Float32Array data.
      const channels: Float32Array[] = []
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        channels.push(new Float32Array(buffer.getChannelData(ch)))
      }
      const chs = padHashes.has(s.hash) ? ensureLeadingSilence(channels, buffer.sampleRate) : channels

      const ch0 = chs[0]
      let l1 = 0
      for (let i = 0; i < ch0.length; i++) l1 += Math.abs(ch0[i])
      l1Sums[s.hash] = l1

      vfs[s.hash] = chs.length === 1 ? chs[0] : chs
      loaded.add(s.hash)
    } catch (err) {
      console.error('Failed to decode sample for VFS:', s.name, err)
    }
  }

  if (Object.keys(vfs).length > 0) {
    await host.updateVfs(vfs)
  }

  return { loaded, l1Sums }
}
