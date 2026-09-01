/**
 * Pure functions to convert a Doc + arrangement into per-slot data structures
 * consumed by the scheduler AudioWorklet.  No audio imports, no DOM, no React —
 * unit-testable with vitest.
 *
 * Voice slots are pre-allocated per instrument.  Tracks from different patterns
 * that never play simultaneously share the same slot.  The graph is compiled once
 * with all slots; the scheduler routes track data to the correct slot at the
 * correct time.
 */

import type { Doc, Id } from '../domain/types'
import { buildSequences, buildDrumKitSlotSequences } from '../engine/sequences'
import { computeSlotLayouts, REGULAR_CH, DRUMKIT_CH, DRUMKIT_EXTRA_CHANNELS } from '../engine/voiceSlotLayout'
import type { InstrumentSlotLayout } from '../engine/voiceSlotLayout'
import type { ArrangementItem } from '../engine/arrangement'

/** Per-slot row data sent to the scheduler worklet.
 *
 *  Each slot has a fixed set of control channels (see REGULAR_CH / DRUMKIT_CH).
 *  `signals[i]` is the per-row value array for channel `offset + i`.
 *  The scheduler outputs `signals[i][row]` on output channel `offset + i`. */
export interface VoiceSlotData {
  instId: Id
  slotIndex: number
  /** Per-channel signal arrays.  Layout matches InstrumentSlotLayout:
   *  Regular: [gate, freq, vol, portamento, volumeSlide, panning,
   *            vibratoRate, vibratoDepth, tremoloRate, tremoloDepth,
   *            staccato, ...namedInlets]
   *  Drumkit: [drumGate0, ..., drumGateN-1, vol, portamento, volumeSlide,
   *            panning, vibratoRate, vibratoDepth, tremoloRate, tremoloDepth,
   *            staccato, ...namedInlets] */
  signals: number[][]
  /** Number of drum gate channels (0 for regular instrument slots). */
  drumGateCount: number
}

/** Complete playback data for the scheduler. */
export interface PlaybackData {
  slots: VoiceSlotData[]
  totalRows: number
  /** Arrangement items for section/song mode (pattern windows). */
  arrangement: ArrangementItem[]
}

/** Default values for effect channels (used when a track doesn't have a
 *  particular effect lane — the channel still needs a value). */
const EFFECT_DEFAULTS: Record<string, number> = {
  portamento: 0.5,
  volumeSlide: 1,
  panning: 0.5,
  vibratoRate: 0,
  vibratoDepth: 0,
  tremoloRate: 0,
  tremoloDepth: 0,
  staccato: 1,
}

/** Map a lane type to its channel index within a slot's signals array. */
function laneTypeToChannelIndex(
  laneType: string,
  layout: InstrumentSlotLayout,
): number {
  if (layout.isDrumkit) {
    const dkCh = DRUMKIT_CH as Record<string, number>
    const drumSounds = layout.drumSounds ?? 0
    if (laneType in dkCh) return 2 * drumSounds + dkCh[laneType]
    const namedIdx = layout.namedInletIds.indexOf(laneType)
    if (namedIdx >= 0) return 2 * drumSounds + DRUMKIT_EXTRA_CHANNELS + namedIdx
    return -1
  }

  const regCh = REGULAR_CH as Record<string, number>
  if (laneType in regCh) return regCh[laneType]
  const namedIdx = layout.namedInletIds.indexOf(laneType)
  if (namedIdx >= 0) return 11 + namedIdx
  return -1
}

/** Create a VoiceSlotData with all signal arrays initialized to defaults. */
function createSlotData(
  instId: Id,
  slotIndex: number,
  totalRows: number,
  layout: InstrumentSlotLayout,
): VoiceSlotData {
  const signals: number[][] = new Array(layout.channelsPerSlot)

  if (layout.isDrumkit) {
    const drumSounds = layout.drumSounds ?? 0
    // Drum-gate channels [0..N-1] and drum-freq channels [N..2N-1].
    for (let d = 0; d < drumSounds; d++) {
      signals[d] = new Array(totalRows).fill(0)
      signals[drumSounds + d] = new Array(totalRows).fill(0)
    }
    const effBase = 2 * drumSounds
    signals[effBase + DRUMKIT_CH.vol] = new Array(totalRows).fill(1)
    for (const [key, chIdx] of Object.entries(DRUMKIT_CH)) {
      if (key === 'vol') continue
      const ch = effBase + (chIdx as number)
      signals[ch] = new Array(totalRows).fill(EFFECT_DEFAULTS[key] ?? 0)
    }
    for (let ni = 0; ni < layout.namedInletIds.length; ni++) {
      signals[effBase + DRUMKIT_EXTRA_CHANNELS + ni] = new Array(totalRows).fill(0)
    }
  } else {
    signals[REGULAR_CH.gate] = new Array(totalRows).fill(0)
    signals[REGULAR_CH.freq] = new Array(totalRows).fill(0)
    signals[REGULAR_CH.vol] = new Array(totalRows).fill(1)
    signals[REGULAR_CH.staccato] = new Array(totalRows).fill(1)
    for (const [key, chIdx] of Object.entries(REGULAR_CH)) {
      if (key === 'gate' || key === 'freq' || key === 'vol' || key === 'staccato') continue
      signals[chIdx as number] = new Array(totalRows).fill(EFFECT_DEFAULTS[key] ?? 0)
    }
    for (let ni = 0; ni < layout.namedInletIds.length; ni++) {
      signals[11 + ni] = new Array(totalRows).fill(0)
    }
  }

  return { instId, slotIndex, signals, drumGateCount: layout.isDrumkit ? (layout.drumSounds ?? 0) : 0 }
}

/** Copy track sequence data into a regular-instrument slot's signals arrays
 *  for a pattern window.
 *
 *  Gate/freq/vol/staccato come from buildSequences.  Effect lane values are
 *  only written for cells that explicitly set them — rows without an explicit
 *  value keep the slot's default (portamento=0.5, panning=0.5, etc.).  This
 *  avoids overwriting correct defaults with buildSequences' lane fallback
 *  which differs (panning falls back to 0). */
function copyRegularTrackToSlot(
  slot: VoiceSlotData,
  layout: InstrumentSlotLayout,
  track: { effectLanes: { id: Id; type: string }[]; cells: { effectLanes: Record<Id, number | null> }[] },
  sequences: ReturnType<typeof buildSequences>,
  startRow: number,
  patternLength: number,
): void {
  const { freqSeq, gateSeq, volumeSeq, staccatoSeq } = sequences

  for (let r = 0; r < patternLength; r++) {
    const destRow = startRow + r
    slot.signals[REGULAR_CH.gate][destRow] = gateSeq[r]
    slot.signals[REGULAR_CH.freq][destRow] = freqSeq[r]
    slot.signals[REGULAR_CH.vol][destRow] = volumeSeq[r]
    slot.signals[REGULAR_CH.staccato][destRow] = staccatoSeq[r]
  }

  // Effect lanes: only copy cells where the user set an explicit value.
  // The slot was initialised with correct per-effect defaults.
  for (const lane of track.effectLanes) {
    const chIdx = laneTypeToChannelIndex(lane.type, layout)
    if (chIdx < 0 || chIdx >= slot.signals.length) continue
    for (let r = 0; r < patternLength; r++) {
      const cellVal = track.cells[r]?.effectLanes[lane.id]
      if (cellVal !== null && cellVal !== undefined) {
        slot.signals[chIdx][startRow + r] = cellVal
      }
    }
  }
}

/** Map one pattern's tracks to their compiled voice slots, using the exact
 *  assignment rule buildPlaybackData applies (per-instrument counter; slots
 *  beyond the layout's slotCount are skipped but still counted). Tracks with
 *  missing entities or instruments are omitted. */
export function mapPatternTracksToSlots(
  doc: Doc,
  patternId: Id,
  layoutByInst?: Map<Id, InstrumentSlotLayout>,
): Map<Id, number> {
  const pattern = doc.entities.patterns[patternId]
  const map = new Map<Id, number>()
  if (!pattern) return map
  const layouts = layoutByInst ?? (() => {
    const m = new Map<Id, InstrumentSlotLayout>()
    for (const l of computeSlotLayouts(doc)) m.set(l.instId, l)
    return m
  })()
  const nextSlot = new Map<Id, number>()
  for (const trackId of pattern.trackIds) {
    const track = doc.entities.tracks[trackId]
    if (!track) continue
    if (!doc.entities.instruments[track.instrumentId]) continue
    const layout = layouts.get(track.instrumentId)
    if (!layout) continue
    const slotIdx = nextSlot.get(track.instrumentId) ?? 0
    nextSlot.set(track.instrumentId, slotIdx + 1)
    if (slotIdx >= layout.slotCount) continue
    map.set(trackId, slotIdx)
  }
  return map
}

/** Build the playback data for the given doc and arrangement. */
export function buildPlaybackData(
  doc: Doc,
  arrangement: readonly ArrangementItem[],
): PlaybackData {
  const layouts = computeSlotLayouts(doc)
  const totalRows = arrangement.reduce(
    (sum, a) => sum + (doc.entities.patterns[a.patternId]?.length ?? 0),
    0,
  )

  const layoutByInst = new Map<Id, InstrumentSlotLayout>()
  for (const l of layouts) layoutByInst.set(l.instId, l)

  // Create slot data for every instrument slot.
  const allSlots: VoiceSlotData[] = []
  for (const layout of layouts) {
    for (let si = 0; si < layout.slotCount; si++) {
      allSlots.push(createSlotData(layout.instId, si, totalRows, layout))
    }
  }

  // Assign tracks to slots per pattern window.
  for (const item of arrangement) {
    const pattern = doc.entities.patterns[item.patternId]
    if (!pattern) continue

    const trackToSlot = mapPatternTracksToSlots(doc, item.patternId, layoutByInst)
    for (const [trackId, slotIdx] of trackToSlot) {
      const track = doc.entities.tracks[trackId]
      if (!track) continue
      const inst = doc.entities.instruments[track.instrumentId]
      if (!inst) continue
      const layout = layoutByInst.get(track.instrumentId)
      if (!layout) continue

      const slot = allSlots.find(
        (s) => s.instId === layout.instId && s.slotIndex === slotIdx,
      )
      if (!slot) continue

      const seq = buildSequences(track, pattern.length)

      if (layout.isDrumkit && inst.kind === 'drumkit') {
        const { slotGateSeqs, slotFreqSeqs } = buildDrumKitSlotSequences(track, pattern.length, inst)
        const drumSounds = layout.drumSounds ?? 0
        const effBase = 2 * drumSounds

        // Copy per-slot drum gates into signals[0..N-1] and freqs into [N..2N-1].
        for (let d = 0; d < drumSounds; d++) {
          const dkSlot = inst.slots[d]
          if (!dkSlot) continue
          const gateSeq = slotGateSeqs[dkSlot.id]
          const freqSeq = slotFreqSeqs[dkSlot.id]
          for (let r = 0; r < pattern.length; r++) {
            if (gateSeq) slot.signals[d][item.startRow + r] = gateSeq[r]
            if (freqSeq) slot.signals[drumSounds + d][item.startRow + r] = freqSeq[r]
          }
        }

        // Copy vol and staccato.
        for (let r = 0; r < pattern.length; r++) {
          const destRow = item.startRow + r
          const volCh = effBase + DRUMKIT_CH.vol
          if (volCh < slot.signals.length) {
            slot.signals[volCh][destRow] = seq.volumeSeq[r]
          }
          const stacCh = effBase + DRUMKIT_CH.staccato
          if (stacCh < slot.signals.length) {
            slot.signals[stacCh][destRow] = seq.staccatoSeq[r]
          }
        }

        // Map effect lane values — only explicit cell values.
        for (const lane of track.effectLanes) {
          const chIdx = laneTypeToChannelIndex(lane.type, layout)
          if (chIdx < 0 || chIdx >= slot.signals.length) continue
          for (let r = 0; r < pattern.length; r++) {
            const cellVal = track.cells[r]?.effectLanes[lane.id]
            if (cellVal !== null && cellVal !== undefined) {
              slot.signals[chIdx][item.startRow + r] = cellVal
            }
          }
        }
      } else {
        copyRegularTrackToSlot(slot, layout, track, seq, item.startRow, pattern.length)
      }
    }
  }

  // Diagnostic: log slot occupancy.
  if (allSlots.length > 0) {
    const lines = allSlots.map((s) => {
      const name = doc.entities.instruments[s.instId]?.name ?? s.instId.slice(0, 8)
      const activeRow = s.signals[0]?.findIndex((v) => v !== 0)
      const activeEnd = activeRow != null && activeRow >= 0
        ? s.signals[0]?.lastIndexOf(1)
        : undefined
      return `${name} slot ${s.slotIndex}: ` +
        `gate rows ${activeRow ?? 'none'}${activeEnd != null && activeEnd !== activeRow ? `-${activeEnd}` : ''}${s.drumGateCount > 0 ? ` (dk ${s.drumGateCount})` : ''}`
    })
    console.log('[playbackData]', lines.join('\n  '), `\n  totalRows: ${totalRows}`)
  }

  return {
    slots: allSlots,
    totalRows,
    arrangement: [...arrangement],
  }
}
