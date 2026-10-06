import { beforeEach, describe, expect, it } from 'vitest'
import { useSampleAudition } from './sampleAudition'

describe('sampleAudition', () => {
  beforeEach(() => useSampleAudition.setState({ audition: null }))

  it('versions every change and clears', () => {
    const data = [new Float32Array([0.5])]
    const a = { sampleId: 's1', hash: 'h', data, original: data, sampleRate: 44100 }
    useSampleAudition.getState().setAudition(a)
    const first = useSampleAudition.getState().audition!.version
    useSampleAudition.getState().setAudition(a)
    expect(useSampleAudition.getState().audition!.version).toBe(first + 1)
    expect(useSampleAudition.getState().audition!.data).toBe(data)
    useSampleAudition.getState().clearAudition()
    expect(useSampleAudition.getState().audition).toBeNull()
  })
})
