import { createNode, el, resolve, unpack, type NodeRepr_t } from '@elemaudio/core'
import type { Connection, Module, ModularInstrument } from '../domain/types'
import { midiToFreq } from '../domain/notes'
import { WAVEFORM_MAX_LENGTH_SECONDS } from '../domain/moduleDefs'
import { makeFdnReverb } from './reverbFdn'
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

/** Maximum delay/echo buffer: 16 ticks at 20 BPM, 4 rows/beat, 48 kHz. */
export const TICK_DELAY_SIZE = 576000

/**
 * Delay time in samples from a tick (row) count. Uses a live rowHz node
 * (a 'transport:rowHz' ref) so tempo changes retune the delay without a
 * graph recompile: samples = ticks * sampleRate / rowHz.
 */
export function tickTimeSamps(ticks: number, rowHzNode: NodeRepr_t | number): NodeRepr_t {
  return el.div(el.mul(el.const({ value: ticks }), el.sr()), rowHzNode)
}

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
  /** Per-cell volume signal (0..1), available to the `volume` source module. */
  vol: Node = 1,
  /** Per-effect-lane seq2 signals for named instrument inlets, keyed by
   *  inlet name. `eff` modules look up their signal by their `name` param. */
  inletSignals: Record<string, NodeRepr_t> = {},
  /** MIDI CC values (0-127 → raw 0-127).  Used by `midicc` source modules. */
  midiCcValues?: Record<number, number>,
  /** Param ref registry — uses createRef so values update without recompile. */
  paramRefs?: import('../audio/paramRefs').ParamRefRegistry,
  /** CC binding table — populated during graph build so MIDI CC changes
   *  can update the right refs without a recompile. */
  ccBindings?: import('../audio/ccBindings').CcBindings,
  /** Live rows-per-second node (a 'transport:rowHz' ref) for tempo-synced
   *  delay/echo times. Defaults to 8 (120 BPM, 4 rows/beat). */
  rowHzNode: NodeRepr_t | number = 8,
): StereoOut {
  const memo = new Map<string, Node>()
  const visiting = new Set<string>()

  // Param refs use instrument-scoped keys so ALL voices/tracks sharing this
  // instrument see the same ref.  Voice-specific keys (keyPrefix) are used
  // only for voice-owned nodes (freq/gate consts), not for shared params.
  // Without this, slider changes via updateParamRef wouldn't find the ref
  // because it was stored under a per-voice key like "preview:inst:60:mod:cutoff".
  const refKey = (key: string) => `${inst.id}:${key}`
  const kconst = (key: string, value: number): NodeRepr_t => {
    if (paramRefs) {
      const fullKey = refKey(key)
      const existing = paramRefs.getOrCreate(fullKey, value)
      // Log only on first creation (getOrCreate logs CREATE internally).
      return existing
    }
    return el.const({ key: `${keyPrefix}:${key}`, value })
  }

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
      case 'eff': {
        const inletName = m.name ?? ''
        const laneSig = inletName ? (inletSignals[inletName] ?? null) : null
        const cc = Math.round(m.params.cc ?? 0)
        const ccVal = cc > 0 ? (midiCcValues?.[cc] ?? 0) / 127 : 0
        const node = kconst(key('cc'), ccVal)
        ccBindings?.register(cc, refKey(key('cc')))
        // No lane bound → hold the module's Default param (a live ref, so the
        // node slider applies without a recompile).
        const fallback = kconst(key('default'), p.default ?? 0)
        return el.add(laneSig ?? fallback, node)
      }

      case 'midicc': {
        const cc = Math.round(p.cc ?? 1)
        const raw = midiCcValues?.[cc] ?? 0
        const node = kconst(key('val'), raw / 127)
        ccBindings?.register(cc, refKey(key('val')))
        return node
      }

      case 'osc': {
        const f = inlet(m.id, 'freq') ?? 440
        // Separate detune/finetune refs; ratio computed in the audio graph so
        // slider changes take effect instantly without a recompile.
        const detuneRef = kconst(key('detune'), p.detune ?? 0)
        const finetuneRef = kconst(key('finetune'), p.finetune ?? 0)
        const ln2 = el.const({ value: Math.LN2 })
        const exponent = el.add(el.div(detuneRef, 12), el.div(finetuneRef, 1200))
        const ratio = el.exp(el.mul(ln2, exponent))
        const tuned = el.mul(f, ratio)
        const width = kconst(key('pulseWidth'), p.pulseWidth ?? 0.5)
        const gain = kconst(key('gain'), p.gain ?? 1)
        // Waveform selector ref: 0=saw,1=square,2=triangle,3=sine,4=pulse.
        // All 5 oscillator types run in the graph so waveform changes are instant.
        const wf = kconst(key('waveform'), p.waveform ?? 0)
        const saw = el.blepsaw(tuned)
        const triangle = el.bleptriangle(tuned)
        const sine = el.cycle(tuned)
        const phase = el.phasor(tuned)
        // Phasor-based pulse: width controls duty cycle (0..1). width=0.5 = square.
        const pulse = el.sub(el.mul(el.le(phase, width), el.const({ value: 2 })), el.const({ value: 1 }))
        const oscOut = el.select(
          el.le(wf, el.const({ value: 0.5 })), saw,
          el.select(el.le(wf, el.const({ value: 1.5 })), pulse,
            el.select(el.le(wf, el.const({ value: 2.5 })), triangle,
              el.select(el.le(wf, el.const({ value: 3.5 })), sine, pulse),
            ),
          ),
        )
        // DC-block to prevent offset from polyBLEP oscillators (especially triangle)
        return el.mul(el.dcblock(oscOut), gain)
      }

      case 'noise': {
        const mode = kconst(key('mode'), p.mode ?? 0)
        const level = kconst(key('level'), p.level ?? 1)
        // Both generators run in the graph; the mode ref picks. Explicit
        // voice-scoped keys: an unkeyed rand has no inputs, so every voice
        // would hash identically and share one RNG stream.
        const normal = el.noise({ key: `${keyPrefix}:${m.id}:noise` })
        const pink = el.pinknoise({ key: `${keyPrefix}:${m.id}:pink` })
        const src = el.select(el.le(mode, el.const({ value: 0.5 })), normal, pink)
        return el.mul(el.dcblock(src), level)
      }

      case 'filter': {
        const input = inlet(m.id, 'in') ?? SILENCE
        if (p.bypass) return input
        const cutoffMod = inlet(m.id, 'cutoffMod')
        const base = kconst(key('cutoff'), p.cutoff ?? 1200)
        const q = kconst(key('q'), p.q ?? 0.7)
        const fc =
          cutoffMod !== null
            ? el.mul(
                base,
                el.add(
                  el.const({ value: 1 }),
                  el.mul(
                    cutoffMod,
                    kconst(key('modDepth'), p.modDepth ?? 0.5),
                    kconst(key('modDepthScale'), p.modDepthScale ?? 1),
                  ),
                ),
              )
            : base

        // Three parallel SVFs (one per mode) selected by a kconst mode ref.
        // Each SVF is scoped to keyPrefix so pattern tracks and preview voices
        // get independent filter nodes — no shared SVF state across paths.
        // The mode ref is instrument-scoped (kconst), so changing the mode
        // slider affects all voices/tracks without a recompile.
        const modeRef = kconst(key('mode'), p.mode ?? 0)
        const lp = el.svf({ key: `${keyPrefix}:${m.id}:lp`, mode: 'lowpass' }, fc, q, input)
        const hp = el.svf({ key: `${keyPrefix}:${m.id}:hp`, mode: 'highpass' }, fc, q, input)
        const bp = el.svf({ key: `${keyPrefix}:${m.id}:bp`, mode: 'bandpass' }, fc, q, input)
        return el.select(
          el.le(modeRef, el.const({ value: 0.5 })), lp,
          el.select(el.le(modeRef, el.const({ value: 1.5 })), hp, bp),
        )
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
        if (p.bypass) return input
        const mod = inlet(m.id, 'mod') ?? 1
        return el.mul(input, kconst(key('level'), p.level ?? 0.8), mod)
      }

      case 'comp': {
        const input = inlet(m.id, 'in') ?? SILENCE
        if (p.bypass) return input
        const mode = kconst(key('mode'), p.mode ?? 1)
        const threshold = kconst(key('threshold'), p.threshold ?? -20)
        const ratio = kconst(key('ratio'), p.ratio ?? 4)
        const attack = kconst(key('attack'), p.attack ?? 10)
        const release = kconst(key('release'), p.release ?? 100)
        const knee = kconst(key('knee'), p.knee ?? 6)
        const makeup = kconst(key('makeup'), p.makeup ?? 0)

        // Both compressors run in the graph; the mode ref picks. Self-keyed:
        // sidechain = xn = input. Elementary has no makeup gain — add it after.
        const hard = el.compress(attack, release, threshold, ratio, input, input)
        // knee=0 → /0 inside skcompress (kneeWidth = 2·knee); NaN would
        // propagate through el.select (g·a + (1−g)·b) even in hard mode.
        const kneeSafe = el.max(knee, el.const({ value: 0.01 }))
        const soft = el.skcompress(attack, release, threshold, ratio, kneeSafe, input, input)
        const comp = el.select(el.le(mode, el.const({ value: 0.5 })), hard, soft)
        return el.mul(el.db2gain(makeup), comp)
      }

      case 'mix': {
        if (p.bypass) return inlet(m.id, 'a') ?? SILENCE
        const parts = ['a', 'b', 'c', 'd']
          .map((port) => inlet(m.id, port))
          .filter((n): n is Node => n !== null)
        if (parts.length === 0) return SILENCE
        // Both add and multiply reductions run in the graph; mode ref picks.
        const sum = parts.reduce((acc, n) => el.add(acc, n))
        const prod = parts.reduce((acc, n) => el.mul(acc, n))
        const mode = kconst(key('mode'), p.mode ?? 0)
        return el.select(el.le(mode, el.const({ value: 0.5 })), sum, prod)
      }

      case 'lfo': {
        const rate = kconst(key('rate'), p.rate ?? 4)
        const width = kconst(key('pulseWidth'), p.pulseWidth ?? 0.5)
        const amount = kconst(key('amount'), p.amount ?? 1)
        const amountScale = kconst(key('amountScale'), p.amountScale ?? 1)

        // Sync mode ref: 0=free, 1=gate.
        const sync = kconst(key('sync'), p.sync ?? 0)
        const g = inlet(m.id, 'gate')
        const freePhase = el.phasor(rate)
        const syncPhase = el.syncphasor(rate, el.sub(el.const({ value: 1 }), g ?? SILENCE))
        const phase = el.select(el.le(sync, el.const({ value: 0.5 })), freePhase, syncPhase)

        // Waveform ref: 0=sine,1=tri,2=saw,3=square,4=pulse.
        // All 5 shapes run in the graph so waveform changes are instant.
        const wf = kconst(key('waveform'), p.waveform ?? 0)
        const one = el.const({ value: 1 })
        const two = el.const({ value: 2 })
        const pi2 = el.const({ value: 2 * Math.PI })
        const lfoSine = el.sin(el.mul(phase, pi2))
        const lfoTri = el.sub(one, el.mul(two, el.abs(el.sub(el.mul(phase, two), one))))
        const lfoSaw = el.sub(el.mul(phase, two), one)
        // Phasor-based pulse: width controls duty cycle. width=0.5 = square.
        const lfoPulse = el.sub(el.mul(el.le(phase, width), two), one)
        const shape = el.select(
          el.le(wf, el.const({ value: 0.5 })), lfoSine,
          el.select(el.le(wf, el.const({ value: 1.5 })), lfoTri,
            el.select(el.le(wf, el.const({ value: 2.5 })), lfoSaw,
              el.select(el.le(wf, el.const({ value: 3.5 })), lfoPulse, lfoPulse),
            ),
          ),
        )

        return el.mul(shape, amount, amountScale)
      }

      // ── Distortion effects ──────────────────────────────────────────
      //
      // tanh = hyperbolic tangent waveshaper — smooth saturation with
      //   odd-harmonic overtones. Soft, analog-tape-like clipping.
      // clip = hard-clip at a threshold — aggressive, brick-wall limiting
      //   with many high harmonics. Classic digital distortion.
      // fold = wave-folding — the waveform folds back on itself when it
      //   exceeds the threshold, creating rich, complex harmonics.
      // crush = bit-depth reduction — quantises the signal to N bits,
      //   producing crunchy lo-fi digital artefacts.

      case 'tanh': {
        const input = inlet(m.id, 'in') ?? SILENCE
        if (p.bypass) return input
        const driveMod = inlet(m.id, 'drive') ?? el.const({ value: 1 })
        const drive = el.mul(kconst(key('drive'), p.drive ?? 4), driveMod)
        return el.mul(el.tanh(el.mul(input, drive)), kconst(key('level'), p.level ?? 1))
      }

      case 'clip': {
        const input = inlet(m.id, 'in') ?? SILENCE
        if (p.bypass) return input
        const driveMod = inlet(m.id, 'drive') ?? el.const({ value: 1 })
        const drive = el.mul(kconst(key('drive'), p.drive ?? 4), driveMod)
        const threshold = kconst(key('threshold'), p.threshold ?? 0.7)
        const negThreshold = el.sub(el.const({ value: 0 }), threshold)
        const driven = el.mul(input, drive)
        // Hard-clip: clamp to [-threshold, +threshold]
        const clipped = el.max(negThreshold, el.min(threshold, driven))
        return el.mul(clipped, kconst(key('level'), p.level ?? 0.7))
      }

      case 'fold': {
        const input = inlet(m.id, 'in') ?? SILENCE
        if (p.bypass) return input
        const driveMod = inlet(m.id, 'drive') ?? el.const({ value: 1 })
        const drive = el.mul(kconst(key('drive'), p.drive ?? 3), driveMod)
        const threshold = kconst(key('threshold'), p.threshold ?? 0.35)
        const negThreshold = el.sub(el.const({ value: 0 }), threshold)
        const two = el.const({ value: 2 })
        const driven = el.mul(input, drive)
        // One-stage wave-folder: reflect the waveform when it exceeds the
        // threshold.  x > +T  →  2T - x;   x < -T  →  -2T - x.
        const overPos = el.ge(driven, threshold)
        const overNeg = el.le(driven, negThreshold)
        const folded = el.select(
          overPos,
          el.sub(el.mul(two, threshold), driven),
          el.select(overNeg, el.sub(el.mul(two, negThreshold), driven), driven),
        )
        return el.mul(folded, kconst(key('level'), p.level ?? 0.7))
      }

      case 'crush': {
        const input = inlet(m.id, 'in') ?? SILENCE
        if (p.bypass) return input
        const bitsMod = inlet(m.id, 'bits') ?? el.const({ value: 1 })
        const bits = el.mul(kconst(key('bits'), p.bits ?? 4), bitsMod)
        // Quantise to N bits:  steps = 2^(N-1),  out = round(in·steps) / steps
        const steps = el.pow(el.const({ value: 2 }), el.sub(bits, el.const({ value: 1 })))
        const quantised = el.div(el.round(el.mul(input, steps)), steps)
        return el.mul(quantised, kconst(key('level'), p.level ?? 1))
      }

      case 'delay': {
        const input = inlet(m.id, 'in') ?? SILENCE
        if (p.bypass) return input
        // Single-tap delay — no feedback, one repeat at the given tick time.
        const timeSamps = tickTimeSamps(p.time ?? 1.25, rowHzNode)
        const wet = el.delay({ key: `${keyPrefix}:${m.id}`, size: TICK_DELAY_SIZE }, timeSamps, 0, input)
        const dryMix = kconst(key('mix'), p.mix ?? 0.5)
        return el.add(el.mul(input, el.sub(el.const({ value: 1 }), dryMix)), el.mul(wet, dryMix))
      }

      case 'echo': {
        const input = inlet(m.id, 'in') ?? SILENCE
        if (p.bypass) return input
        // Repeating echo — delay line with feedback for multiple repeats.
        const timeSamps = tickTimeSamps(p.time ?? 1.25, rowHzNode)
        const fb = kconst(key('feedback'), p.feedback ?? 0.25)
        const wet = el.delay({ key: `${keyPrefix}:${m.id}`, size: TICK_DELAY_SIZE }, timeSamps, fb, input)
        const dryMix = kconst(key('mix'), p.mix ?? 0.5)
        return el.add(el.mul(input, el.sub(el.const({ value: 1 }), dryMix)), el.mul(wet, dryMix))
      }

      case 'reverb': {
        const inputL = inlet(m.id, 'in') ?? SILENCE
        const inputR = inlet(m.id, 'inR') // optional stereo right input
        const hasStereoIn = inputR !== null
        if (p.bypass) {
          memo.set(`${m.id}:outR`, hasStereoIn ? inputR : inputL)
          return inputL
        }

        const roomSize = kconst(key('roomSize'), p.roomSize ?? 0.5)
        const feedback = kconst(key('feedback'), p.feedback ?? 0.45)
        const damping = kconst(key('damping'), p.damping ?? 0.5)
        const stereoWidth = kconst(key('stereoWidth'), p.stereoWidth ?? 0.6)
        const wetMix = kconst(key('mix'), p.mix ?? 0.35)

        const { left: outL, right: outR } = makeFdnReverb(
          `${keyPrefix}:${m.id}`,
          roomSize, feedback, damping, stereoWidth, wetMix,
          inputL, hasStereoIn ? (inputR as Node) : inputL,
        )

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

        const pitchTrack = Math.round(p.pitchTrack ?? 1)
        const loop = Math.round(p.loop ?? 0)
        const gain = kconst(key('gain'), p.gain ?? 1)

        // playRate + finetune as live kconst refs → ratio = 2^(semitones/12).
        const playRateRef = kconst(key('playRate'), p.playRate ?? 0)
        const finetuneRef = kconst(key('finetune'), p.finetune ?? 0)
        const ln2 = el.const({ value: Math.LN2 })
        const ratio = el.exp(el.mul(ln2, el.add(el.div(playRateRef, 12), el.div(finetuneRef, 12))))

        // rate = freqIn / midiToFreq(60) * ratio  — pitch-tracked
        // rate = ratio                            — no pitch tracking
        const rate = pitchTrack && freqIn !== null
          ? el.mul(el.div(freqIn, el.const({ value: midiToFreq(60) })), ratio)
          : ratio

        // Loop ON: table+phasor for continuous cycling.  Loop OFF: el.sample
        // triggers on gate rising edge, plays to completion, and adapts to
        // signal-rate playbackRate changes in real time.
        if (loop) {
          const rateFactor = meta.sampleRate / (meta.frames * midiToFreq(60))
          const phasorRate = el.mul(rate, el.const({ key: `${keyPrefix}:${m.id}:rf:${meta.hash}`, value: rateFactor }))
          const phase = el.phasor(phasorRate)
          const sampleDur = meta.frames / meta.sampleRate
          const time = el.mul(phase, el.const({ key: `${keyPrefix}:${m.id}:dur`, value: sampleDur }))
          const tbl = createNode('table', {
            key: `${keyPrefix}:${m.id}:tbl:${meta.hash}`,
            path: meta.hash,
            channels: meta.channels,
          }, [resolve(time)])
          const ch = unpack(tbl as NodeRepr_t, meta.channels)
          const env = makeAdsr(0.001, 0.05, 1, 0.05, gateSig)
          const outL = el.mul(ch[0], gain, env)
          if (meta.channels === 2) memo.set(`${m.id}:outR`, el.mul(ch[1], gain, env))
          else memo.set(`${m.id}:outR`, outL)
          return outL
        }

        const smp = (el as any).sample(
          { key: `${keyPrefix}:${m.id}:${meta.hash}`, path: meta.hash, channels: meta.channels },
          gateSig,
          rate,
        ) as NodeRepr_t
        const ch = unpack(smp, meta.channels)
        const out = el.mul(ch[0], gain)
        if (meta.channels === 2) memo.set(`${m.id}:outR`, el.mul(ch[1], gain))
        else memo.set(`${m.id}:outR`, out)
        return out
      }

      case 'wave': {
        const freqIn = inlet(m.id, 'freq')
        // The whole sample is one cycle, so the phasor runs directly at the
        // requested frequency — the sample's native rate/length is irrelevant.
        // Only samples ≤ WAVEFORM_MAX_LENGTH_SECONDS are eligible; same filter
        // the UI dropdown applies over the name-sorted sample list.
        const waveMeta = sampleMeta.filter((meta) => meta.frames / meta.sampleRate <= WAVEFORM_MAX_LENGTH_SECONDS)
        const idx = Math.round(p.sampleIndex ?? 0)
        const meta = idx >= 0 && idx < waveMeta.length ? waveMeta[idx] : null
        // Also covers stale patches whose sample no longer qualifies.
        if (!meta?.hash) return SILENCE

        const gain = kconst(key('gain'), p.gain ?? 1)
        const finetuneRef = kconst(key('finetune'), p.finetune ?? 0)
        const ln2 = el.const({ value: Math.LN2 })
        const ratio = el.exp(el.mul(ln2, el.div(finetuneRef, 1200)))
        const f = freqIn ?? 440
        // The table index is normalized 0..1, so the raw phasor sweeps the
        // whole buffer once per cycle — one full sample = one waveform cycle.
        const phase = el.phasor(el.mul(f, ratio))
        const tbl = createNode('table', {
          key: `${keyPrefix}:${m.id}:tbl:${meta.hash}`,
          path: meta.hash,
          channels: meta.channels,
        }, [phase])
        const ch = unpack(tbl as NodeRepr_t, meta.channels)
        const outL = el.mul(ch[0], gain)
        if (meta.channels === 2) memo.set(`${m.id}:outR`, el.mul(ch[1], gain))
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

