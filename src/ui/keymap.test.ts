import { describe, expect, it } from 'vitest'
import { codeToSemitone, isEditableTarget, keyToHex } from './keymap'

/** Stand in for a DOM element under the node test environment. */
const fakeTarget = (o: { tagName: string; type?: string }) => o as unknown as EventTarget

describe('codeToSemitone', () => {
  it('maps the lower Z row chromatically', () => {
    expect(codeToSemitone('KeyZ')).toBe(0)
    expect(codeToSemitone('KeyM')).toBe(11)
  })

  it('maps the upper Q row one octave up', () => {
    expect(codeToSemitone('KeyQ')).toBe(12)
    expect(codeToSemitone('BracketRight')).toBe(30)
  })

  it('overlaps the tail of the lower row with the upper row', () => {
    expect(codeToSemitone('Comma')).toBe(12)
  })

  it('returns undefined for unknown keys', () => {
    expect(codeToSemitone('Escape')).toBeUndefined()
  })
})

describe('keyToHex', () => {
  it('maps digit and letter codes to hex values', () => {
    expect(keyToHex('Digit0')).toBe(0)
    expect(keyToHex('Digit9')).toBe(9)
    expect(keyToHex('KeyA')).toBe(10)
    expect(keyToHex('KeyF')).toBe(15)
  })

  it('returns undefined for unknown codes', () => {
    expect(keyToHex('KeyG')).toBeUndefined()
  })
})

describe('isEditableTarget', () => {
  it('excludes range sliders so shortcuts keep working while tweaking', () => {
    expect(isEditableTarget(fakeTarget({ tagName: 'INPUT', type: 'range' }))).toBe(false)
  })

  it('includes text inputs, textareas and selects', () => {
    expect(isEditableTarget(fakeTarget({ tagName: 'INPUT', type: 'text' }))).toBe(true)
    expect(isEditableTarget(fakeTarget({ tagName: 'TEXTAREA' }))).toBe(true)
    expect(isEditableTarget(fakeTarget({ tagName: 'SELECT' }))).toBe(true)
  })

  it('is false for null targets', () => {
    expect(isEditableTarget(null)).toBe(false)
  })
})
