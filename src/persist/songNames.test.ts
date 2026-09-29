import { describe, expect, it } from 'vitest'
import { songNameConflict, uniqueSongName } from './songNames'

describe('uniqueSongName', () => {
  it('keeps a free name', () => {
    expect(uniqueSongName('Untitled', ['groove'])).toBe('Untitled')
  })

  it('numbers the name until its slug is free', () => {
    expect(uniqueSongName('Untitled', ['untitled', 'untitled-2'])).toBe('Untitled 3')
  })
})

describe('songNameConflict', () => {
  it('rejects a name whose slug another song uses, even when spelled differently', () => {
    expect(songNameConflict('My Song!', ['my-song'])).toMatch(/already/)
  })

  it('accepts the song keeping its own slug', () => {
    expect(songNameConflict('My song', ['my-song'], 'my-song')).toBeNull()
  })

  it('rejects an empty name', () => {
    expect(songNameConflict('  ', [])).toMatch(/name/)
  })

  it('accepts a free name', () => {
    expect(songNameConflict('New', ['old'])).toBeNull()
  })
})
