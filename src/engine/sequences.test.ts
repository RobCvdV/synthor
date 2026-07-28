import { describe, expect, it } from 'vitest'
import { buildSequences } from '../engine/sequences'
import { emptyCells } from '../domain/factory'
import type { Track } from '../domain/types'

describe('buildSequences', () => {
  it('builds empty effectLanes for track with no lanes', () => {
    const track: Track = {
      id: 'trk_1',
      instrumentId: 'inst_1',
      cells: emptyCells(4),
      effectLanes: [],
    }
    const seq = buildSequences(track, 4)
    expect(seq.effectLanes).toEqual({})
    expect(seq.laneDefs).toEqual([])
    expect(seq.freqSeq).toHaveLength(4)
    expect(seq.gateSeq).toHaveLength(4)
  })

  it('builds per-lane sequences', () => {
    const track: Track = {
      id: 'trk_1',
      instrumentId: 'inst_1',
      cells: emptyCells(4),
      effectLanes: [{ id: 'lan_1', type: 'vibratoDepth' }],
    }
    track.cells[0].effectLanes['lan_1'] = 0.5
    track.cells[2].effectLanes['lan_1'] = 0.8
    const seq = buildSequences(track, 4)
    expect(seq.effectLanes['lan_1']).toEqual([0.5, 0, 0.8, 0])
    expect(seq.laneDefs).toHaveLength(1)
  })
})
