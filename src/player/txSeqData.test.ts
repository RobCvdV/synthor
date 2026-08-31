/**
 * Packing contract for the txSeq native node (src/native/TxSeq.h): header
 * layout, row-major data order, and output channel mapping.
 */
import { buildTxSeqData, slotChannel, MAX_SLOT_SIGNALS, TXSEQ_VERSION } from './txSeqData'
import type { PlaybackData } from './playbackData'

function fixture(): PlaybackData {
  return {
    slots: [
      {
        instId: 'i1',
        slotIndex: 0,
        signals: [
          [1, 0, 1, 0], // gate (4 rows)
          [440, 220, 440, 220], // freq
        ],
        channelOffset: 0,
        drumGateCount: 0,
      },
      {
        instId: 'i2',
        slotIndex: 1,
        signals: [
          [0, 1, 0, 0], // drum gate 0
          [0, 0, 1, 0], // drum gate 1
        ],
        channelOffset: 0,
        drumGateCount: 2,
      },
    ],
    totalRows: 4,
    arrangement: [],
  }
}

describe('buildTxSeqData', () => {
  it('writes the header with per-slot layout', () => {
    const buf = buildTxSeqData(fixture())

    expect(buf[0]).toBe(TXSEQ_VERSION)
    expect(buf[1]).toBe(4) // totalRows
    expect(buf[2]).toBe(2) // numSlots

    // slot 0: 2 signals, no drum gates, data offset 0
    expect(buf[3]).toBe(2)
    expect(buf[4]).toBe(0)
    expect(buf[5]).toBe(0)

    // slot 1: 2 signals, 2 drum gates, data offset 2
    expect(buf[6]).toBe(2)
    expect(buf[7]).toBe(2)
    expect(buf[8]).toBe(2)

    // total payload = header (3 + 3*2) + rows * totalSignals (4 * 4)
    expect(buf.length).toBe(9 + 4 * 4)
  })

  it('lays data out row-major: row, slot, signal', () => {
    const buf = buildTxSeqData(fixture())
    const headerSize = 9

    // row 0: slot0 gate 1, slot0 freq 440, slot1 drum0 0, slot1 drum1 0
    expect(buf[headerSize + 0]).toBe(1)
    expect(buf[headerSize + 1]).toBe(440)
    expect(buf[headerSize + 2]).toBe(0)
    expect(buf[headerSize + 3]).toBe(0)

    // row 1: slot0 gate 0, freq 220, slot1 drum0 1, drum1 0
    const row1 = headerSize + 4
    expect(buf[row1 + 0]).toBe(0)
    expect(buf[row1 + 1]).toBe(220)
    expect(buf[row1 + 2]).toBe(1)
    expect(buf[row1 + 3]).toBe(0)

    // row 2: slot0 gate 1, slot1 drum1 1
    const row2 = headerSize + 8
    expect(buf[row2 + 0]).toBe(1)
    expect(buf[row2 + 3]).toBe(1)
  })

  it('maps output channels as slotIndex * MAX + signalIndex', () => {
    expect(slotChannel(0, 0)).toBe(0)
    expect(slotChannel(0, 10)).toBe(10)
    expect(slotChannel(1, 0)).toBe(MAX_SLOT_SIGNALS)
    expect(slotChannel(2, 3)).toBe(2 * MAX_SLOT_SIGNALS + 3)
  })
})
