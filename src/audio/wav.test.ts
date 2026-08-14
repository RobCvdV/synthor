import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav'

const ascii = (dv: DataView, off: number, len: number) => {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(dv.getUint8(off + i))
  return s
}

describe('encodeWav', () => {
  it('writes canonical RIFF/WAVE headers for mono', () => {
    const buf = encodeWav([new Float32Array([0, 0.5, -0.5, 1])], 44100)
    const dv = new DataView(buf)
    expect(buf.byteLength).toBe(44 + 4 * 2) // 4 frames × 1 ch × 16-bit
    expect(ascii(dv, 0, 4)).toBe('RIFF')
    expect(dv.getUint32(4, true)).toBe(36 + 8)
    expect(ascii(dv, 8, 4)).toBe('WAVE')
    expect(ascii(dv, 12, 4)).toBe('fmt ')
    expect(dv.getUint32(16, true)).toBe(16)
    expect(dv.getUint16(20, true)).toBe(1) // PCM
    expect(dv.getUint16(22, true)).toBe(1) // channels
    expect(dv.getUint32(24, true)).toBe(44100)
    expect(dv.getUint32(28, true)).toBe(44100 * 2) // byte rate
    expect(dv.getUint16(32, true)).toBe(2) // block align
    expect(dv.getUint16(34, true)).toBe(16) // bits
    expect(ascii(dv, 36, 4)).toBe('data')
    expect(dv.getUint32(40, true)).toBe(8)
  })

  it('writes a golden byte sequence', () => {
    // [1.0, -1.0, 0] mono → 32767, -32767, 0 as little-endian int16
    // (round(v·32767) keeps ±1 symmetric)
    const buf = encodeWav([new Float32Array([1, -1, 0])], 8000)
    const bytes = new Uint8Array(buf)
    expect(Array.from(bytes.slice(44))).toEqual([
      0xff, 0x7f, 0x01, 0x80, 0x00, 0x00,
    ])
  })

  it('clamps out-of-range values', () => {
    const buf = encodeWav([new Float32Array([1.5, -2, 0.99999])], 8000)
    const dv = new DataView(buf)
    expect(dv.getInt16(44, true)).toBe(32767)
    expect(dv.getInt16(46, true)).toBe(-32768)
    expect(dv.getInt16(48, true)).toBe(32767)
  })

  it('interleaves stereo L,R', () => {
    const l = new Float32Array([1, 0.5])
    const r = new Float32Array([-1, -0.5])
    const buf = encodeWav([l, r], 8000)
    const dv = new DataView(buf)
    expect(dv.getInt16(44, true)).toBe(32767) // L0
    expect(dv.getInt16(46, true)).toBe(-32767) // R0
    expect(dv.getInt16(48, true)).toBe(Math.round(0.5 * 32767)) // L1
    expect(dv.getInt16(50, true)).toBe(Math.round(-0.5 * 32767)) // R1
  })

  it('is deterministic (same input → identical bytes)', () => {
    const data = new Float32Array(128)
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i / 7) * 0.9
    const a = new Uint8Array(encodeWav([data], 44100))
    const b = new Uint8Array(encodeWav([data], 44100))
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('round-trips a re-encode of decoded values bit-identically', () => {
    // Encode → decode ints → re-encode should be a fixed point.
    const data = new Float32Array(64)
    for (let i = 0; i < data.length; i++) data[i] = (Math.sin(i) * 0.9)
    const first = new Uint8Array(encodeWav([data], 44100))
    const dv = new DataView(first.buffer)
    const back = new Float32Array(data.length)
    for (let i = 0; i < data.length; i++) back[i] = dv.getInt16(44 + i * 2, true) / 32767
    const second = new Uint8Array(encodeWav([back], 44100))
    expect(Array.from(first)).toEqual(Array.from(second))
  })

  it('throws on empty input and mismatched channels', () => {
    expect(() => encodeWav([], 44100)).toThrow()
    expect(() => encodeWav([new Float32Array(0)], 44100)).toThrow()
    expect(() => encodeWav([new Float32Array(4), new Float32Array(3)], 44100)).toThrow()
  })
})
