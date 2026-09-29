// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TempoControl } from './TempoControl'
import { resetStores } from './test/testUtils'
import { useTransportStore } from '../state/transportStore'

function typeBpm(text: string) {
  fireEvent.doubleClick(screen.getByText('120'))
  const input = screen.getByDisplayValue('120')
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('TempoControl', () => {
  beforeEach(resetStores)

  it('sets a typed tempo', () => {
    render(<TempoControl />)
    typeBpm('96')
    expect(useTransportStore.getState().bpm).toBe(96)
  })

  it('ignores a tempo outside 20–300', () => {
    render(<TempoControl />)
    typeBpm('500')
    expect(useTransportStore.getState().bpm).toBe(120)
  })

  it('sets the tempo from taps', () => {
    const now = vi.spyOn(performance, 'now')
    render(<TempoControl />)
    for (const t of [0, 400, 800]) {
      now.mockReturnValue(t)
      fireEvent.click(screen.getByText('TAP'))
    }
    expect(useTransportStore.getState().bpm).toBe(150)
    now.mockRestore()
  })
})
