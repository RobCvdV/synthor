// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { UpdateStatus } from '../persist/electronBridge'
import { UpdateButton } from './UpdateButton'

function fakeApi(current: UpdateStatus, installs = true) {
  let notify: (s: UpdateStatus) => void = () => {}
  const api = {
    updateStatus: vi.fn(async () => current),
    onUpdateStatus: vi.fn((listener: (s: UpdateStatus) => void) => { notify = listener; return () => {} }),
    installUpdate: vi.fn(async () => installs),
  }
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = api
  return { api, notify: (s: UpdateStatus) => act(() => notify(s)) }
}

afterEach(() => { delete (window as unknown as { electronAPI?: unknown }).electronAPI })

describe('UpdateButton', () => {
  it('renders nothing in the browser', () => {
    const { container } = render(<UpdateButton />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the download progress, then installs the ready update on click', async () => {
    const { api, notify } = fakeApi({ state: 'downloading', version: '0.1.5', percent: 0 })
    const { container } = render(<UpdateButton />)
    expect(await screen.findByText('⬇ v0.1.5 0%')).toBeTruthy()
    notify({ state: 'downloading', version: '0.1.5', percent: 63 })
    expect(container.innerHTML).toMatchSnapshot()
    notify({ state: 'ready', version: '0.1.5' })
    expect(container.innerHTML).toMatchSnapshot()
    await act(async () => { fireEvent.click(screen.getByText('⬆ Install v0.1.5')) })
    expect(api.installUpdate).toHaveBeenCalled()
    expect(screen.getByText('Installing…')).toBeTruthy()
    notify(null)
    expect(container.innerHTML).toBe('')
  })

  it('offers the button again when installing was refused (a newer update superseded it)', async () => {
    fakeApi({ state: 'ready', version: '0.1.5' }, false)
    render(<UpdateButton />)
    const button = await screen.findByText('⬆ Install v0.1.5')
    await act(async () => { fireEvent.click(button) })
    expect(screen.getByText('⬆ Install v0.1.5')).toBeTruthy()
  })
})
