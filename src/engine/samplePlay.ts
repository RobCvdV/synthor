import { el, type NodeRepr_t } from '@elemaudio/core'

/**
 * The one shared sample-playback element: a gate-triggered one-shot on a
 * normalized-index mc.table driven by an edge-reset phase.
 *
 * Unlike Elementary's `sample` / `mc.sample` nodes there is no built-in
 * fade-in and no alternating readers — playback starts deterministically at
 * sample 0 on every rising gate edge, plays to the end, and stays exactly
 * silent before the first edge. The table index is normalized 0..1
 * (1 = full buffer), so the phase advances `ratePerSample` per sample.
 */

/** Gate → one-sample pulse on the rising edge, clamped ≥0 (the accum's
 *  reset fires on ANY rise, including the −1 → 0 recovery after the
 *  gate's falling edge). */
function edgeOf(gate: NodeRepr_t | number): NodeRepr_t {
  return el.max(el.sub(gate, el.z(gate)), el.const({ value: 0 }))
}

/**
 * @param ratePerSample normalized advance per sample (1/frames = natural
 *  pitch); may be signal-rate for live pitch changes.
 * @param frames file length in frames — sets the running window.
 * @param minRate slowest rate the window must cover (frames/minRate + 128
 *  samples), so the sample always plays to completion.
 */
export function makeSampleOneShot(
  key: string,
  hash: string,
  channels: number,
  gate: NodeRepr_t | number,
  ratePerSample: NodeRepr_t | number,
  frames: number,
  minRate: number,
): NodeRepr_t[] {
  const edge = edgeOf(gate)
  // Gate-high samples since the last edge: stays 0 before the first hit,
  // freezes at the gate's end so samples longer than the gate keep playing.
  // Elementary's le/ge are strict, so `le(0, counter)` is the counter > 0 check.
  const counter = el.accum(gate, edge)
  const running = el.and(
    el.le(el.const({ value: 0 }), counter),
    el.le(counter, el.const({ value: frames / minRate + 128 })),
  )
  const phase = el.accum(el.mul(ratePerSample, running), edge)
  // d.ts types mc.table as the mono table; it returns the unpacked channels.
  return el.mc.table({ key: `${key}:tbl`, path: hash, channels }, phase) as unknown as NodeRepr_t[]
}

/** Free-running loop: a phasor sweeping the normalized index at the rate
 *  that makes one full cycle equal the file's duration at `rate` speed. */
export function makeSampleLoop(
  key: string,
  hash: string,
  channels: number,
  rate: NodeRepr_t | number,
  frames: number,
  sampleRate: number,
): NodeRepr_t[] {
  const rateHz = el.mul(rate, el.const({ value: sampleRate / frames }))
  const phase = el.phasor(rateHz)
  return el.mc.table({ key: `${key}:tbl`, path: hash, channels }, phase) as unknown as NodeRepr_t[]
}
