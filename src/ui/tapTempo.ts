const RESET_AFTER_MS = 2000
const MAX_TAPS = 8

/** Adds a tap at `now`; the BPM averages the recent taps and needs at least two. */
export function tapTempo(times: number[], now: number): { times: number[]; bpm: number | null } {
  const recent = times.length && now - times[times.length - 1] > RESET_AFTER_MS ? [] : times
  const next = [...recent, now].slice(-MAX_TAPS)
  if (next.length < 2) return { times: next, bpm: null }
  const avgInterval = (next[next.length - 1] - next[0]) / (next.length - 1)
  return { times: next, bpm: Math.max(20, Math.min(300, Math.round(60000 / avgInterval))) }
}
