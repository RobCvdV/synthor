// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { UpdateButton } from './UpdateButton'

function fakeApi(pending: string | null) {
  let notify: (v: string | null) => void = () => {}
  const api = {
    pendingUpdate: vi.fn(async () => pending),
    onUpdateDownloaded: vi.fn((listener: (v: string | null) => void) => { notify = listener; return () => {} }),
    installUpdate: vi.fn(async () => true),
  }
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = api
  return { api, notify: (v: string | null) => act(() => notify(v)) }
}

afterEach(() => { delete (window as unknown as { electronAPI?: unknown }).electronAPI })

describe('UpdateButton', () => {
  it('renders nothing in the browser', () => {
    const { container } = render(<UpdateButton />)
    expect(container.innerHTML).toBe('')
  })

  it('shows an update downloaded before or after it mounted, and installs on click', async () => {
    const { api, notify } = fakeApi('0.1.5')
    const { container } = render(<UpdateButton />)
    expect(await screen.findByText('⬆ Update v0.1.5')).toBeTruthy()
    expect(container.innerHTML).toMatchSnapshot()
    notify('0.1.6')
    fireEvent.click(screen.getByText('⬆ Update v0.1.6'))
    expect(api.installUpdate).toHaveBeenCalled()
    notify(null)
    expect(container.innerHTML).toBe('')
  })
})
