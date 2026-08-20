import { beforeEach, describe, expect, it } from 'vitest'
import { useAudioStore } from './audioStore'

/** Call before each test to reset the store to defaults. */
function resetStore() {
  useAudioStore.setState({
    status: 'idle',
    playbackStarted: false,
  })
}

describe('audioStore', () => {
  beforeEach(resetStore)

  it('starts idle with playback not started', () => {
    const s = useAudioStore.getState()
    expect(s.status).toBe('idle')
    expect(s.playbackStarted).toBe(false)
  })

  it('setStatus moves idle → warming → ready', () => {
    const store = useAudioStore.getState()
    store.setStatus('warming')
    expect(useAudioStore.getState().status).toBe('warming')
    store.setStatus('ready')
    expect(useAudioStore.getState().status).toBe('ready')
  })

  it('a new sample sync re-warms after ready', () => {
    useAudioStore.getState().setStatus('ready')
    useAudioStore.getState().setStatus('warming')
    expect(useAudioStore.getState().status).toBe('warming')
  })

  it('setPlaybackStarted toggles', () => {
    useAudioStore.getState().setPlaybackStarted(true)
    expect(useAudioStore.getState().playbackStarted).toBe(true)
    useAudioStore.getState().setPlaybackStarted(false)
    expect(useAudioStore.getState().playbackStarted).toBe(false)
  })
})
