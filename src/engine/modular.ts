import { createNode, el, resolve, unpack, type NodeRepr_t } from '@elemaudio/core'
import type { Connection, Module, ModularInstrument } from '../domain/types'
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
        return el.add(laneSig ?? el.const({ value: 0 }), node)
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
        const square = el.blepsquare(tuned)
        const triangle = el.bleptriangle(tuned)
        const sine = el.cycle(tuned)
        const phase = el.phasor(tuned)
        const pulseWidth = el.sub(el.mul(el.le(phase, width), el.const({ value: 2 })), el.const({ value: 1 }))
        const oscOut = el.select(
          el.le(wf, el.const({ value: 0.5 })), saw,
          el.select(el.le(wf, el.const({ value: 1.5 })), square,
            el.select(el.le(wf, el.const({ value: 2.5 })), triangle,
              el.select(el.le(wf, el.const({ value: 3.5 })), sine, pulseWidth),
            ),
          ),
        )
        // DC-block to prevent offset from polyBLEP oscillators (especially triangle)
        return el.mul(el.dcblock(oscOut), gain)
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
        const half = el.const({ value: 0.5 })
        const lfoSine = el.sin(el.mul(phase, pi2))
        const lfoTri = el.sub(one, el.mul(two, el.abs(el.sub(el.mul(phase, two), one))))
        const lfoSaw = el.sub(el.mul(phase, two), one)
        const lfoSq = el.sub(el.mul(el.le(phase, half), two), one)
        const lfoPulse = el.sub(el.mul(el.le(phase, width), two), one)
        const shape = el.select(
          el.le(wf, el.const({ value: 0.5 })), lfoSine,
          el.select(el.le(wf, el.const({ value: 1.5 })), lfoTri,
            el.select(el.le(wf, el.const({ value: 2.5 })), lfoSaw,
              el.select(el.le(wf, el.const({ value: 3.5 })), lfoSq, lfoPulse),
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
        // Single-tap delay — no feedback, one repeat at the given time.
        const timeSamps = el.ms2samps(kconst(key('time'), p.time ?? 150))
        const wet = el.delay({ key: `${keyPrefix}:${m.id}`, size: DELAY_SIZE }, timeSamps, 0, input)
        const dryMix = kconst(key('mix'), p.mix ?? 0.5)
        return el.add(el.mul(input, el.sub(el.const({ value: 1 }), dryMix)), el.mul(wet, dryMix))
      }

      case 'echo': {
        const input = inlet(m.id, 'in') ?? SILENCE
        if (p.bypass) return input
        // Repeating echo — delay line with feedback for multiple repeats.
        const timeSamps = el.ms2samps(kconst(key('time'), p.time ?? 150))
        const fb = kconst(key('feedback'), p.feedback ?? 0.25)
        const wet = el.delay({ key: `${keyPrefix}:${m.id}`, size: DELAY_SIZE }, timeSamps, fb, input)
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

        // Prime-number comb delay times (ms) for density, plus stereo offsets.
        const baseTimes = [29.7, 37.1, 41.3, 43.7]
        const stereoOff = [1.3, 2.1, 0.9, 1.7]

        // Build one stereo channel: 4 filtered-feedback combs → sum → tone lowpass.
        function buildChannel(side: 'L' | 'R', sig: Node): Node {
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
              sig,
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

        const wetL = buildChannel('L', inputL)
        const wetR = buildChannel('R', hasStereoIn ? inputR : inputL)

        // Dry/wet mix — separate dry paths for true stereo when inR is connected.
        const dryGain = el.sub(el.const({ value: 1 }), wetMix)
        const outL = el.add(el.mul(inputL, dryGain), el.mul(wetL, wetMix))
        const outR = el.add(el.mul(hasStereoIn ? inputR : inputL, dryGain), el.mul(wetR, wetMix))

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
          // Include sample hash in key so Elementary reloads when sample changes.
          const ch = el.mc.sample(
            {
              key: `${keyPrefix}:${m.id}:${meta.hash}`,
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
        const rate = el.mul(freqIn, el.const({ key: `${keyPrefix}:${m.id}:rf:${meta.hash}`, value: rateFactor }))

        const phase = loop
          ? el.phasor(rate)
          : el.syncphasor(rate, gateSig)

        const sampleDur = meta.frames / meta.sampleRate
        const time = el.mul(phase, el.const({ key: `${keyPrefix}:${m.id}:dur`, value: sampleDur }))
        // Include sample hash in key so Elementary reloads when sample changes.
        const tbl = createNode('table', {
          key: `${keyPrefix}:${m.id}:tbl:${meta.hash}`,
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

