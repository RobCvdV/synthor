// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { createDefaultDoc } from '../../domain/factory'
import type { GameMusic } from '../../domain/gameMusic'
import { useDocStore } from '../../state/docStore'
import { resetStores } from '../test/testUtils'
import { GameSettings } from './GameSettings'

const game = (doc = useDocStore.getState().doc): GameMusic => {
  const section = doc.entities.sections[doc.sectionIds[0]].name
  const instrument = Object.values(doc.entities.instruments)[0].name
  return {
    bar: 16,
    song: { start: section, sections: [{ cue: section, energy: 2, bars: 4, toys: ['drums'] }] },
    dj: { groups: { drums: [1, 2], arp: [10] }, phraseBars: 4, fadeBars: 2, stays: [4, 6] },
    moods: { menu: { cue: section } },
    fills: [{ cue: section, goes: 'level', maxEnergy: 2 }],
    drops: { penalty: [1, 2] },
    stingers: { unlock: { instrument, notes: [69, 76], at: 'beat', rows: 2 } },
  }
}

const settings = () => useDocStore.getState().doc.game!

function renderSettings() {
  useDocStore.getState().loadDoc({ ...createDefaultDoc(), game: game(createDefaultDoc()) })
  return render(<GameSettings game={settings()} />)
}

/** Type into a field and leave it, as an edit commits */
function enter(field: HTMLElement, text: string) {
  fireEvent.change(field, { target: { value: text } })
  fireEvent.blur(field)
}

describe('GameSettings', () => {
  beforeEach(() => resetStores())

  it('shows every part of the settings', () => {
    const { container } = renderSettings()
    expect(container).toMatchSnapshot()
  })

  it('edits numbers, track #s and notes as one undo step each', () => {
    renderSettings()
    enter(screen.getByRole('textbox', { name: 'Energy' }), '4.5')
    expect(settings().song.sections[0].energy).toBe(4.5)
    enter(screen.getByRole('textbox', { name: 'Energy' }), 'loud') // not a number: reverts
    expect(settings().song.sections[0].energy).toBe(4.5)
    enter(screen.getAllByRole('textbox', { name: 'Track #s' })[0], '3-5, 7')
    expect(settings().dj.groups.drums).toEqual([3, 4, 5, 7])
    enter(screen.getByRole('textbox', { name: /^Notes/ }), 'C-5 E5')
    expect(settings().stingers.unlock.notes).toEqual([72, 76])
    useDocStore.getState().undo()
    expect(settings().stingers.unlock.notes).toEqual([69, 76])
  })

  it(`renames a DJ part in the sections that play with it`, () => {
    renderSettings()
    enter(screen.getByDisplayValue('drums'), 'beat')
    expect(Object.keys(settings().dj.groups)).toEqual(['beat', 'arp'])
    expect(settings().song.sections[0].toys).toEqual(['beat'])
  })

  it('toggles parts, adds and removes rows', () => {
    const { rerender } = renderSettings()
    const sections = screen.getByText('Sections').closest('section')!
    fireEvent.click(within(sections).getByRole('button', { name: 'arp' }))
    expect(settings().song.sections[0].toys).toEqual(['drums', 'arp'])
    const moods = screen.getByText('Moods').closest('section')!
    fireEvent.click(within(moods).getByRole('button', { name: '+ add' }))
    expect(Object.keys(settings().moods)).toEqual(['menu', 'mood'])
    rerender(<GameSettings game={settings()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove penalty' }))
    expect(settings().drops).toEqual({})
    fireEvent.click(screen.getByRole('checkbox', { name: 'Stops' }))
    expect(settings().stops).toMatchObject({ tracks: [1, 2], everyBars: 4 })
  })
})
