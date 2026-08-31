/**
 * Packing of playback data for the txSeq native node (src/native/TxSeq.h).
 *
 * The node reads one Float32Array shared resource laid out as:
 *   [0] = version (1), [1] = totalRows, [2] = numSlots
 *   per slot s: [3+3s] signalCount, [4+3s] drumGateCount, [5+3s] signalOffset
 *   headerSize = 3 + 3*numSlots
 *   data: row r, slot s, signal c →
 *     headerSize + r * totalSignals + signalOffset[s] + c
 * The node's output channel for slot s signal c is s * MAX_SLOT_SIGNALS + c.
 */

import type { PlaybackData } from './playbackData'

export const TXSEQ_VERSION = 1
export const MAX_SLOT_SIGNALS = 32

/** Output channel index for one signal of one slot. */
export function slotChannel(slotIndex: number, signalIndex: number): number {
  return slotIndex * MAX_SLOT_SIGNALS + signalIndex
}

/** Serialize a full playback pass into the node's upload format. */
export function buildTxSeqData(data: PlaybackData): Float32Array {
  const { slots, totalRows } = data

  const header = [TXSEQ_VERSION, totalRows, slots.length]
  let totalSignals = 0
  for (const slot of slots) {
    const sc = slot.signals.length
    header.push(sc, slot.drumGateCount, totalSignals)
    totalSignals += sc
  }

  const out = new Float32Array(header.length + totalRows * totalSignals)
  out.set(header, 0)

  for (let r = 0; r < totalRows; r++) {
    const rowBase = header.length + r * totalSignals
    let offset = 0
    for (const slot of slots) {
      for (let c = 0; c < slot.signals.length; c++) {
        out[rowBase + offset + c] = slot.signals[c]?.[r] ?? 0
      }
      offset += slot.signals.length
    }
  }

  return out
}
