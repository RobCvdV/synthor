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
    const onParamCommit = vi.fn()
    render(<EffectCard effect={createChannelEffect('conv')} onToggleBypass={noop} onRemove={noop}
      onParamSilent={noop} onParamCommit={onParamCommit} />)

    const select = screen.getByLabelText('IR Sample') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.text)).toEqual(['Hall', 'Room'])
    fireEvent.change(select, { target: { value: '1' } })
    expect(onParamCommit).toHaveBeenCalledWith('sampleIndex', 1)
  })
})
