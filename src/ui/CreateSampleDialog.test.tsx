// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateSampleDialog } from './CreateSampleDialog'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { resetStores } from './test/testUtils'

vi.mock('../persist/sampleStorage', () => ({ writeSampleData: vi.fn(async () => {}) }))

describe('CreateSampleDialog', () => {
  beforeEach(() => {
    resetStores()
    useProjectStore.setState({ slug: 'song' })
  })

  it('creates a single cycle of the chosen length, named after the shape', async () => {
    const onCreated = vi.fn()
    const { container } = render(<CreateSampleDialog onClose={() => {}} onCreated={onCreated} />)
    expect(container.innerHTML).toMatchSnapshot()
    fireEvent.change(container.querySelector('select')!, { target: { value: 'saw' } })
    fireEvent.change(screen.getByDisplayValue('2048 frames'), { target: { value: '512' } })
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    const sample = useDocStore.getState().doc.entities.samples[onCreated.mock.calls[0][0]]
    expect(sample).toMatchObject({ name: 'saw', frames: 512, channels: 1, sampleRate: 48000 })
  })
})
