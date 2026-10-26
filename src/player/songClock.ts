/**
 * The song position between txSeq row events, for visuals in time with the music.
 * Rows advance at a known rate on the audio clock, but events arrive a few ms
 * late and only name the whole row. So the moments the row *changes* pin down
 * where row boundaries fall: each change bounds the true phase from below, and
 * the highest recent bound is the estimate. Pure.
 */

export interface SongClock {
  /** Rows per second. */
  rate: number
  /** position(t) = rate * t + anchor, in the numbering of the latest event's row. */
  anchor: number | null
  /** Phases (row − rate · t) of recent row changes, newest last. */
  samples: number[]
  lastRow: number | null
}

/** Row changes kept for the estimate (~4 s at 8 rows/s); the audio clock has no drift to follow. */
const MAX_SAMPLES = 32

export function createClock(rate: number): SongClock {
  return { rate, anchor: null, samples: [], lastRow: null }
}

/** Distance from `b` to `a` on the unit circle, in [−0.5, 0.5). */
const wrapDev = (a: number, b: number) => ((((a - b) % 1) + 1.5) % 1) - 0.5

/** A txSeq row event: `row` as numbered by the event, seen at audio time `t` (s). */
export function observeRow(clock: SongClock, row: number, t: number): SongClock {
  const { rate, lastRow, anchor } = clock
  if (row === lastRow) return clock
  if (anchor === null || lastRow === null) {
    // No phase yet: assume mid-row until the first row change.
    return { ...clock, anchor: row + 0.5 - rate * t, lastRow: row }
  }

  // The next row, or a wrap / hand-over onto a cue's top: a row boundary was just crossed.
  if (row === lastRow + 1 || row === 0) {
    const p = row - rate * t
    const samples = [...clock.samples.slice(1 - MAX_SAMPLES), p]
    const lift = Math.max(...samples.map((s) => wrapDev(s, p)))
    return { ...clock, anchor: p + lift, samples, lastRow: row }
  }

  // A jump without a boundary ('sync' cue): renumber, keep the phase within the row.
  const x = rate * t + anchor
  return { ...clock, anchor: row + (x - Math.floor(x)) - rate * t, lastRow: row }
}

/** The (unwrapped) row at audio time `t`, or null before the first event. */
export function clockRow(clock: SongClock, t: number): number | null {
  return clock.anchor === null ? null : clock.rate * t + clock.anchor
}

/** A tempo change at audio time `t`: the position carries on, the phase samples restart. */
export function setClockRate(clock: SongClock, rate: number, t: number): SongClock {
  const row = clockRow(clock, t)
  return { rate, anchor: row === null ? null : row - rate * t, samples: [], lastRow: clock.lastRow }
}

export interface MusicalTime {
  row: number
  /** Beats since the cue's top (fractional). */
  beat: number
  beatPhase: number
  /** Beat within the bar, 0-based. */
  beatInBar: number
  bar: number
  barPhase: number
}

/** Beats and bars at a (fractional) row within a cue. */
export function musicalTime(row: number, linesPerBeat: number, beatsPerBar: number): MusicalTime {
  const beat = row / linesPerBeat
  const bars = beat / beatsPerBar
  return {
    row,
    beat,
    beatPhase: beat - Math.floor(beat),
    beatInBar: Math.floor(beat) % beatsPerBar,
    bar: Math.floor(bars),
    barPhase: bars - Math.floor(bars),
  }
}

/**
 * Seconds to wait before sending a note so it is heard on the next grid
 * point: `until` (s, as heard) to the next one, `latency` (s) from sending to
 * hearing, `period` (s) between grid points. A point closer than the latency
 * is missed, so the note goes to the first one still reachable.
 */
export function sendDelay(until: number, latency: number, period: number): number {
  let d = until - latency
  if (period > 0) while (d < 0) d += period
  return Math.max(0, d)
}
