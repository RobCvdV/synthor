import { createNode, el, type NodeRepr_t } from '@elemaudio/core'

/** The native `wtosc` node's built-in shapes, in its `WtShape` order
 *  (src/native/WtOsc.h). Append only: songs store the index. */
export const WAVETABLE_SHAPES = [
  'sine', 'saw', 'square', 'triangle', 'pulse 25%', 'pulse 12%', 'half sine', 'abs sine',
  'organ', 'trapezoid', 'sync saw', 'stairs', 'soft saw', 'hollow', 'shark fin', 'double saw',
] as const

export type WavetableShape = (typeof WAVETABLE_SHAPES)[number]

export function wavetableShapeIndex(name: WavetableShape): number {
  return WAVETABLE_SHAPES.indexOf(name)
}

/** Band-limited (mipmapped) wavetable oscillator. `freq` in Hz — negative runs
 *  backwards; `phase` is an optional offset in cycles (phase modulation);
 *  a rising edge on `reset` restarts the cycle (as `el.syncphasor`). A reset of
 *  a constant never fires, so a zero stands in for an unused one. */
export function wtosc(
  shape: number, freq: NodeRepr_t,
  { bandlimit = true, ...opts }: WtoscOptions & { bandlimit?: boolean } = {},
): NodeRepr_t {
  const props: Record<string, unknown> = { shape }
  // Unfiltered: the exact shape, for modulation (band-limited edges ring at LFO rates).
  if (!bandlimit) props.bandlimit = false
  return node(props, freq, opts)
}

/** `wtosc` playing uploaded tables (`engine/wavetableMips`) from the VFS at `path`;
 *  `position` (0..1) morphs across their frames. */
export function wtoscTable(path: string, freq: NodeRepr_t, { position, ...opts }: WtoscOptions & { position?: NodeRepr_t } = {}): NodeRepr_t {
  return node({ path }, freq, opts, position)
}

interface WtoscOptions { phase?: NodeRepr_t; reset?: NodeRepr_t; key?: string }

function node(props: Record<string, unknown>, freq: NodeRepr_t, { phase, reset, key }: WtoscOptions, position?: NodeRepr_t): NodeRepr_t {
  if (key) props.key = key
  // Inputs are positional: fill the gaps before the last one in use.
  const zero = () => el.const({ value: 0 })
  const inputs = [freq, phase, reset, position]
  const last = inputs.reduce<number>((at, x, i) => (x ? i : at), 0)
  return createNode('wtosc', props, inputs.slice(0, last + 1).map((x) => x ?? zero())) as NodeRepr_t
}
