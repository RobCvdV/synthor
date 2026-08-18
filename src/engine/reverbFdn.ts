/**
 * Jot-style Feedback Delay Network reverb — a port of elemaudio/srvb
 * (github.com/elemaudio/srvb, dsp/srvb.js), tuned tighter than the original:
 * shorter diffusion stages, a shorter pre-spread FDN (srvb's d4 with 8 ms
 * line base instead of 17) and shorter main-FDN lines (12 ms base). Eight
 * delay lines mixed through an orthogonal Hadamard matrix, one-pole damping
 * inside the loop, three diffusion stages and ±2.5 ms chorus on every read
 * position.
 *
 * Buffer sizes are compile-time constants computed for 44.1 kHz, matching the
 * other static delay buffers in the codebase; the resulting timing error at
 * other host rates is a few percent and inaudible for reverb.
 */

import { el, type NodeRepr_t } from '@elemaudio/core'
import type { StereoOut } from './modular'

type Node = NodeRepr_t | number

const SR = 44100
const ms2samps = (ms: number): number => (SR * ms) / 1000

// 8×8 Hadamard, scaled by √(1/8). H·Hᵀ = 8I makes every mix stage orthogonal
// (energy-preserving), so the feedback path can never run away.
const H8 = [
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, -1, 1, -1, 1, -1, 1, -1],
  [1, 1, -1, -1, 1, 1, -1, -1],
  [1, -1, -1, 1, 1, -1, -1, 1],
  [1, 1, 1, 1, -1, -1, -1, -1],
  [1, -1, 1, -1, -1, 1, -1, 1],
  [1, 1, -1, -1, -1, -1, 1, 1],
  [1, -1, -1, 1, -1, 1, 1, -1],
].map((row) => row.map((c) => c * Math.sqrt(1 / 8)))

/** One diffusion stage: eight static delays of length size·(i+1)/8, then one H8 mix. */
function diffuse(scope: string, stage: string, sizeSamps: number, ins: Node[]): NodeRepr_t[] {
  const dels = ins.map((input, i) =>
    el.sdelay({ key: `${scope}:${stage}:s${i}`, size: sizeSamps * ((i + 1) / 8) }, input),
  )
  return H8.map((row) => el.add(...row.map((c, j) => el.mul(c, dels[j]))))
}

/** An eight-line feedback delay network with in-loop one-pole damping.
 *  `name` scopes the tap pairs; `size`, `decay` and `pole` are live refs. */
function dampFdn(
  scope: string,
  name: string,
  size: Node,
  decay: Node,
  pole: Node,
  baseMs: number,
  ins: Node[],
): NodeRepr_t[] {
  const dels = ins.map((input, i) =>
    el.add(input, el.mul(decay, el.smooth(pole, el.tapIn({ name: `${scope}:${name}:fdn${i}` })))),
  )
  const mixed = H8.map((row) => el.add(...row.map((c, j) => el.mul(c, dels[j]))))
  return mixed.map((mm, i) => {
    // Line time (i+1)·baseMs scaled 1..4× by room size — a live signal.
    const delaySize = el.mul(el.add(1, el.mul(3, size)), ms2samps((i + 1) * baseMs))
    // ±2.5 ms chorus (rate 0.1 + i·0.01 Hz) keeps the modes from ringing statically.
    const readPos = el.add(delaySize, el.mul(ms2samps(2.5), el.cycle(0.1 + i * 0.01)))
    return el.tapOut(
      { name: `${scope}:${name}:fdn${i}` },
      el.delay({ key: `${scope}:${name}:d${i}`, size: ms2samps(750) }, readPos, 0, mm),
    )
  })
}

/**
 * Build the FDN reverb stereo pair (wet/dry mixed via `mix`).
 * `scope` must be unique per effect instance — it keys every delay and tap.
 *
 * Param mapping (keeps the old reverb def's keys compatible):
 *   roomSize    → delay-time multiplier 1 + 3·size
 *   feedback    → decay of the FDN
 *   damping     → one-pole pole 0.25 + damping·0.6 (≈19 kHz..1.2 kHz per
 *                 traversal; srvb's fixed 0.105 is ~60 kHz — essentially off)
 *   stereoWidth → downmix width: 0 = mono wet, 1 = natural stereo (the FDN
 *                 lines decorrelate, so this works even for a mono input)
 *   mix         → dry/wet select
 */
export function makeFdnReverb(
  scope: string,
  roomSize: Node,
  feedback: Node,
  damping: Node,
  stereoWidth: Node,
  mix: Node,
  xl: Node,
  xr: Node,
): StereoOut {
  const pole = el.add(0.25, el.mul(damping, 0.6))

  // Upmix to eight channels: L, R, mid, side, and their negations.
  const mid = el.mul(0.5, el.add(xl, xr))
  const side = el.mul(0.5, el.sub(xl, xr))
  const four = [xl, xr, mid, side]
  const eight = [...four, ...four.map((x) => el.mul(-1, x))]

  const d1 = diffuse(scope, 'd1', ms2samps(14), eight)
  const d2 = diffuse(scope, 'd2', ms2samps(35), d1)
  const d3 = diffuse(scope, 'd3', ms2samps(52), d2)

  // Short pre-spread FDN (srvb's d4, scaled down): decorrelates the r0
  // inputs. Without it, every r0 line carries a near-identical copy of the
  // input and the interleaved downmix reads as a ping-pong echo train at
  // large room sizes.
  const d4 = dampFdn(scope, 'd4', roomSize, 0.004, pole, 8, d3)
  const r0 = dampFdn(scope, 'r0', roomSize, feedback, pole, 12, d4)

  // Interleave the downmix: line length correlates with index, so summing
  // 0-3/4-7 would build left energy before right (srvb note).
  const yl = el.mul(0.25, el.add(r0[0], r0[2], r0[4], r0[6]))
  const yr = el.mul(0.25, el.add(r0[1], r0[3], r0[5], r0[7]))

  // Width at the downmix: mid/side of the decorrelated FDN outputs, so the
  // knob sweeps mono wet → natural stereo for any input, mono or not.
  const wetMid = el.mul(0.5, el.add(yl, yr))
  const wetSide = el.mul(0.5, el.sub(yl, yr))

  // Dry passes at full level; mix scales only the wet, so the first sound
  // isn't attenuated while the network charges.
  return {
    left: el.add(xl, el.mul(mix, el.add(wetMid, el.mul(stereoWidth, wetSide)))),
    right: el.add(xr, el.mul(mix, el.sub(wetMid, el.mul(stereoWidth, wetSide)))),
  }
}
