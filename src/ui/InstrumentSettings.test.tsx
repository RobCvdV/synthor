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

  it('offers Save to Library only when a handler is given', () => {
    const synth = firstOfKind('modular')
    expect(renderFor(synth).queryByText('Save to Library')).toBeNull()
    let saved = 0
    const { getAllByText } = render(<InstrumentSettings inst={synth} usage={0} onDuplicate={noop} onExport={noop}
      onSaveToLibrary={() => saved++} onDelete={noop} />)
    fireEvent.click(getAllByText('Save to Library')[0])
    expect(saved).toBe(1)
  })

  it('edits the category and tags the instrument keeps in the song', () => {
    const synth = firstOfKind('modular')
    const { getByLabelText, getByText } = renderFor(synth)
    fireEvent.change(getByLabelText('Category'), { target: { value: 'Leads' } })
    fireEvent.blur(getByLabelText('Category'))
    fireEvent.change(getByLabelText('Add tag'), { target: { value: 'bright' } })
    fireEvent.keyDown(getByLabelText('Add tag'), { key: 'Enter' })
    expect(useDocStore.getState().doc.entities.instruments[synth.id].library).toEqual({ category: 'Leads', tags: ['bright'] })
    expect(getByText(/^Synth/).textContent).toBe('Synth')
  })
})
