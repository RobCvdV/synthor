/**
 * Pure functions to compute voice-slot layouts for tracker playback.
 *
 * Each instrument gets a fixed number of voice slots — enough for the maximum
 * number of tracks using that instrument in any single pattern.  Slots have
 * predetermined `el.in` channel positions so the graph is compiled once and the
 * scheduler routes track data to the right slot at the right time.  No recompile
 * for notes, effects, pattern switches, or play-mode changes.
 */

import type { Doc, Id } from '../domain/types'
import { isBuiltinLaneType } from '../domain/effects'

/** Fixed layout per slot for a regular (osc/modular) instrument.
 *  Channels: gate, freq, vol, portamento, volumeSlide, panning,
 *  vibratoRate, vibratoDepth, tremoloRate, tremoloDepth, staccato = 11 base. */
const REGULAR_BASE_CHANNELS = 11

/** Drumkit: N drum-gate channels replace the single gate, freq is computed
 *  from the slot's base note.  channelsPerSlot = drumSounds + 10, where
 *  10 = (vol + 9 other effects) = 11 base - 1 (single gate already counted). */
/** Extra channels beyond the drum-gate block: vol + 9 other effect channels
 *  (portamento, volumeSlide, panning, vibratoRate, vibratoDepth, tremoloRate,
 *   tremoloDepth, staccato). */
export const DRUMKIT_EXTRA_CHANNELS = 10

/** Fixed channel indices within a regular slot. */
export const REGULAR_CH = {
  gate: 0,
  freq: 1,
  vol: 2,
  portamento: 3,
  volumeSlide: 4,
  panning: 5,
  vibratoRate: 6,
  vibratoDepth: 7,
  tremoloRate: 8,
  tremoloDepth: 9,
  staccato: 10,
} as const

/** Fixed channel indices for effect lanes within a drumkit slot (relative to
 *  the end of the drum-gate block).  Drum-gate channels are 0..N-1. */
export const DRUMKIT_CH = {
  vol: 0,
  portamento: 1,
  volumeSlide: 2,
  panning: 3,
  vibratoRate: 4,
  vibratoDepth: 5,
  tremoloRate: 6,
  tremoloDepth: 7,
  staccato: 8,
} as const

/** Per-instrument slot layout returned by computeSlotLayouts. */
export interface InstrumentSlotLayout {
  instId: Id
  slotCount: number
  /** Channels consumed by one slot of this instrument. */
  channelsPerSlot: number
  /** First channel of the first slot (global offset). */
  baseChannel: number
  /** Named inlet names in channel order (alphabetical for determinism). */
  namedInletIds: Id[]
  isDrumkit: boolean
  /** Number of drum sounds (only meaningful for drumkits). */
  drumSounds?: number
}

/** Raw analysis result for one instrument. */
interface InstUsage {
  maxConcurrent: number
  namedInlets: Set<string>
}

/** Scan all patterns to find the maximum number of tracks using each instrument
 *  in any single pattern, and the union of all named inlets across those tracks. */
function analyzeInstrumentUsage(doc: Doc): Map<Id, InstUsage> {
  const map = new Map<Id, InstUsage>()

  for (const pattern of Object.values(doc.entities.patterns)) {
    // Count tracks per instrument within this pattern.
    const perInst = new Map<Id, number>()
    for (const tid of pattern.trackIds) {
      const track = doc.entities.tracks[tid]
      if (!track) continue
      perInst.set(track.instrumentId, (perInst.get(track.instrumentId) ?? 0) + 1)

      // Collect named inlets from this track's effect lanes.
      let usage = map.get(track.instrumentId)
      if (!usage) {
        usage = { maxConcurrent: 0, namedInlets: new Set() }
        map.set(track.instrumentId, usage)
      }
      for (const lane of track.effectLanes) {
        if (!isBuiltinLaneType(lane.type)) {
          usage.namedInlets.add(lane.type) // lane type IS the inlet name
        }
      }
    }

    // Update max concurrent for each instrument in this pattern.
    for (const [instId, count] of perInst) {
      const usage = map.get(instId)
      if (usage && count > usage.maxConcurrent) {
        usage.maxConcurrent = count
      }
    }
  }

  return map
}

/**
 * Compute channel layouts for all voice slots across all instruments.
 * Channels are assigned sequentially; layouts are returned in deterministic
 * order (by instrument id, then slot index).
 */
export function computeSlotLayouts(doc: Doc): InstrumentSlotLayout[] {
  const usage = analyzeInstrumentUsage(doc)
  const layouts: InstrumentSlotLayout[] = []
  let nextChannel = 0

  // Stable sort by instrument id for deterministic channel assignment.
  const sortedInstIds = [...usage.keys()].sort()

  for (const instId of sortedInstIds) {
    const u = usage.get(instId)
    if (!u || u.maxConcurrent === 0) continue

    const inst = doc.entities.instruments[instId]
    if (!inst) continue

    const isDrumkit = inst.kind === 'drumkit'
    const drumSounds = isDrumkit ? inst.slots.length : undefined
    const namedInletIds = [...u.namedInlets].sort()
    const channelsPerSlot = isDrumkit
      ? (drumSounds ?? 0) + DRUMKIT_EXTRA_CHANNELS + namedInletIds.length
      : REGULAR_BASE_CHANNELS + namedInletIds.length
    const totalCh = u.maxConcurrent * channelsPerSlot

    // Align to the next 32-channel scheduler-node boundary when the
    // instrument's slot block would straddle the boundary.  Without
    // this, trailing channels (vol, staccato, etc.) of straddling
    // slots are silently dropped by the batching logic.
    const SLOT_BOUNDARY = 32
    if (totalCh <= SLOT_BOUNDARY && (nextChannel % SLOT_BOUNDARY) + totalCh > SLOT_BOUNDARY) {
      nextChannel = Math.ceil(nextChannel / SLOT_BOUNDARY) * SLOT_BOUNDARY
    }
    // Large instruments that exceed a full node are unsupported for now.
    const baseChannel = nextChannel

    layouts.push({
      instId,
      slotCount: u.maxConcurrent,
      channelsPerSlot,
      baseChannel,
      namedInletIds,
      isDrumkit,
      drumSounds,
    })

    nextChannel += totalCh
  }

  // Diagnostic logging.
  if (layouts.length > 0) {
    console.log(
      '[slotLayout]',
      layouts.map((l) => {
        const name = doc.entities.instruments[l.instId]?.name ?? l.instId.slice(0, 8)
        return `${name}: ${l.slotCount} slots × ${l.channelsPerSlot}ch = ch ${l.baseChannel}-${l.baseChannel + l.slotCount * l.channelsPerSlot - 1}`
      }).join('\n  '),
      `\n  Total channels: ${nextChannel}`,
    )
  } else {
    console.log('[slotLayout] no instruments — empty doc')
  }

  return layouts
}

/** Total channels needed across all slots.  Use to determine scheduler node count. */
export function totalChannels(layouts: InstrumentSlotLayout[]): number {
  return layouts.reduce(
    (sum, l) => sum + l.slotCount * l.channelsPerSlot,
    0,
  )
}

/** Look up the global channel offset for a specific instrument slot. */
export function getSlotChannelOffset(
  layouts: InstrumentSlotLayout[],
  instId: Id,
  slotIndex: number,
): number {
  for (const l of layouts) {
    if (l.instId === instId) {
      return l.baseChannel + slotIndex * l.channelsPerSlot
    }
  }
  return 0
}
