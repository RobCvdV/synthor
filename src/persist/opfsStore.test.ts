import { describe, expect, it } from 'vitest'
import { isOpfsSupported, slugify } from './opfsStore'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('My First Song')).toBe('my-first-song')
  })

  it('strips punctuation and collapses separators', () => {
    expect(slugify('  Hello, World!! ')).toBe('hello-world')
    expect(slugify('a___b   c')).toBe('a-b-c')
  })

  it('falls back to "untitled" for empty/symbol-only names', () => {
    expect(slugify('')).toBe('untitled')
    expect(slugify('!!!')).toBe('untitled')
  })
})

describe('isOpfsSupported', () => {
  it('is false in a non-browser (no navigator.storage) environment', () => {
    // vitest runs in node; guards the graceful-degradation path.
    expect(isOpfsSupported()).toBe(false)
  })
})
