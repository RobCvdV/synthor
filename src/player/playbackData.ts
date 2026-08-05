/**
 * Pure functions to convert a Doc + arrangement into the per-track data
 * structures consumed by the scheduler AudioWorklet.  No audio imports,
 * no DOM, no React — unit-testable with vitest.
 */

import type { Doc, Id } from '../domain/types'
import { buildSequences, buildDrumKitSlotSequences } from '../engine/sequences'
import type { ArrangementItem } from '../engine/arrangement'

/** Per-track row data sent to the scheduler worklet. */
export interface TrackPlaybackData {
  trackId: Id
  instId: Id
  /** Gate sequence (0 or 1 per row). */
  gate: number[]
  /** Frequency sequence in Hz. */
  freq: number[]
  /** Volume modifier per row (0..1). */
  vol: number[]
  /** For drumkit tracks: per-slot gate sequences, keyed by slot id. */
  slotGates?: Record<Id, number[]>
  /** Channel offset assigned to this track (set by compileGraph). */
  channelOffset: number
}

/** Complete playback data for the scheduler. */
export interface PlaybackData {
  tracks: TrackPlaybackData[]
  totalRows: number
  /** Arrangement items for section/song mode (pattern windows). */
  arrangement: ArrangementItem[]
}

/** Build the playback data for the given doc and arrangement. */
export function buildPlaybackData(
  doc: Doc,
  arrangement: readonly ArrangementItem[],
): PlaybackData {
  const trackMap = new Map<Id, TrackPlaybackData>()
  const totalRows = arrangement.reduce(
    (sum, a) => sum + (doc.entities.patterns[a.patternId]?.length ?? 0),
    0,
  )

  for (const item of arrangement) {
    const pattern = doc.entities.patterns[item.patternId]
    if (!pattern) continue

    for (const trackId of pattern.trackIds) {
      const track = doc.entities.tracks[trackId]
      if (!track) continue
      const inst = doc.entities.instruments[track.instrumentId]
      if (!inst) continue

      // Build sequences for this track using existing pure functions.
      const { freqSeq, gateSeq, volumeSeq } = buildSequences(track, pattern.length)

      let existing = trackMap.get(trackId)
      if (!existing) {
        existing = {
          trackId,
          instId: track.instrumentId,
          gate: [],
          freq: [],
          vol: [],
          channelOffset: 0, // assigned by compileGraph
        }
        trackMap.set(trackId, existing)
      }

      if (totalRows > pattern.length) {
        // Multi-pattern arrangement — pad into the full timeline.
        const oldLen = existing.gate.length
        // Extend arrays to totalRows (they were already partially filled).
        existing.gate.length = totalRows
        existing.freq.length = totalRows
        existing.vol.length = totalRows
        // Fill the gap between old end and current item's window.
        for (let i = oldLen; i < item.startRow; i++) {
          existing.gate[i] = 0
          existing.freq[i] = existing.freq[oldLen - 1] ?? 0
          existing.vol[i] = 1
        }
        // Copy this pattern's data into its window.
        for (let i = 0; i < pattern.length; i++) {
          existing.gate[item.startRow + i] = gateSeq[i]
          existing.freq[item.startRow + i] = freqSeq[i]
          existing.vol[item.startRow + i] = volumeSeq[i]
        }
      } else {
        // Single pattern — just use the sequences directly.
        existing.gate = gateSeq
        existing.freq = freqSeq
        existing.vol = volumeSeq
      }

      // Drumkit: build per-slot gate sequences.
      if (inst.kind === 'drumkit') {
        const { slotGateSeqs } = buildDrumKitSlotSequences(
          track,
          pattern.length,
          inst,
        )
        if (!existing.slotGates) existing.slotGates = {}
        if (totalRows > pattern.length) {
          // Pad each slot's gates into the full timeline.
          for (const [slotId, seq] of Object.entries(slotGateSeqs)) {
            const padded = existing.slotGates[slotId] ?? new Array(totalRows).fill(0)
            for (let i = 0; i < pattern.length; i++) {
              padded[item.startRow + i] = seq[i]
            }
            existing.slotGates[slotId] = padded
          }
        } else {
          Object.assign(existing.slotGates, slotGateSeqs)
        }
      }
    }
  }

  return {
    tracks: [...trackMap.values()],
    totalRows,
    arrangement: [...arrangement],
  }
}
