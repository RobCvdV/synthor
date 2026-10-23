import type { SampleEntity } from '../domain/types'
import type { DecodedSize } from '../engine/compile'
import type { AudioHost } from './host'

/** Shared AudioContext reused for all VFS decoding — avoids hitting browser limits. */
let _sharedCtx: AudioContext | null = null
function sharedCtx(): AudioContext {
  if (!_sharedCtx || _sharedCtx.state === 'closed') {
    _sharedCtx = new AudioContext()
  }
  return _sharedCtx
}

/**
 * Decode sample files into Elementary's VFS so they're playable. `read`
 * supplies each sample's encoded bytes by content hash — from storage in the
 * app, from a song bundle in the headless player.
 *
 * Returns the hashes that were successfully loaded into VFS, plus each
 * sample's L1 sum (Σ|channel 0|) — the compiler uses it to normalize
 * convolution IRs so a conv effect can never amplify beyond the dry peak —
 * and each sample's decoded length, which can differ from the entity's.
 * Sample entities whose stored files are missing or unparseable are NOT
 * in this set — the caller should prune them from the doc.
 */
export async function decodeSamplesToVfs(
  host: AudioHost,
  samples: SampleEntity[],
  read: (hash: string) => Promise<ArrayBuffer | null | undefined>,
): Promise<{ loaded: Set<string>; l1Sums: Record<string, number>; decodedSizes: Record<string, DecodedSize> }> {
  const vfs: Record<string, Float32Array | Float32Array[]> = {}
  const loaded = new Set<string>()
  const l1Sums: Record<string, number> = {}
  const decodedSizes: Record<string, DecodedSize> = {}

  // Read in parallel: a library on iCloud may have to download each file first.
  const raws = await Promise.all(samples.map((s) => read(s.hash)))
  for (const [i, s] of samples.entries()) {
    const raw = raws[i]
    if (!raw) {
      console.warn(`Sample "${s.name}" (hash ${s.hash.slice(0, 8)}…) not found in storage — skipping VFS load`)
      continue
    }

    try {
      const ctx = sharedCtx()
      const buffer = await ctx.decodeAudioData(raw.slice(0))

      const ch0 = buffer.getChannelData(0)
      let l1 = 0
      for (let i = 0; i < ch0.length; i++) l1 += Math.abs(ch0[i])
      l1Sums[s.hash] = l1
      decodedSizes[s.hash] = { frames: buffer.length, sampleRate: buffer.sampleRate }

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

  return { loaded, l1Sums, decodedSizes }
}
