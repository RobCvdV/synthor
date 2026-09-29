// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EditorToolbar, type EditorActions } from './EditorToolbar'

function actions(): EditorActions {
  const names = ['play', 'copy', 'cut', 'paste', 'insert', 'replace', 'reverse', 'openDialog', 'saveAs',
    'exportFile', 'zoomOut', 'zoomIn', 'zoomFit', 'close'] as const
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

  it('opens the fade dialog kind that was clicked', () => {
    const a = actions()
    render(<EditorToolbar ready hasSel hasClip actions={a} />)
    fireEvent.click(screen.getByText('Fade Out…'))
    expect(a.openDialog).toHaveBeenCalledWith('fadeOut')
  })
})
