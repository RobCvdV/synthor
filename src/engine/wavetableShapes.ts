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
 *  a rising edge on `reset` restarts the cycle (as `el.syncphasor`). */
export function wtosc(
  shape: number, freq: NodeRepr_t,
  { phase, reset, key, bandlimit = true }: { phase?: NodeRepr_t; reset?: NodeRepr_t; key?: string; bandlimit?: boolean } = {},
): NodeRepr_t {
  const props: Record<string, unknown> = { shape }
  // Unfiltered: the exact shape, for modulation (band-limited edges ring at LFO rates).
  if (!bandlimit) props.bandlimit = false
  if (key) props.key = key
  const inputs = reset ? [freq, phase ?? el.const({ value: 0 }), reset] : phase ? [freq, phase] : [freq]
  return createNode('wtosc', props, inputs) as NodeRepr_t
}
