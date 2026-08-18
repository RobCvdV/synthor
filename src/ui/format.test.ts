import { describe, expect, it } from 'vitest'
import { formatDuration, formatSize, saveLabel } from './format'

describe('formatDuration', () => {
  it('renders sub-second durations in ms', () => {
    expect(formatDuration(44100, 4410)).toBe('100ms')
    expect(formatDuration(44100, 441)).toBe('10ms')
  })

  it('renders seconds with two decimals by default', () => {
    expect(formatDuration(44100, 44100)).toBe('1.00s')
    expect(formatDuration(44100, 66150)).toBe('1.50s')
  })

  it('accepts a digit override', () => {
    expect(formatDuration(44100, 44100, 1)).toBe('1.0s')
    expect(formatDuration(44100, 66150, 1)).toBe('1.5s')
  })
})

describe('formatSize', () => {
  it('renders plain bytes below 1 KB', () => {
    expect(formatSize(100, 1)).toBe('400 B')
  })

  it('renders KB below 1 MB', () => {
    expect(formatSize(1000, 2)).toBe('7.8 KB')
  })

  it('renders MB from 1 MB up', () => {
    expect(formatSize(44100 * 60, 2)).toBe('20.2 MB')
  })
})

describe('saveLabel', () => {
  it('maps status to labels', () => {
    expect(saveLabel('saving', null)).toBe('Saving…')
    expect(saveLabel('error', null)).toBe('⚠ Save failed')
    expect(saveLabel('dirty', null)).toBe('Unsaved')
  })

  it('shows the save time when available', () => {
    const t = new Date('2026-08-18T10:00:00').toISOString()
    expect(saveLabel('idle', t)).toBe(`Saved ${new Date(t).toLocaleTimeString()}`)
  })

  it('falls back when never saved', () => {
    expect(saveLabel('idle', null)).toBe('Not saved yet')
  })
})
