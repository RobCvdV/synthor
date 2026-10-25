import { beforeEach, describe, expect, it } from 'vitest'
import { useDocStore } from './docStore'
import { createDefaultDoc } from '../domain/factory'

const tempo = () => useDocStore.getState().doc.tempo

describe('tempoOps', () => {
  beforeEach(() => {
    useDocStore.setState({ doc: createDefaultDoc(), past: [], future: [] })
  })

  it('starts a new song at 120 BPM, 4 lines per beat', () => {
    expect(tempo()).toEqual({ bpm: 120, linesPerBeat: 4 })
  })

  it('sets the BPM as one undoable edit', () => {
    useDocStore.getState().setBpm(140)
    expect(tempo().bpm).toBe(140)
    useDocStore.getState().undo()
    expect(tempo().bpm).toBe(120)
  })

  it('clamps the BPM to 20–300 and ignores non-numbers', () => {
    useDocStore.getState().setBpm(1000)
    expect(tempo().bpm).toBe(300)
    useDocStore.getState().setBpm(5)
    expect(tempo().bpm).toBe(20)
    useDocStore.getState().setBpm(Number.NaN)
    expect(tempo().bpm).toBe(20)
  })

  it('sets whole lines per beat, at least 1', () => {
    useDocStore.getState().setLinesPerBeat(3.4)
    expect(tempo().linesPerBeat).toBe(3)
    useDocStore.getState().setLinesPerBeat(0)
    expect(tempo().linesPerBeat).toBe(1)
  })
})
