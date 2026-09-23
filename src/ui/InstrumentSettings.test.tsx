// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { InstrumentSettings } from './InstrumentSettings'
import { useDocStore } from '../state/docStore'
import { resetStores } from './test/testUtils'
import type { Instrument, ModularInstrument } from '../domain/types'

const noop = () => {}

function renderFor(inst: Instrument) {
  return render(<InstrumentSettings inst={inst} usage={0} onDuplicate={noop} onExport={noop} onDelete={noop} />)
}

function firstOfKind(kind: Instrument['kind']): Instrument {
  return Object.values(useDocStore.getState().doc.entities.instruments).find((i) => i.kind === kind)!
}

describe('InstrumentSettings', () => {
  beforeEach(resetStores)

  it('renders a synth with the live voices setting', () => {
    const { container } = renderFor(firstOfKind('modular'))
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('changing live voices updates the instrument', () => {
    const synth = firstOfKind('modular')
    const { getByTitle } = renderFor(synth)
    const select = getByTitle(/Polyphony/).nextElementSibling as HTMLSelectElement
    fireEvent.change(select, { target: { value: '2' } })
    expect((useDocStore.getState().doc.entities.instruments[synth.id] as ModularInstrument).voices).toBe(2)
  })

  it('has no live voices setting for a drum kit', () => {
    const { queryByText } = renderFor(firstOfKind('drumkit'))
    expect(queryByText('Live Voices')).toBeNull()
  })
})
