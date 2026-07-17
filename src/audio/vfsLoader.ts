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
 * Returns the set of hashes that were successfully loaded into VFS.
 * Sample entities whose OPFS files are missing or unparseable are NOT
 * in this set — the caller should prune them from the doc.
 */
export async function syncSamplesToVfs(
  host: AudioHost,
  samples: SampleEntity[],
  slug: string,
): Promise<Set<string>> {
  const vfs: Record<string, Float32Array | Float32Array[]> = {}
  const loaded = new Set<string>()

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
      if (buffer.numberOfChannels === 1) {
        vfs[s.hash] = new Float32Array(buffer.getChannelData(0))
      } else {
        const chData: Float32Array[] = []
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
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

  return loaded
}
