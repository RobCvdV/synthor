import { createNode, type NodeRepr_t } from '@elemaudio/core'

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
 *  backwards; `phase` is an optional offset in cycles (phase modulation). */
export function wtosc(shape: number, freq: NodeRepr_t, phase?: NodeRepr_t, key?: string): NodeRepr_t {
  const props: Record<string, unknown> = { shape }
  if (key) props.key = key
  return createNode('wtosc', props, phase ? [freq, phase] : [freq]) as NodeRepr_t
}
