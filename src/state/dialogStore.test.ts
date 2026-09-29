import { beforeEach, describe, expect, it } from 'vitest'
import { askConfirm, askText, useDialogStore } from './dialogStore'

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

  it('cancels a pending dialog when a new one arrives', async () => {
    const confirm = askConfirm({ message: 'One' })
    const text = askText({ message: 'Two', defaultValue: '' })
    await expect(confirm).resolves.toBe(false)
    askConfirm({ message: 'Three' })
    await expect(text).resolves.toBeNull()
  })
})
