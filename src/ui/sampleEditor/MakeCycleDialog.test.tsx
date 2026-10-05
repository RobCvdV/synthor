// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MakeCycleDialog } from './MakeCycleDialog'

const SR = 48000
const tone = (hz: number) => [Float32Array.from({ length: 6000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * hz * i / SR))]

function setup(pcm = tone(240)) {
  const props = { onPreview: vi.fn(), onSave: vi.fn(), onClose: vi.fn() }
  const view = render(<MakeCycleDialog pcm={pcm} range={{ start: 0, end: 6000 }} sampleRate={SR}
    defaultName="Voice" busy={false} {...props} />)
  return { ...props, ...view }
}

describe('MakeCycleDialog', () => {
  it('shows the detected pitch and saves a cycle of the chosen length', () => {
    const { onSave, container } = setup()
    expect(screen.getByText(/Repeats at 240\.0 Hz · B-3 -49 ct · 200\.0 frames/)).toBeInTheDocument()
    expect(container.innerHTML).toMatchSnapshot()
    fireEvent.change(screen.getByDisplayValue('2048 frames'), { target: { value: '512' } })
    fireEvent.click(screen.getByText('Save as Sample'))
    const [name, cycle, length] = onSave.mock.calls[0]
    expect(name).toBe('Voice cycle')
    expect(length).toBe(512)
    expect(cycle[0]).toHaveLength(512)
  })

  it('previews one second of the cycle at the detected pitch', () => {
    const { onPreview } = setup()
    fireEvent.click(screen.getByText('▶ Preview'))
    expect(onPreview.mock.calls[0][0][0]).toHaveLength(SR)
  })

  it('falls back to the whole selection for unpitched audio', () => {
    setup([new Float32Array(6000)])
    expect(screen.getByText(/No repeating pitch/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('The whole selection')).toBeDisabled()
  })
})

describe('MakeCycleDialog wavetables', () => {
  it('saves a table of frames with its cycle length and a wavetable name', () => {
    const { onSave } = setup()
    fireEvent.change(screen.getByDisplayValue('1 (single cycle)'), { target: { value: '8' } })
    fireEvent.change(screen.getByDisplayValue('2048 frames each'), { target: { value: '256' } })
    expect(screen.getByText('Make Wavetable')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Voice wavetable')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Save as Sample'))
    const [name, table, length] = onSave.mock.calls[0]
    expect(name).toBe('Voice wavetable')
    expect(table[0]).toHaveLength(8 * 256)
    expect(length).toBe(256)
  })
})

describe('MakeCycleDialog defaults', () => {
  it('takes a cycle-sized selection whole, and a longer one by its detected period', () => {
    const pcm = tone(240)
    const shortSel = render(<MakeCycleDialog pcm={pcm} range={{ start: 0, end: 600 }} sampleRate={SR}
      defaultName="V" busy={false} onPreview={vi.fn()} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('The whole selection')).toBeInTheDocument()
    expect(screen.getByText(/Selection: 600 frames \(80\.0 Hz as one cycle\)/)).toBeInTheDocument()
    shortSel.unmount()
    const long = Float32Array.from({ length: SR }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 240 * i / SR))
    render(<MakeCycleDialog pcm={[long]} range={{ start: 0, end: SR }} sampleRate={SR}
      defaultName="V" busy={false} onPreview={vi.fn()} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('One detected period')).toBeInTheDocument()
  })
})
