import { describe, expect, it } from 'vitest'
import { createDefaultDoc } from './factory'
import {
  cueNames, formatNotes, instrumentNames, formatTracks, freeName, parseNotes, parseTracks, removeGroup, removeSection, renameGroup,
  renameKey, retargetSection, starterGame,
} from './gameEdit'
import type { GameMusic } from './gameMusic'

const game = (): GameMusic => ({
  bar: 16,
  song: {
    start: 'verse',
    sections: [
      { cue: 'verse', energy: 2, bars: 4, toys: ['drums', 'arp'], next: ['pre', 'break'] },
      { cue: 'pre', energy: 3, bars: 1, transition: true, next: ['chorus'] },
      { cue: 'chorus', energy: 5, bars: 8, toys: ['drums'], next: ['verse'] },
    ],
    peak: { cue: 'pre', from: 0.85 },
  },
  dj: { groups: { drums: [1, 2], arp: [10] }, phraseBars: 4, fadeBars: 2, stays: [4] },
  moods: {},
  drops: {},
  stingers: {},
})

describe('editing game settings', () => {
  it('starts a song off with its sections, by name, their length in bars', () => {
    const doc = createDefaultDoc()
    const starter = starterGame(doc)
    const section = doc.entities.sections[doc.sectionIds[0]]
    const rows = section.patternIds.reduce((sum, pid) => sum + doc.entities.patterns[pid].length, 0)
    expect(starter.bar).toBe(doc.tempo.linesPerBeat * 4)
    expect(starter.song).toEqual({ start: section.name, sections: [{ cue: section.name, energy: 3, bars: Math.max(1, Math.round(rows / starter.bar)) }] })
    expect(starter.dj.stays).toEqual([4, 4, 6, 6, 8])
  })

  it('names the cues and instruments a song offers, sections first', () => {
    const doc = createDefaultDoc()
    const section = doc.entities.sections[doc.sectionIds[0]]
    const pattern = doc.entities.patterns[doc.patternId]
    expect(cueNames(doc)).toEqual([section.name, ...new Set([pattern.name].filter((n) => n !== section.name))])
    expect(instrumentNames(doc)).toEqual(Object.values(doc.entities.instruments).map((i) => i.name))
  })

  it('writes and reads track #s as runs', () => {
    expect(formatTracks([6, 1, 2, 3, 4, 9, 10])).toBe('1-4, 6, 9-10')
    expect(formatTracks([])).toBe('')
    expect(parseTracks('1-4, 6 9-10')).toEqual([1, 2, 3, 4, 6, 9, 10])
    expect(parseTracks('3-1, x, 0, 2')).toEqual([1, 2, 3])
  })

  it('writes notes by name and reads names or numbers', () => {
    expect(formatNotes([69, 72])).toBe('A-4 C-5')
    expect(parseNotes('A-4 C5, 76 nope')).toEqual([69, 72, 76])
  })

  it('moves a section to another cue, and takes the ways into it along', () => {
    const g = game()
    retargetSection(g, 'pre', 'fill-in')
    expect(g.song.sections.map((s) => s.cue)).toEqual(['verse', 'fill-in', 'chorus'])
    expect(g.song.sections[0].next).toEqual(['fill-in', 'break'])
    expect(g.song.peak?.cue).toBe('fill-in')
  })

  it('removes a section with every way into it', () => {
    const g = game()
    removeSection(g, 'pre')
    expect(g.song.sections[0].next).toEqual(['break'])
    expect(g.song.peak).toBeUndefined()
    removeSection(g, 'verse')
    expect(g.song.start).toBe('chorus')
  })

  it('renames and removes DJ parts in the sections that play with them', () => {
    const g = game()
    renameGroup(g, 'drums', 'beat')
    expect(Object.keys(g.dj.groups)).toEqual(['beat', 'arp'])
    expect(g.song.sections[0].toys).toEqual(['beat', 'arp'])
    renameGroup(g, 'beat', 'arp') // taken: nothing changes
    expect(Object.keys(g.dj.groups)).toEqual(['beat', 'arp'])
    removeGroup(g, 'arp')
    expect(g.dj.groups).toEqual({ beat: [1, 2] })
    expect(g.song.sections[0].toys).toEqual(['beat'])
  })

  it('renames keys in place and finds free names', () => {
    expect(Object.keys(renameKey({ a: 1, b: 2, c: 3 }, 'b', 'x'))).toEqual(['a', 'x', 'c'])
    expect(renameKey({ a: 1, b: 2 }, 'a', 'b')).toEqual({ a: 1, b: 2 })
    expect(freeName(['mood', 'mood 2'], 'mood')).toBe('mood 3')
    expect(freeName([], 'mood')).toBe('mood')
  })
})
