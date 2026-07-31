import { describe, expect, it } from 'vitest'
import { useTransportStore, PLAY_MODES } from './transportStore'

/** Call before each test to reset the store to defaults. */
function resetStore() {
  useTransportStore.setState({
    playing: false,
    playMode: 'pattern',
    bpm: 120,
    linesPerBeat: 4,
    startTime: 0,
    startRow: 0,
    playEpoch: 0,
  })
}

describe('transportStore', () => {
  beforeEach(resetStore)

  /* ---- play / stop ---- */

  it('starts stopped', () => {
    expect(useTransportStore.getState().playing).toBe(false)
  })

  it('play() sets playing=true and increments playEpoch', () => {
    const before = useTransportStore.getState().playEpoch
    useTransportStore.getState().play(42, 16)
    const s = useTransportStore.getState()
    expect(s.playing).toBe(true)
    expect(s.startTime).toBe(42)
    expect(s.startRow).toBe(16)
    expect(s.playEpoch).toBe(before + 1)
  })

  it('stop() sets playing=false without changing epoch', () => {
    useTransportStore.getState().play(0)
    const epoch = useTransportStore.getState().playEpoch
    useTransportStore.getState().stop()
    expect(useTransportStore.getState().playing).toBe(false)
    expect(useTransportStore.getState().playEpoch).toBe(epoch)
  })

  it('toggle() flips playing state', () => {
    const store = useTransportStore.getState()
    store.toggle(10, 0)
    expect(useTransportStore.getState().playing).toBe(true)
    useTransportStore.getState().toggle(20, 0)
    expect(useTransportStore.getState().playing).toBe(false)
  })

  it('startRow defaults to 0', () => {
    useTransportStore.getState().play(7)
    expect(useTransportStore.getState().startRow).toBe(0)
  })

  /* ---- bpm ---- */

  it('defaults to 120 BPM', () => {
    expect(useTransportStore.getState().bpm).toBe(120)
  })

  it('setBpm() updates the tempo', () => {
    useTransportStore.getState().setBpm(140)
    expect(useTransportStore.getState().bpm).toBe(140)
  })

  /* ---- play mode ---- */

  it('defaults to pattern mode', () => {
    expect(useTransportStore.getState().playMode).toBe('pattern')
  })

  it('setPlayMode() switches to a different mode', () => {
    useTransportStore.getState().setPlayMode('song')
    expect(useTransportStore.getState().playMode).toBe('song')
    useTransportStore.getState().setPlayMode('section')
    expect(useTransportStore.getState().playMode).toBe('section')
  })

  it('cyclePlayMode() cycles through all three modes', () => {
    const store = useTransportStore.getState()
    expect(store.playMode).toBe('pattern')
    store.cyclePlayMode()
    expect(useTransportStore.getState().playMode).toBe('song')
    useTransportStore.getState().cyclePlayMode()
    expect(useTransportStore.getState().playMode).toBe('section')
    useTransportStore.getState().cyclePlayMode()
    expect(useTransportStore.getState().playMode).toBe('pattern') // wraps around
  })

  it('PLAY_MODES contains all three modes in order', () => {
    expect(PLAY_MODES).toEqual(['song', 'section', 'pattern'])
    expect(new Set(PLAY_MODES).size).toBe(3)
  })

  /* ---- playEpoch isolation ---- */

  it('each play() call increments playEpoch', () => {
    const store = useTransportStore.getState()
    store.play(1)
    const e1 = useTransportStore.getState().playEpoch
    useTransportStore.getState().stop()
    useTransportStore.getState().play(2)
    expect(useTransportStore.getState().playEpoch).toBe(e1 + 1)
  })

  /* ---- lines per beat ---- */

  it('defaults to 4 lines per beat (16th notes)', () => {
    expect(useTransportStore.getState().linesPerBeat).toBe(4)
  })
})
