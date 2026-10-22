// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

let broken = true
function Fragile({ label }: { label: string }) {
  if (broken) throw new Error('Cannot read properties of undefined')
  return <p>{label}</p>
}

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows the error instead of blanking, and recovers on Try Again or a new view', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    broken = true
    const { container, rerender } = render(<ErrorBoundary resetKey="instruments"><Fragile label="kit" /></ErrorBoundary>)
    expect(container.innerHTML).toMatchSnapshot()

    broken = false
    fireEvent.click(screen.getByText('Try Again'))
    expect(screen.getByText('kit')).toBeTruthy()

    broken = true
    rerender(<ErrorBoundary resetKey="instruments"><Fragile label="other" /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeTruthy()
    broken = false
    rerender(<ErrorBoundary resetKey="tracker"><Fragile label="tracker" /></ErrorBoundary>)
    expect(screen.getByText('tracker')).toBeTruthy()
  })
})
