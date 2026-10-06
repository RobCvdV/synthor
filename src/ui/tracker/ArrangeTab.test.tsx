// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { ArrangeTab } from './ArrangeTab'
import { resetStores } from '../test/testUtils'
import { useAppStore } from '../../state/appStore'
import { useAudioStore } from '../../state/audioStore'
import { useDocStore } from '../../state/docStore'
import { useTransportStore } from '../../state/transportStore'

/** The default section gets a second pattern and then the first one again: [p1, p2, p1]. */
function setup() {
  const store = useDocStore.getState()
  const sectionId = store.doc.sectionIds[0]
  const p1 = store.doc.patternId
  const p2 = store.addPattern('Second')
  store.addPatternToSection(sectionId, p2)
  store.addPatternToSection(sectionId, p1)
  store.setCurrentPattern(p1)
  const view = render(<ArrangeTab doc={useDocStore.getState().doc} />)
  const rerender = () => view.rerender(<ArrangeTab doc={useDocStore.getState().doc} />)
  const steps = () => [...view.container.querySelectorAll('.arrange-section .arrange-pattern-item[data-pat-id]')]
  return { sectionId, p1, p2, view, rerender, steps }
}

const classesOf = (els: Element[], cls: string) => els.map((el) => el.classList.contains(cls))

describe('ArrangeTab', () => {
  beforeEach(() => resetStores())

  it('marks the current step, telling repeats of a pattern apart', () => {
    const { sectionId, rerender, steps, view } = setup()
    expect(classesOf(steps(), 'current')).toEqual([true, false, false])
    act(() => useAppStore.getState().setCurrentStep({ sectionId, step: 2 }))
    rerender()
    expect(classesOf(steps(), 'current')).toEqual([false, false, true])
    expect(view.container.innerHTML.replace(/[a-z]+_[0-9a-f-]{36}/g, '<id>')).toMatchSnapshot()
  })

  it('clicking a step makes it current and shows its pattern', () => {
    const { sectionId, p2, steps } = setup()
    fireEvent.click(steps()[1])
    expect(useAppStore.getState().currentStep).toEqual({ sectionId, step: 1 })
    expect(useDocStore.getState().doc.patternId).toBe(p2)
  })

  it('marks the playing section and step in section mode', () => {
    const { rerender, steps, view } = setup()
    const len = useDocStore.getState().doc.entities.patterns[useDocStore.getState().doc.patternId].length
    act(() => {
      useAppStore.setState({ playMode: 'section' })
      useTransportStore.setState({ playing: true, currentRow: len * 2 + 1 })
      useAudioStore.setState({ playbackStarted: true })
    })
    rerender()
    expect(classesOf(steps(), 'playing')).toEqual([false, false, true])
    expect(view.container.querySelector('.arrange-section')?.classList.contains('playing')).toBe(true)
    expect(steps()[2].querySelector('.arrange-pattern-num')?.textContent).toBe('▶')
  })

  it('offers make-unique on repeated patterns only', () => {
    const { sectionId, p1, steps } = setup()
    expect(steps().map((el) => el.querySelector('.arrange-unique-btn') !== null)).toEqual([true, false, true])
    fireEvent.click(steps()[2].querySelector('.arrange-unique-btn')!)
    const ids = useDocStore.getState().doc.entities.sections[sectionId].patternIds
    expect(ids[0]).toBe(p1)
    expect(ids[2]).not.toBe(p1)
    expect(useAppStore.getState().currentStep).toEqual({ sectionId, step: 2 })
  })
})
