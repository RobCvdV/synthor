import type { SampleEntity } from '../domain/types'
import type { DecodedSize } from '../engine/compile'
import type { AudioHost } from './host'
import { readSampleAsset } from '../persist/sampleStorage'
import { decodeSamplesToVfs } from './vfsDecode'

/**
 * Load sample PCM data from storage into Elementary's VFS so they're playable.
 * Call on song load and whenever the sample list changes.
 *
 * Returns the hashes that were successfully loaded into VFS, plus each
 * sample's L1 sum (Σ|channel 0|) — the compiler uses it to normalize
 * convolution IRs so a conv effect can never amplify beyond the dry peak.
 * Sample entities whose stored files are missing or unparseable are NOT
 * in this set — the caller should prune them from the doc.
 */
export function syncSamplesToVfs(
  host: AudioHost,
  samples: SampleEntity[],
  slug: string,
): Promise<{ loaded: Set<string>; l1Sums: Record<string, number>; decodedSizes: Record<string, DecodedSize> }> {
  return decodeSamplesToVfs(host, samples, (hash) => readSampleAsset(slug, hash))
}
