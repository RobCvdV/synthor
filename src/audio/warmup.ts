import type { AudioHost } from './host'
import { useAudioStore } from '../state/audioStore'

/** Arm the audio host on the first user interaction (autoplay policy): any
 *  pointerdown/keydown starts AudioContext + Elementary WASM + the silent
 *  graph render in the background, so the first play press finds a warm
 *  graph. One-shot; play call sites also call host.start() (idempotent). */
export function installWarmup(host: AudioHost): () => void {
  const arm = () => {
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('keydown', onKeyDown, true)
    if (host.isReady) return
    useAudioStore.getState().setStatus('warming')
    void host.start().catch((err: unknown) => {
      // Never hard-lock the UI on a failed context (e.g. no audio device).
      console.error('[warmup] host start failed:', err)
      useAudioStore.getState().setStatus('ready')
    })
  }
  const onPointerDown = () => arm()
  const onKeyDown = () => arm()
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('keydown', onKeyDown, true)
  }
}
