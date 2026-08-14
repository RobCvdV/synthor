import { beforeEach, describe, expect, it } from 'vitest'
import { useSampleClipboard } from './sampleClipboard'

describe('sampleClipboard', () => {
  beforeEach(() => useSampleClipboard.setState({ pb: null }))

  it('stores and clears the paste buffer', () => {
    const data = [new Float32Array([0.5])]
    useSampleClipboard.getState().setClipboard({ data, sampleRate: 44100, channels: 1, frames: 1 })

    const pb = useSampleClipboard.getState().pb
    expect(pb?.sampleRate).toBe(44100)
    expect(pb?.channels).toBe(1)
    expect(pb?.frames).toBe(1)
    expect(pb?.data).toBe(data) // transient pointer — same identity

    useSampleClipboard.getState().setClipboard(null)
    expect(useSampleClipboard.getState().pb).toBeNull()
  })
})
