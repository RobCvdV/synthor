/** Human-readable duration; sub-second values render in ms. */
export function formatDuration(sampleRate: number, frames: number, digits = 2): string {
  const secs = frames / sampleRate
  if (secs < 1) return `${Math.round(secs * 1000)}ms`
  return `${secs.toFixed(digits)}s`
}

/** Approximate PCM byte size of a sample buffer. */
export function formatSize(frames: number, channels: number): string {
  const bytes = frames * channels * 4
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Autosave status label for the store tab. */
export function saveLabel(status: string, lastSavedAt: string | null): string {
  if (status === 'saving') return 'Saving…'
  if (status === 'error') return '⚠ Save failed'
  if (status === 'dirty') return 'Unsaved'
  if (lastSavedAt) return `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
  return 'Not saved yet'
}
