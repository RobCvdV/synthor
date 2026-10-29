// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { GameMusic } from '../../domain/gameMusic'
import type { ConductorSnapshot } from '../../headless/GameConductor'
import { useDocStore } from '../../state/docStore'
import { resetStores } from '../test/testUtils'
import { GameSimulator } from './GameSimulator'
import { GameView } from './GameView'

const game: GameMusic = {
  bar: 16,
  song: { start: 'verse', sections: [{ cue: 'verse', energy: 2, bars: 4, toys: ['drums', 'arp'] }] },
  dj: { groups: { drums: [1, 2], arp: [10] }, phraseBars: 4, fadeBars: 2, stays: [4] },
  moods: { menu: { cue: 'menu' }, danger: { cue: 'danger', returns: true } },
  drops: { penalty: [1, 2] },
  stingers: {
    keys: { instrument: 'Bell', notes: [69], at: 'row', rows: 1 },
    unlock: { instrument: 'Bell', notes: [76], at: 'row', rows: 1 },
  },
}

const snap: ConductorSnapshot = {
  mood: 'play', section: 'verse', sounding: 'verse',
  visit: { section: 'verse', bars: 5, stay: 16, out: ['arp'], cut: [] },
  due: false, nudged: false, energy: { heat: 0.2, rest: 0 }, target: 2.1,
  level: 2, progress: 0.5, lastMove: { kind: 'out', part: 'arp' },
}

/** A simulator that never makes sound */
function quietSimulator(): GameSimulator {
  const sim = new GameSimulator()
  sim.preload = () => {}
  return sim
}

describe('GameView', () => {
  beforeEach(() => {
    resetStores()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('says so when the song has no game settings', () => {
    const { container } = render(<GameView simulator={quietSimulator()} />)
    expect(screen.getByText(/no game settings/)).toBeInTheDocument()
    expect(container).toMatchSnapshot()
  })

  it(`offers the settings' moods and events, waiting for a start`, () => {
    useDocStore.setState({ doc: { ...useDocStore.getState().doc, game } })
    const { container } = render(<GameView simulator={quietSimulator()} />)
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'danger' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'unlock' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'keys' })).toBeNull()
    expect(container).toMatchSnapshot()
  })

  it('shows what the conductor does while it plays, and passes the events on', () => {
    useDocStore.setState({ doc: { ...useDocStore.getState().doc, game } })
    const sim = quietSimulator()
    vi.spyOn(sim, 'snapshot').mockReturnValue(snap)
    const cascade = vi.spyOn(sim, 'cascade').mockImplementation(() => {})
    const setMood = vi.spyOn(sim, 'setMood').mockImplementation(() => {})
    sim.log = ['section verse energy 2.1 for 16 bars', 'dj verse {"kind":"out","part":"arp"}']
    const { container } = render(<GameView simulator={sim} />)
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByText('5 / 16 bars')).toBeInTheDocument()
    expect(screen.getByText('− arp')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cascade 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'danger' }))
    expect(cascade).toHaveBeenCalledWith(3)
    expect(setMood).toHaveBeenCalledWith('danger')
    expect(container).toMatchSnapshot()
  })
})
