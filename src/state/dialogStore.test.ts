import { beforeEach, describe, expect, it } from 'vitest'
import { askConfirm, askRange, askText, useDialogStore } from './dialogStore'

describe('dialogStore', () => {
  beforeEach(() => useDialogStore.setState({ request: null, resolve: null }))

  it('resolves a confirm with the answer and clears the request', async () => {
    const pending = askConfirm({ message: 'Delete?' })
    expect(useDialogStore.getState().request).toMatchObject({ kind: 'confirm', message: 'Delete?' })
    useDialogStore.getState().answer(true)
    await expect(pending).resolves.toBe(true)
    expect(useDialogStore.getState().request).toBeNull()
  })

  it('resolves a text prompt with the entered value', async () => {
    const pending = askText({ message: 'Name?', defaultValue: 'Untitled' })
    expect(useDialogStore.getState().request).toMatchObject({ kind: 'text', defaultValue: 'Untitled' })
    useDialogStore.getState().answer('Groove')
    await expect(pending).resolves.toBe('Groove')
  })

  it('resolves a range prompt with both values, or null when cancelled', async () => {
    const pending = askRange({ message: 'Interpolate', start: '00', end: '' })
    expect(useDialogStore.getState().request).toMatchObject({ kind: 'range', start: '00', end: '' })
    useDialogStore.getState().answer({ start: 0, end: 1 })
    await expect(pending).resolves.toEqual({ start: 0, end: 1 })

    const cancelled = askRange({ message: 'Interpolate', start: '', end: '' })
    useDialogStore.getState().answer(null)
    await expect(cancelled).resolves.toBeNull()
  })

  it('cancels a pending dialog when a new one arrives', async () => {
    const confirm = askConfirm({ message: 'One' })
    const text = askText({ message: 'Two', defaultValue: '' })
    await expect(confirm).resolves.toBe(false)
    askConfirm({ message: 'Three' })
    await expect(text).resolves.toBeNull()
  })
})
