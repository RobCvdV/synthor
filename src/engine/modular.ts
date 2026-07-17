import { createNode, el, resolve, unpack, type NodeRepr_t } from '@elemaudio/core'
import type { Connection, Module, ModularInstrument } from '../domain/types'
import { FILTER_MODES } from '../domain/moduleDefs'
import { midiToFreq } from '../domain/notes'
import type { SampleMeta } from './instruments'

type Node = NodeRepr_t | number
const SILENCE = 0

export interface StereoOut {
  left: NodeRepr_t
  right: NodeRepr_t
}

/**
 * Custom ADSR envelope generator.
 *
 * Elementary's built-in `el.adsr()` uses `counter(gate)` to time the attack
 * phase.  `counter` only counts from a rising edge, so a constant gate (like
 * the preview keyboard's `el.const({value:1})`) never triggers it — the ADSR
 * stays stuck in attack forever and you never hear decay or sustain.
 *
 * This version uses `el.accum` instead, which counts every sample the gate
 * is high and resets to zero when it's low — no rising edge required.
 *
 * Time parameters are the time constant τ of the one-pole smoother:
 *   • ~63 % of target reached in τ seconds
 *   • ~95 % of target reached in 3τ seconds
 */
export function makeAdsr(
  attack: Node,
  decay: Node,
  sustain: Node,
  release: Node,
  gate: Node,
): NodeRepr_t {
  const one = el.const({ value: 1 })
  const zero = el.const({ value: 0 })
  const eps = el.const({ value: 1e-4 })

  // Count how long the gate has been continuously high.
  // accum(xn, reset): adds xn each sample, resets to 0 when reset > 0.
  const atkCounter = el.accum(gate, el.sub(one, gate))
  const atkSamps = el.mul(attack, el.sr())
  const atkGate = el.le(atkCounter, atkSamps)

  // Phase → target value.
  //   gate=0           → 0        (release / idle)
  //   gate=1, atkGate  → 1        (attack)
  //   gate=1, !atkGate → sustain  (decay / sustain)
  const targetValue = el.select(gate, el.select(atkGate, one, sustain), zero)

  // Phase → smoothing rate (tau, in seconds).  We pass tau directly to
  // tau2pole — no t60/6.91 indirection.
  const tau = el.max(eps, el.select(gate, el.select(atkGate, attack, decay), release))

  return el.smooth(el.tau2pole(tau), targetValue)
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
  /** Sample metadata indexed by sampleIndex param — sorted by sample name. */
  sampleMeta: SampleMeta[] = [],
  /** Base frequency in Hz for pitch tracking. 0 = use original rate. */
  baseFreq: number = 0,
  /** Per-cell volume signal (0..1), available to the `volume` source module. */
  vol: Node = 1,
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
      case 'volume':
        return vol

      case 'osc': {
        const f = inlet(m.id, 'freq') ?? 440
        let ratio = Math.pow(2, (p.detune ?? 0) / 12)
        ratio *= Math.pow(2, (p.finetune ?? 0) / 1200)
        const tuned = el.mul(f, kconst(key('detune'), ratio))
        const width = kconst(key('pulseWidth'), p.pulseWidth ?? 0.5)
        return el.mul(oscAudio(p.waveform ?? 0, tuned, width), kconst(key('gain'), p.gain ?? 1))
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
        return makeAdsr(
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
        const wf = Math.round(p.waveform ?? 0) // 0=sine,1=tri,2=saw,3=square,4=pulse
        const syncMode = Math.round(p.sync ?? 0) // 0=free, 1=gate
        const width = kconst(key('pulseWidth'), p.pulseWidth ?? 0.5)
        const amount = kconst(key('amount'), p.amount ?? 1)

        // Phase source: gate-synced resets when gate=0 and runs when gate=1,
        // so each note-on starts the LFO from phase 0. Free-running ignores gate.
        const g = inlet(m.id, 'gate')
        const phase =
          syncMode === 1
            ? el.syncphasor(rate, el.sub(el.const({ value: 1 }), g ?? SILENCE))
            : el.phasor(rate)

        return el.mul(lfoShape(wf, phase, width), amount)
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

      case 'sample': {
        const gateSig = inlet(m.id, 'gate') ?? SILENCE
        const freqIn = inlet(m.id, 'freq')

        // Resolve sample index → VFS path (hash) + channel count.
        const idx = Math.round(p.sampleIndex ?? 0)
        const meta = idx >= 0 && idx < sampleMeta.length ? sampleMeta[idx] : null
        if (!meta?.hash) return SILENCE

        const pitchTrack = Math.round(p.pitchTrack ?? 0)
        const loop = Math.round(p.loop ?? 0)
        const centerNote = Math.round(p.centerNote ?? 60)
        const centerFreq = midiToFreq(centerNote)
        const gain = kconst(key('gain'), p.gain ?? 1)

        if (!pitchTrack || freqIn === null) {
          // No pitch tracking — fire-once trigger at static rate.
          const ch = el.mc.sample(
            {
              key: `${keyPrefix}:${m.id}`,
              path: meta.hash,
              channels: meta.channels,
              playbackRate: baseFreq > 0 ? baseFreq / centerFreq : 1,
            },
            gateSig,
          )
          const out = el.mul(ch[0], gain)
          if (meta.channels === 2) memo.set(`${m.id}:outR`, el.mul(ch[1], gain))
          else memo.set(`${m.id}:outR`, out)
          return out
        }

        // Pitch-tracked: table + phasor for real frequency modulation.
        // rate = freqIn * sampleRate / (frames * centerFreq)
        // At centerNote: sweeps 0→sampleDur in sampleDur seconds (1× speed).
        const rateFactor = meta.sampleRate / (meta.frames * centerFreq)
        const rate = el.mul(freqIn, el.const({ key: `${keyPrefix}:${m.id}:rf`, value: rateFactor }))

        const phase = loop
          ? el.phasor(rate)
          : el.syncphasor(rate, gateSig)

        const sampleDur = meta.frames / meta.sampleRate
        const time = el.mul(phase, el.const({ key: `${keyPrefix}:${m.id}:dur`, value: sampleDur }))
        const tbl = createNode('table', {
          key: `${keyPrefix}:${m.id}:tbl`,
          path: meta.hash,
          channels: meta.channels,
        }, [resolve(time)])
        const ch = unpack(tbl as NodeRepr_t, meta.channels)

        // Gate with a fast envelope so the sample doesn't ring after release.
        const env = makeAdsr(0.001, 0.05, 1, 0.05, gateSig)
        const outL = el.mul(ch[0], gain, env)
        if (meta.channels === 2) memo.set(`${m.id}:outR`, el.mul(ch[1], gain, env))
        else memo.set(`${m.id}:outR`, outL)
        return outL
      }

      // output is evaluated per-channel at the top level — render() for the
      // output module isn't called. Keep as a fallback.
      case 'output':
        return SILENCE
    }
  }

  const outMod = inst.modules[inst.outputId]
  const outGain = outMod ? kconst(`${outMod.id}:gain`, outMod.params.gain ?? 1) : el.const({ value: 1 })
  const left = outMod ? (inlet(inst.outputId, 'inL') ?? SILENCE) : SILENCE
  const right = outMod ? (inlet(inst.outputId, 'inR') ?? left) : SILENCE
  const node = (n: Node): NodeRepr_t =>
    typeof n === 'number' ? el.const({ value: n }) : n
  return { left: el.mul(node(left), outGain), right: el.mul(node(right), outGain) }
}

function oscAudio(waveform: number, freq: Node, pulseWidth?: Node): NodeRepr_t {
  switch (Math.round(waveform)) {
    case 1:
      return el.blepsquare(freq)
    case 2:
      return el.bleptriangle(freq)
    case 3:
      return el.cycle(freq)
    case 4: {
      // Variable-width pulse: phase < width → +1, else -1.
      const w = pulseWidth ?? el.const({ value: 0.5 })
      const phase = el.phasor(freq)
      return el.sub(el.mul(el.le(phase, w), el.const({ value: 2 })), el.const({ value: 1 }))
    }
    default:
      return el.blepsaw(freq)
  }
}

/** Shape a 0→1 phasor ramp into a sub-audio LFO waveform (bipolar ±1).
 *  Waveform indices match LFO_WAVEFORMS: 0=sine, 1=tri, 2=saw, 3=square, 4=pulse. */
function lfoShape(wf: number, phase: Node, width: Node): Node {
  const one = el.const({ value: 1 })
  const two = el.const({ value: 2 })

  switch (wf) {
    case 0: // sine: sin(2π · phase)
      return el.sin(el.mul(phase, el.const({ value: 2 * Math.PI })))
    case 1: // triangle: 1 − 2·|2·phase − 1|
      return el.sub(one, el.mul(two, el.abs(el.sub(el.mul(phase, two), one))))
    case 2: // saw: 2·phase − 1
      return el.sub(el.mul(phase, two), one)
    case 3: // square: phase < 0.5 → +1 else −1
      return el.sub(el.mul(el.le(phase, el.const({ value: 0.5 })), two), one)
    case 4: // pulse: phase < width → +1 else −1
      return el.sub(el.mul(el.le(phase, width), two), one)
    default:
      return el.sin(el.mul(phase, el.const({ value: 2 * Math.PI })))
  }
}
