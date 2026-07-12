/**
 * Debounced, coalescing autosaver — the timing brain behind autosave, kept
 * free of React and storage so it can be unit-tested with fake timers.
 *
 * Contract:
 *  - `schedule()` (re)arms a timer; rapid edits collapse into one save.
 *  - When the timer fires (or `flush()` is called) the injected `save` runs.
 *  - Only one save runs at a time. Edits arriving mid-save set a "dirty" flag
 *    so exactly one more save runs afterwards — no lost edits, no pile-up.
 *
 * Why timing, not play-state, is the lever: the doc is small and the write is
 * async off the audio thread, so saving during playback is safe. We debounce
 * to avoid thrashing storage on every keystroke, and `flush()` on stop / tab
 * hide / unload guarantees the last edit lands.
 */
export interface AutosaverOptions {
  /** Quiet period after the last `schedule()` before saving. */
  delayMs: number
  /** The actual persistence. Errors are swallowed by `onError` if provided. */
  save: () => void | Promise<void>
  /** Optional hooks for surfacing status to the UI. */
  onSaveStart?: () => void
  onSaveEnd?: () => void
  onError?: (err: unknown) => void
}

export class Autosaver {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  /** An edit arrived while a save was in flight → run once more when it ends. */
  private dirtyAgain = false
  private disposed = false

  constructor(private readonly opts: AutosaverOptions) {}

  /** Arm/re-arm the debounce timer for a pending save. */
  schedule(): void {
    if (this.disposed) return
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, this.opts.delayMs)
  }

  /** Cancel any pending timer and save immediately (if anything is pending). */
  async flush(): Promise<void> {
    if (this.disposed) return
    const wasPending = this.timer !== null
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    // Flush should also complete an in-flight save's follow-up work.
    if (wasPending || this.running) await this.run()
  }

  /** Drop any pending save without running it. */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.dirtyAgain = false
  }

  /** Tear down; no further saves will be scheduled or run. */
  dispose(): void {
    this.cancel()
    this.disposed = true
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.dirtyAgain = true
      return
    }
    this.running = true
    try {
      do {
        this.dirtyAgain = false
        this.opts.onSaveStart?.()
        try {
          await this.opts.save()
        } catch (err) {
          this.opts.onError?.(err)
        } finally {
          this.opts.onSaveEnd?.()
        }
      } while (this.dirtyAgain && !this.disposed)
    } finally {
      this.running = false
    }
  }
}
