import { describe, expect, it } from 'vitest'
import { fitToLength, pointerDown, pointerMove, pointerUp, type Press } from './selectionGestures'

const press = (p: Partial<Press>): Press =>
  ({ frame: 0, x: 0, scroll: 0, px: 1, sel: null, cursor: null, mod: false, shift: false, ...p })

describe('selectionGestures', () => {
  it('starts a new selection and a click without a drag only places the cursor', () => {
    const down = pointerDown(press({ frame: 40, x: 40 }))
    expect(down).toEqual({ sel: { start: 40, end: 40 }, cursor: 40, drag: { mode: 'select', anchor: 40 } })
    expect(pointerUp(down.drag, down.sel)).toBeNull()
  })

  it('drags a new selection either way from where it started', () => {
    const drag = { mode: 'select', anchor: 40 } as const
    expect(pointerMove(drag, 10, null, 40)).toEqual({ sel: { start: 10, end: 40 }, cursor: 10 })
    expect(pointerUp(drag, { start: 10, end: 40 })).toEqual({ start: 10, end: 40 })
  })

  it('grabs a selection edge within reach and keeps the cursor', () => {
    const sel = { start: 100, end: 200 }
    expect(pointerDown(press({ frame: 104, x: 104, sel, cursor: 150 })))
      .toEqual({ sel, cursor: 150, drag: { mode: 'edge-start' } })
    expect(pointerDown(press({ frame: 197, x: 197, sel })).drag).toEqual({ mode: 'edge-end' })
  })

  it('stops a dragged edge at the other edge, collapsing to no selection', () => {
    const sel = { start: 100, end: 200 }
    expect(pointerMove({ mode: 'edge-start' }, 150, sel, 5).sel).toEqual({ start: 150, end: 200 })
    expect(pointerMove({ mode: 'edge-start' }, 300, sel, 5).sel).toBeNull()
    expect(pointerMove({ mode: 'edge-end' }, 50, sel, 5).sel).toBeNull()
  })

  it('moves the nearest edge with Cmd/Ctrl', () => {
    const sel = { start: 100, end: 200 }
    expect(pointerDown(press({ frame: 120, x: 500, sel, mod: true })))
      .toEqual({ sel: { start: 120, end: 200 }, cursor: 120, drag: null })
    expect(pointerDown(press({ frame: 260, x: 500, sel, mod: true })).sel).toEqual({ start: 100, end: 260 })
  })

  it('extends from the cursor with Shift, then keeps dragging the end', () => {
    expect(pointerDown(press({ frame: 80, x: 80, cursor: 20, shift: true })))
      .toEqual({ sel: { start: 20, end: 80 }, cursor: 80, drag: { mode: 'edge-end' } })
    expect(pointerDown(press({ frame: 10, x: 10, sel: { start: 20, end: 80 }, shift: true })).sel)
      .toEqual({ start: 10, end: 20 })
  })

  it('fits the selection and cursor to a shorter sample', () => {
    expect(fitToLength({ start: 10, end: 90 }, 95, 50)).toEqual({ sel: { start: 10, end: 50 }, cursor: 50 })
    expect(fitToLength({ start: 60, end: 90 }, null, 50)).toEqual({ sel: null, cursor: null })
  })
})
