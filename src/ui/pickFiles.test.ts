// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pickFiles } from './pickFiles'

function nextInput(): Promise<HTMLInputElement> {
  return new Promise((resolve) => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementationOnce(function (this: HTMLInputElement) {
      resolve(this)
    })
  })
}

describe('pickFiles', () => {
  afterEach(() => vi.restoreAllMocks())

  it('opens a file input with the given options and resolves with the picked files', async () => {
    const opened = nextInput()
    const picked = pickFiles({ accept: 'audio/*', multiple: true })
    const input = await opened
    expect(input.accept).toBe('audio/*')
    expect(input.multiple).toBe(true)

    const file = new File(['x'], 'kick.wav')
    Object.defineProperty(input, 'files', { value: [file] })
    input.dispatchEvent(new Event('change'))
    await expect(picked).resolves.toEqual([file])
  })

  it('resolves with no files on cancel', async () => {
    const opened = nextInput()
    const picked = pickFiles({ accept: '.json' })
    ;(await opened).dispatchEvent(new Event('cancel'))
    await expect(picked).resolves.toEqual([])
  })
})
