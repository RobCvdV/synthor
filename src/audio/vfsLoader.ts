import type { SampleEntity } from '../domain/types'
import type { AudioHost } from './host'
import { readSampleAsset } from '../persist/sampleStorage'

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

      const ch0 = buffer.getChannelData(0)
      let l1 = 0
      for (let i = 0; i < ch0.length; i++) l1 += Math.abs(ch0[i])
      l1Sums[s.hash] = l1

      // Extract per-channel Float32Array data.
      if (buffer.numberOfChannels === 1) {
        vfs[s.hash] = new Float32Array(ch0)
      } else {
        const chData: Float32Array[] = [new Float32Array(ch0)]
        for (let ch = 1; ch < buffer.numberOfChannels; ch++) {
          chData.push(new Float32Array(buffer.getChannelData(ch)))
        }
        vfs[s.hash] = chData
      }
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
