// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EditorToolbar, type EditorActions } from './EditorToolbar'

function actions(): EditorActions {
  const names = ['play', 'copy', 'cut', 'paste', 'insert', 'replace', 'reverse', 'snap', 'process', 'makeCycle', 'toggleDraw', 'saveAs',
    'exportFile', 'zoomOut', 'zoomIn', 'zoomSel', 'zoomFit', 'close'] as const
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as unknown as EditorActions
}

const enabled = () => screen.getAllByRole('button').filter((b) => !(b as HTMLButtonElement).disabled).map((b) => b.textContent)

describe('EditorToolbar', () => {
  it('enables only view controls while the sample is not ready', () => {
    const { container } = render(<EditorToolbar ready={false} hasSel={false} hasClip={false} actions={actions()} />)
    expect(enabled()).toEqual(['zoom −', 'zoom +', 'zoom fit', 'Close ×'])
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('enables selection edits with a selection, and paste edits with a clip', () => {
    render(<EditorToolbar ready hasSel hasClip={false} actions={actions()} />)
    expect(enabled()).toContain('Reverse')
    expect(enabled()).not.toContain('Paste')
  })

  it('starts the fade process that was clicked, also without a selection', () => {
    const a = actions()
    render(<EditorToolbar ready hasSel={false} hasClip actions={a} />)
    fireEvent.click(screen.getByText('Fade Out…'))
    expect(a.process).toHaveBeenCalledWith('fadeOut')
  })
})

describe('EditorToolbar processing', () => {
  it('offers no Pitch for cycle material', () => {
    render(<EditorToolbar ready hasSel={false} hasClip={false} cycles actions={actions()} />)
    expect((screen.getByText('Pitch… (not for cycles)') as HTMLOptionElement).disabled).toBe(true)
  })

  it('keeps only playing and viewing while a live process is tuned', () => {
    render(<EditorToolbar ready hasSel hasClip processing actions={actions()} />)
    expect(enabled()).toEqual(['▶ Play', 'zoom −', 'zoom +', 'zoom sel', 'zoom fit', 'Close ×'])
  })

  it('offers only whole-sample processing without a selection', () => {
    const a = actions()
    render(<EditorToolbar ready hasSel={false} hasClip={false} actions={a} />)
    const options = screen.getAllByRole('option').filter((o) => !(o as HTMLOptionElement).disabled).map((o) => o.textContent)
    expect(options).toEqual(['Process…', 'Normalize', 'Remove DC offset', 'Pitch…', 'Smooth…', 'Drive…', 'Crush…'])
    fireEvent.change(screen.getByLabelText('Process'), { target: { value: 'normalize' } })
    expect(a.process).toHaveBeenCalledWith('normalize')
    fireEvent.click(screen.getByText('Make Cycle…'))
    expect(a.makeCycle).toHaveBeenCalled()
  })
})
