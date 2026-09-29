// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EffectCard } from './EffectCard'
import { createChannelEffect, newSampleEntity } from '../../domain/factory'
import { useDocStore } from '../../state/docStore'
import { resetStores } from '../test/testUtils'

const noop = () => {}

describe('EffectCard', () => {
  beforeEach(resetStores)

  it('picks a convolution IR from the name-sorted samples', () => {
    for (const name of ['Room', 'Hall']) useDocStore.getState().addSampleEntity(newSampleEntity(name, name, `${name}.wav`, 48000, 1, 48000))
    const room = Object.values(useDocStore.getState().doc.entities.samples).find((smp) => smp.name === 'Room')!
    const onSampleChange = vi.fn()
    render(<EffectCard effect={{ ...createChannelEffect('conv'), sampleId: room.id }} onToggleBypass={noop} onRemove={noop}
      onParamSilent={noop} onParamCommit={noop} onSampleChange={onSampleChange} />)

    const select = screen.getByLabelText('IR Sample') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.text)).toEqual(['Hall', 'Room'])
    expect(select.value).toBe('1')
    fireEvent.change(select, { target: { value: '0' } })
    const hall = Object.values(useDocStore.getState().doc.entities.samples).find((smp) => smp.name === 'Hall')!
    expect(onSampleChange).toHaveBeenCalledWith(hall.id)
  })

  it('shows a placeholder when the IR sample is missing', () => {
    useDocStore.getState().addSampleEntity(newSampleEntity('Hall', 'Hall', 'Hall.wav', 48000, 1, 48000))
    render(<EffectCard effect={createChannelEffect('conv')} onToggleBypass={noop} onRemove={noop}
      onParamSilent={noop} onParamCommit={noop} onSampleChange={noop} />)
    const select = screen.getByLabelText('IR Sample') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.text)).toEqual(['—', 'Hall'])
  })
})
