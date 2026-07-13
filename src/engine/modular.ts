import { el, type NodeRepr_t } from '@elemaudio/core'
import type { Connection, Module, ModularInstrument } from '../domain/types'
import { FILTER_MODES } from '../domain/moduleDefs'

type Node = NodeRepr_t | number
const SILENCE = 0

/**
 * Compile a modular instrument's block graph into a single Elementary node.
 *
 * Evaluation is a memoised depth-first walk from the `output` module: each
 * module's inlets are the sum of every incoming cord's source scaled by that
 * cord's `gain`. The track's control signals enter through the `note` (freq,
 * Hz) and `gate` source modules, so a modular instrument obeys the same
 * `(freq, gate) => node` contract as the built-in osc — the tracker is none the
 * wiser.
 *
 * Pure: no React, no Zustand, no AudioContext. v1 assumes an acyclic graph; a
 * back-edge (cycle) is broken by returning silence for the re-entered module.
 */
export function compileModular(
  inst: ModularInstrument,
  freq: Node,
  gate: Node,
  /**
   * Prefix for every node key. Must be unique per *voice*, not per instrument:
   * instruments are shared, so two voices of the same modular instrument (two
   * held preview notes, or two tracks pointing at one instrument) would collide
   * on identical keys if we used `inst.id`. Callers pass the voice/track key.
   */
  keyPrefix: string = inst.id,
): NodeRepr_t {
  const memo = new Map<string, Node>()
  const visiting = new Set<string>()

  // Params are fed as keyed consts so dragging a slider changes a value without
  // restructuring the graph (which would reset oscillator phase / envelope /
  // filter state). Mirrors the keying discipline in compile.ts.
  const kconst = (key: string, value: number): NodeRepr_t =>
    el.const({ key: `${keyPrefix}:${key}`, value })

  const conns = Object.values(inst.connections)

  /** Sum of all cords feeding `moduleId`'s named inlet, or null if none. */
  function inlet(moduleId: string, port: string): Node | null {
    const feeders = conns.filter((c) => c.to.moduleId === moduleId && c.to.port === port)
    if (feeders.length === 0) return null
    const scaled = feeders.map((c: Connection) => {
      const src = evalModule(c.from.moduleId)
      return el.mul(src, kconst(`${c.id}:gain`, c.gain))
    })
    return scaled.reduce((a, b) => el.add(a, b))
  }

  function evalModule(id: string): Node {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return SILENCE // cycle: break the back-edge
    const m = inst.modules[id]
    if (!m) return SILENCE

    visiting.add(id)
    const out = render(m)
    visiting.delete(id)
    memo.set(id, out)
    return out
  }

  function render(m: Module): Node {
    const p = m.params
    const key = (name: string) => `${m.id}:${name}`

    switch (m.type) {
      case 'note':
        return freq
      case 'gate':
        return gate

      case 'osc': {
        const f = inlet(m.id, 'freq') ?? 440
        const ratio = Math.pow(2, (p.detune ?? 0) / 12)
        const tuned = el.mul(f, kconst(key('detune'), ratio))
        return el.mul(osc(p.waveform ?? 0, tuned), kconst(key('gain'), p.gain ?? 1))
      }

      case 'filter': {
        const input = inlet(m.id, 'in') ?? SILENCE
        const cutoffMod = inlet(m.id, 'cutoffMod')
        const base = kconst(key('cutoff'), p.cutoff ?? 1200)
        const fc = cutoffMod === null ? base : el.add(base, cutoffMod)
        const mode = FILTER_MODES[Math.round(p.mode ?? 0)] ?? 'lowpass'
        return el.svf({ key: `${keyPrefix}:${m.id}`, mode }, fc, kconst(key('q'), p.q ?? 0.7), input)
      }

      case 'adsr': {
        const g = inlet(m.id, 'gate') ?? SILENCE
        return el.adsr(
          kconst(key('attack'), p.attack ?? 0.005),
          kconst(key('decay'), p.decay ?? 0.12),
          kconst(key('sustain'), p.sustain ?? 0.7),
          kconst(key('release'), p.release ?? 0.25),
          g,
        )
      }

      case 'gain': {
        const input = inlet(m.id, 'in') ?? SILENCE
        const mod = inlet(m.id, 'mod') ?? 1
        return el.mul(input, kconst(key('level'), p.level ?? 0.8), mod)
      }

      case 'mix': {
        const parts = ['a', 'b', 'c', 'd']
          .map((port) => inlet(m.id, port))
          .filter((n): n is Node => n !== null)
        if (parts.length === 0) return SILENCE
        const op = Math.round(p.mode ?? 0) === 1 ? el.mul : el.add
        return parts.reduce((acc, n) => op(acc, n))
      }

      case 'output':
        return inlet(m.id, 'in') ?? SILENCE
    }
  }

  const result = evalModule(inst.outputId)
  return typeof result === 'number' ? el.const({ value: result }) : result
}

function osc(waveform: number, freq: Node): NodeRepr_t {
  switch (Math.round(waveform)) {
    case 1:
      return el.blepsquare(freq)
    case 2:
      return el.bleptriangle(freq)
    case 3:
      return el.cycle(freq)
    default:
      return el.blepsaw(freq)
  }
}
