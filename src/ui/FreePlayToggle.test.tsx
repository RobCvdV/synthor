// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { FreePlayToggle } from './FreePlayToggle'
import { useAppStore } from '../state/appStore'
import { resetStores } from './test/testUtils'

describe('FreePlayToggle', () => {
  beforeEach(resetStores)

  it('renders the on state', () => {
    const { container } = render(<FreePlayToggle />)
    expect(container.innerHTML).toMatchSnapshot()
  })

  it('toggles free play in the app store', () => {
    const { getByRole } = render(<FreePlayToggle />)
    const btn = getByRole('button')
    fireEvent.click(btn)
    expect(useAppStore.getState().freePlay).toBe(false)
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(btn).not.toHaveClass('active')
  })
})
