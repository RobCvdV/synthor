// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Legend } from './Legend'

describe('Legend', () => {
  it('lists the tracker shortcuts by group', () => {
    const { container, getByText } = render(<Legend />)
    expect(getByText('transpose selection (else track) ±1')).toBeTruthy()
    expect(container).toMatchSnapshot()
  })
})
