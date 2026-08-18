import { describe, expect, it } from 'vitest'
import { ensureLeadingSilence } from './samplePrep'

const SR = 48000

describe('ensureLeadingSilence', () => {
  it('pads a loud-starting sample with 5ms of silence by default', () => {
    const ch = new Float32Array(1000)
    ch.fill(0.5)
    const [out] = ensureLeadingSilence([ch], SR)
    const pad = Math.ceil(0.005 * SR)
    expect(out.length).toBe(ch.length + pad)
    for (let i = 0; i < pad; i++) expect(out[i]).toBe(0)
    for (let i = 0; i < ch.length; i++) expect(out[pad + i]).toBe(ch[i])
  })

  it('returns the original arrays when the start is already silent', () => {
    const ch = new Float32Array(1000)
    ch.fill(0.5)
    ch.fill(0, 0, 300) // 6.25ms of silence at 48k
    const out = ensureLeadingSilence([ch], SR)
    expect(out[0]).toBe(ch)
  })

  it('pads all channels when any channel starts loud', () => {
    const loud = new Float32Array(500)
    loud.fill(1)
    const quiet = new Float32Array(500)
    const [pL, pQ] = ensureLeadingSilence([loud, quiet], SR)
    expect(pL.length).toBe(pQ.length)
    expect(pQ[pQ.length - 1]).toBe(0)
    expect(pL[Math.ceil(0.005 * SR)]).toBe(1)
  })

  it('honors a custom silence length', () => {
    const ch = new Float32Array(1000)
    ch.fill(0.5)
    const [out] = ensureLeadingSilence([ch], SR, 10)
    expect(out.length).toBe(ch.length + Math.ceil(0.01 * SR))
  })

  it('treats a quiet ramp as non-silent and pads it', () => {
    const ch = new Float32Array(1000)
    for (let i = 0; i < 1000; i++) ch[i] = 2e-4 * i // exceeds threshold after 500 samples
    const out = ensureLeadingSilence([ch], SR)
    expect(out[0]).not.toBe(ch)
  })
})
