import { el, type NodeRepr_t } from '@elemaudio/core'
import type { Connection, Module, ModularInstrument } from '../domain/types'
import { FILTER_MODES } from '../domain/moduleDefs'

type Node = NodeRepr_t | number
const SILENCE = 0

export interface StereoOut {
  left: NodeRepr_t
  right: NodeRepr_t
}

/** Maximum delay buffer in samples — 4 seconds at 44.1 kHz. */
const DELAY_SIZE = 176400

/**
 * Compile a modular instrument's block graph into a stereo pair. Modules are
 * mono throughout — only the `output` module's L/R inlets create true stereo
 * separation. When the right channel is unconnected it falls back to the left
 * (mono duplicate), so existing mono patches keep working unchanged.
 *
 * Evaluation is a memoised depth-first walk from the `output` module: each
 * module's inlets are the sum of every incoming cord's source scaled by that
 * cord's `gain`. The track's control signals enter through the `note` (freq,
 * Hz) and `gate` source modules.
 *
 * Pure: no React, no Zustand, no AudioContext. v1 assumes an acyclic graph; a
 * back-edge (cycle) is broken by returning silence for the re-entered module.
 */
export function compileModular(
  inst: ModularInstrument,
  freq: Node,
  gate: Node,
  keyPrefix: string = inst.id,
): StereoOut {
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
      const src = evalModule(c.from.moduleId, c.from.port)
      return el.mul(src, kconst(`${c.id}:gain`, c.gain))
    })
    return scaled.reduce((a, b) => el.add(a, b))
  }

  function evalModule(id: string, outletPort?: string): Node {
    // Stereo ports: check the specifically-keyed cache first (e.g. 'modId:outR').
    if (outletPort && outletPort !== 'outL') {
      const portCache = memo.get(`${id}:${outletPort}`)
      if (portCache !== undefined) return portCache
    }
    // Default cache (left / only channel).
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return SILENCE // cycle: break the back-edge
    const m = inst.modules[id]
    if (!m) return SILENCE

    visiting.add(id)
    const out = render(m)
    visiting.delete(id)
    memo.set(id, out)

    // After render, the reverb module may have stored a stereo pair — pick it up.
    if (outletPort && outletPort !== 'outL') {
      const portResult = memo.get(`${id}:${outletPort}`)
      if (portResult !== undefined) return portResult
    }

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
        let ratio = Math.pow(2, (p.detune ?? 0) / 12)
        ratio *= Math.pow(2, (p.finetune ?? 0) / 1200)
        const tuned = el.mul(f, kconst(key('detune'), ratio))
        return el.mul(oscAudio(p.waveform ?? 0, tuned), kconst(key('gain'), p.gain ?? 1))
      }

      case 'filter': {
        const input = inlet(m.id, 'in') ?? SILENCE
        const cutoffMod = inlet(m.id, 'cutoffMod')
        const base = kconst(key('cutoff'), p.cutoff ?? 1200)
        // cutoffMod is a ratio modifier: e.g. a 0→1 envelope swings the
        // cutoff from base to base×(1+modDepth). Scaled by the modDepth
        // knob so it's immediately musical — no inaudible ±1 Hz offsets.
        if (cutoffMod !== null) {
          const depth = kconst(key('modDepth'), p.modDepth ?? 0.5)
          const fc = el.mul(base, el.add(el.const({ value: 1 }), el.mul(cutoffMod, depth)))
          const mode = FILTER_MODES[Math.round(p.mode ?? 0)] ?? 'lowpass'
          return el.svf({ key: `${keyPrefix}:${m.id}`, mode }, fc, kconst(key('q'), p.q ?? 0.7), input)
        }
        const mode = FILTER_MODES[Math.round(p.mode ?? 0)] ?? 'lowpass'
        return el.svf({ key: `${keyPrefix}:${m.id}`, mode }, base, kconst(key('q'), p.q ?? 0.7), input)
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

      case 'lfo': {
        const rate = kconst(key('rate'), p.rate ?? 4)
        const wf = Math.round(p.waveform ?? 0)
        const raw = wf === 1 ? el.bleptriangle(rate) : el.cycle(rate)
        // Scale to bipolar ±amount.
        return el.mul(raw, kconst(key('amount'), p.amount ?? 1))
      }

      case 'tanh': {
        const input = inlet(m.id, 'in') ?? SILENCE
        const drive = kconst(key('drive'), p.drive ?? 3)
        return el.mul(el.tanh(el.mul(input, drive)), kconst(key('level'), p.level ?? 0.5))
      }

      case 'delay': {
        const input = inlet(m.id, 'in') ?? SILENCE
        // Single-tap delay — no feedback, one repeat at the given time.
        const timeSamps = el.ms2samps(kconst(key('time'), p.time ?? 150))
        const wet = el.delay({ key: `${keyPrefix}:${m.id}`, size: DELAY_SIZE }, timeSamps, 0, input)
        const dryMix = kconst(key('mix'), p.mix ?? 0.5)
        return el.add(el.mul(input, el.sub(el.const({ value: 1 }), dryMix)), el.mul(wet, dryMix))
      }

      case 'echo': {
        const input = inlet(m.id, 'in') ?? SILENCE
        // Repeating echo — delay line with feedback for multiple repeats.
        const timeSamps = el.ms2samps(kconst(key('time'), p.time ?? 150))
        const fb = kconst(key('feedback'), p.feedback ?? 0.25)
        const wet = el.delay({ key: `${keyPrefix}:${m.id}`, size: DELAY_SIZE }, timeSamps, fb, input)
        const dryMix = kconst(key('mix'), p.mix ?? 0.5)
        return el.add(el.mul(input, el.sub(el.const({ value: 1 }), dryMix)), el.mul(wet, dryMix))
      }

      case 'reverb': {
        const input = inlet(m.id, 'in') ?? SILENCE

        const roomSize = kconst(key('roomSize'), p.roomSize ?? 0.5)
        const feedback = kconst(key('feedback'), p.feedback ?? 0.45)
        const damping = kconst(key('damping'), p.damping ?? 0.5)
        const stereoWidth = kconst(key('stereoWidth'), p.stereoWidth ?? 0.6)
        const wetMix = kconst(key('mix'), p.mix ?? 0.35)

        // Prime-number comb delay times (ms) for density, plus stereo offsets.
        const baseTimes = [29.7, 37.1, 41.3, 43.7]
        const stereoOff = [1.3, 2.1, 0.9, 1.7]

        // Build one stereo channel: 4 filtered-feedback combs → sum → tone lowpass.
        function buildChannel(side: 'L' | 'R'): Node {
          const offsetMul = side === 'R' ? stereoWidth : el.const({ value: 0 })

          const combs = baseTimes.map((base, i) => {
            // Delay time = (base + offset * width) * room size.
            const off = el.mul(el.const({ value: stereoOff[i] }), offsetMul)
            const timeMs = el.mul(el.add(el.const({ value: base }), off), roomSize)
            const timeSamps = el.ms2samps(timeMs)

            // Damping lowpass before the comb: bright (~15 kHz) → dark (~400 Hz).
            // The filter is placed *before* the delay input so each recirculation
            // passes through it once (= progressive high-frequency roll-off).
            const dampHi = el.const({ value: 16000 })
            const dampLo = el.const({ value: 400 })
            const dampFreq = el.add(dampLo, el.mul(el.sub(el.const({ value: 1 }), damping), el.sub(dampHi, dampLo)))
            const damped = el.svf(
              { key: `${keyPrefix}:${m.id}:damp${side}${i}`, mode: 'lowpass' },
              dampFreq,
              el.const({ value: 0.5 }),
              input,
            )

            return el.delay(
              { key: `${keyPrefix}:${m.id}:comb${side}${i}`, size: DELAY_SIZE },
              timeSamps,
              feedback,
              damped,
            )
          })

          // Sum combs, scale down to avoid clipping.
          const combSum = el.mul(
            combs.reduce((a, b) => el.add(a, b), el.const({ value: 0 })),
            el.const({ value: 0.35 }),
          )

          // Overall tone shaping — same damping curve brightens or darkens the tail.
          const toneHi = el.const({ value: 14000 })
          const toneLo = el.const({ value: 800 })
          const toneFreq = el.add(toneLo, el.mul(el.sub(el.const({ value: 1 }), damping), el.sub(toneHi, toneLo)))
          return el.svf(
            { key: `${keyPrefix}:${m.id}:tone${side}`, mode: 'lowpass' },
            toneFreq,
            el.const({ value: 0.5 }),
            combSum,
          )
        }

        const wetL = buildChannel('L')
        const wetR = buildChannel('R')

        // Dry/wet mix.
        const dryGain = el.sub(el.const({ value: 1 }), wetMix)
        const outL = el.add(el.mul(input, dryGain), el.mul(wetL, wetMix))
        const outR = el.add(el.mul(input, dryGain), el.mul(wetR, wetMix))

        // Store the right channel so connections from outR can pick it up later.
        memo.set(`${m.id}:outR`, outR)

        return outL
      }

      // output is evaluated per-channel at the top level — render() for the
      // output module isn't called. Keep as a fallback.
      case 'output':
        return SILENCE
    }
  }

  const outMod = inst.modules[inst.outputId]
  const left = outMod ? (inlet(inst.outputId, 'inL') ?? SILENCE) : SILENCE
  const right = outMod ? (inlet(inst.outputId, 'inR') ?? left) : SILENCE
  const node = (n: Node): NodeRepr_t =>
    typeof n === 'number' ? el.const({ value: n }) : n
  return { left: node(left), right: node(right) }
}

function oscAudio(waveform: number, freq: Node): NodeRepr_t {
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
