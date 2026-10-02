// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MakeCycleDialog } from './MakeCycleDialog'

const SR = 48000
const tone = (hz: number) => [Float32Array.from({ length: 6000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * hz * i / SR))]

function setup(pcm = tone(240)) {
  const props = { onPreview: vi.fn(), onSave: vi.fn(), onClose: vi.fn() }
  const view = render(<MakeCycleDialog pcm={pcm} range={{ start: 0, end: 6000 }} sampleRate={SR}
    defaultName="Voice cycle" busy={false} {...props} />)
  return { ...props, ...view }
}

describe('MakeCycleDialog', () => {
  it('shows the detected pitch and saves a cycle of the chosen length', () => {
    const { onSave, container } = setup()
    expect(screen.getByText(/Detected 240\.0 Hz · B-3 -49 ct · 200\.0 frames/)).toBeInTheDocument()
    expect(container.innerHTML).toMatchSnapshot()
    fireEvent.change(screen.getByDisplayValue('2048 frames'), { target: { value: '512' } })
    fireEvent.click(screen.getByText('Save as Sample'))
    const [name, cycle] = onSave.mock.calls[0]
    expect(name).toBe('Voice cycle')
    expect(cycle[0]).toHaveLength(512)
  })

  it('previews one second of the cycle at the detected pitch', () => {
    const { onPreview } = setup()
    fireEvent.click(screen.getByText('▶ Preview'))
    expect(onPreview.mock.calls[0][0][0]).toHaveLength(SR)
  })

  it('falls back to the whole selection for unpitched audio', () => {
    setup([new Float32Array(6000)])
    expect(screen.getByText('No clear pitch in the selection.')).toBeInTheDocument()
    expect(screen.getByDisplayValue('The whole selection')).toBeDisabled()
  })
})
