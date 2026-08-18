/**
 * Mixer engine — channel-level effect processing and routing.
 *
 * Pure functions: no React, no Zustand, no AudioContext. Takes Elementary
 * nodes in, returns Elementary nodes out. Reuses effect compilation patterns
 * from `engine/modular.ts` but adapted for stereo channel processing.
 */

import { el, type NodeRepr_t } from '@elemaudio/core'
import type { ChannelEffect } from '../domain/types'
import { isStereoEffect } from '../domain/moduleDefs'
import { HAAS_DELAY_SAMPLES, HAAS_DELAY_SIZE, TICK_DELAY_SIZE, tickTimeSamps, type StereoOut } from './modular'
import { makeFdnReverb } from './reverbFdn'
import type { ParamRefRegistry } from '../audio/paramRefs'
import type { SampleMeta } from './instruments'

/** Build a param ref key for a channel effect parameter. */
function chanRefKey(channelId: string, effectId: string, paramKey: string): string {
  return `chan:${channelId}:${effectId}:${paramKey}`
}

/** Get or create a param ref, or fall back to a const node. */
function kconst(
  key: string,
  value: number,
  paramRefs?: ParamRefRegistry,
): NodeRepr_t {
  if (paramRefs) return paramRefs.getOrCreate(key, value)
  return el.const({ key, value })
}

/** Apply an ordered list of channel effects to a stereo signal pair.
 *  Each effect's params use createRef so slider changes are instant. */
export function compileChannelEffects(
  effects: ChannelEffect[],
  input: StereoOut,
  channelId: string,
  paramRefs?: ParamRefRegistry,
  /** Live rows-per-second node for tempo-synced delay/echo times. */
  rowHzNode: NodeRepr_t | number = 8,
  /** Sample metadata for conv (IR) effects — sampleIndex → VFS hash. */
  sampleMeta: SampleMeta[] = [],
): StereoOut {
  let out = input
  for (const fx of effects) {
    out = compileOneEffect(fx, out, channelId, paramRefs, rowHzNode, sampleMeta)
  }
  return out
}

/** Compile a single channel effect, stereo in → stereo out.
 *  If fx.side is set, only that channel is processed; the other passes through. */
function compileOneEffect(
  fx: ChannelEffect,
  input: StereoOut,
  channelId: string,
  paramRefs?: ParamRefRegistry,
  rowHzNode: NodeRepr_t | number = 8,
  sampleMeta: SampleMeta[] = [],
): StereoOut {
  const p = fx.params
  const key = (name: string) => chanRefKey(channelId, fx.id, name)
  const k = (name: string, value: number) => kconst(key(name), value, paramRefs)

  // Ref-based bypass so toggling doesn't require a recompile.
  const bypass = k('bypass', p.bypass ? 1 : 0)

  // Stereo effects (or unsided) process both channels.
  // Mono effects with a side only process that channel.
  const isStereo = isStereoEffect(fx.type)
  const side = fx.side

  /** Wrap a per-channel processor — only applies to fx.side if set. */
  function sided(
    input: StereoOut,
    fn: (sig: NodeRepr_t) => NodeRepr_t,
  ): StereoOut {
    if (isStereo || !side) {
      return { left: fn(input.left), right: fn(input.right) }
    }
    if (side === 'L') {
      return { left: fn(input.left), right: input.right }
    }
    // side === 'R'
    return { left: input.left, right: fn(input.right) }
  }

  /** Route through the effect or bypass it, controlled by the bypass ref. */
  function bypassable(effected: StereoOut): StereoOut {
    return {
      left: el.select(bypass, input.left, effected.left),
      right: el.select(bypass, input.right, effected.right),
    }
  }

  switch (fx.type) {
    // ── Filter ──────────────────────────────────────────────
    case 'filter': {
      const cutoff = k('cutoff', p.cutoff ?? 1200)
      const q = k('q', p.q ?? 0.7)
      const mode = k('mode', p.mode ?? 0)
      const effected = sided(input, (sig) => {
        const svfKey = `${channelId}:${fx.id}:${side ?? 'LR'}`
        const lp = el.svf({ key: `${svfKey}:lp`, mode: 'lowpass' }, cutoff, q, sig)
        const hp = el.svf({ key: `${svfKey}:hp`, mode: 'highpass' }, cutoff, q, sig)
        const bp = el.svf({ key: `${svfKey}:bp`, mode: 'bandpass' }, cutoff, q, sig)
        return el.select(
          el.le(mode, el.const({ value: 0.5 })), lp,
          el.select(el.le(mode, el.const({ value: 1.5 })), hp, bp),
        )
      })
      return bypassable(effected)
    }

    // ── Gain ────────────────────────────────────────────────
    case 'gain': {
      const level = k('level', p.level ?? 0.8)
      return bypassable(sided(input, (sig) => el.mul(sig, level)))
    }

    // ── Saturator (tanh) ────────────────────────────────────
    case 'tanh': {
      const drive = k('drive', p.drive ?? 4)
      const level = k('level', p.level ?? 1)
      return bypassable(sided(input, (sig) => el.mul(el.tanh(el.mul(sig, drive)), level)))
    }

    // ── Hard Clip ───────────────────────────────────────────
    case 'clip': {
      const drive = k('drive', p.drive ?? 4)
      const threshold = k('threshold', p.threshold ?? 0.7)
      const level = k('level', p.level ?? 0.7)
      const neg = el.sub(el.const({ value: 0 }), threshold)
      const effected = sided(input, (sig) => {
        const driven = el.mul(sig, drive)
        return el.mul(el.max(neg, el.min(threshold, driven)), level)
      })
      return bypassable(effected)
    }

    // ── Wave Folder ─────────────────────────────────────────
    case 'fold': {
      const drive = k('drive', p.drive ?? 3)
      const threshold = k('threshold', p.threshold ?? 0.35)
      const level = k('level', p.level ?? 0.7)
      const neg = el.sub(el.const({ value: 0 }), threshold)
      const two = el.const({ value: 2 })
      const effected = sided(input, (sig) => {
        const driven = el.mul(sig, drive)
        const overPos = el.ge(driven, threshold)
        const overNeg = el.le(driven, neg)
        const folded = el.select(
          overPos,
          el.sub(el.mul(two, threshold), driven),
          el.select(overNeg, el.sub(el.mul(two, neg), driven), driven),
        )
        return el.mul(folded, level)
      })
      return bypassable(effected)
    }

    // ── Bit Crusher ─────────────────────────────────────────
    case 'crush': {
      const bits = k('bits', p.bits ?? 4)
      const level = k('level', p.level ?? 1)
      const steps = el.pow(el.const({ value: 2 }), el.sub(bits, el.const({ value: 1 })))
      const effected = sided(input, (sig) => {
        const q = el.div(el.round(el.mul(sig, steps)), steps)
        return el.mul(q, level)
      })
      return bypassable(effected)
    }

    // ── Single-tap Delay ────────────────────────────────────
    case 'delay': {
      // Ticks as a live ref so the Time slider retunes without a recompile.
      const timeTicks = k('time', p.time ?? 1.25)
      const timeSamps = tickTimeSamps(timeTicks, rowHzNode)
      const mix = k('mix', p.mix ?? 0.5)
      const dry = el.sub(el.const({ value: 1 }), mix)
      const wetL = el.delay({ key: `${channelId}:${fx.id}:L`, size: TICK_DELAY_SIZE }, timeSamps, 0, input.left)
      const wetR = el.delay({ key: `${channelId}:${fx.id}:R`, size: TICK_DELAY_SIZE }, timeSamps, 0, input.right)
      const effected: StereoOut = {
        left: el.add(el.mul(input.left, dry), el.mul(wetL, mix)),
        right: el.add(el.mul(input.right, dry), el.mul(wetR, mix)),
      }
      return bypassable(effected)
    }

    // ── Echo (delay + feedback) ─────────────────────────────
    case 'echo': {
      // Ticks as a live ref so the Time slider retunes without a recompile.
      const timeTicks = k('time', p.time ?? 1.25)
      const timeSamps = tickTimeSamps(timeTicks, rowHzNode)
      const fb = k('feedback', p.feedback ?? 0.25)
      const mix = k('mix', p.mix ?? 0.5)
      const wetL = el.delay({ key: `${channelId}:${fx.id}:L`, size: TICK_DELAY_SIZE }, timeSamps, fb, input.left)
      const wetR = el.delay({ key: `${channelId}:${fx.id}:R`, size: TICK_DELAY_SIZE }, timeSamps, fb, input.right)
      // Dry always passes at full level — mix scales only the wet, so the
      // first sound after silence isn't attenuated while the loop charges.
      const effected: StereoOut = {
        left: el.add(input.left, el.mul(wetL, mix)),
        right: el.add(input.right, el.mul(wetR, mix)),
      }
      return bypassable(effected)
    }

    // ── Stereo Delay (ping-pong) ───────────────────────────
    case 'delayS': {
      // Ticks as a live ref so the Time slider retunes without a recompile.
      const timeTicks = k('time', p.time ?? 1.25)
      const timeSamps = tickTimeSamps(timeTicks, rowHzNode)
      const mix = k('mix', p.mix ?? 0.5)
      const pp = k('pingpong', p.pingpong ?? 0)
      const invPp = el.sub(el.const({ value: 1 }), pp)
      const tapL = el.delay({ key: `${channelId}:${fx.id}:L`, size: TICK_DELAY_SIZE }, timeSamps, 0, input.left)
      const tapR = el.delay({ key: `${channelId}:${fx.id}:R`, size: TICK_DELAY_SIZE }, timeSamps, 0, input.right)
      // pp blends each side's repeat between its own and the opposite channel.
      const wetL = el.add(el.mul(tapL, invPp), el.mul(tapR, pp))
      const wetR = el.add(el.mul(tapR, invPp), el.mul(tapL, pp))
      // Dry passes at full level; mix scales only the wet.
      const effected: StereoOut = {
        left: el.add(input.left, el.mul(wetL, mix)),
        right: el.add(input.right, el.mul(wetR, mix)),
      }
      return bypassable(effected)
    }

    // ── Stereo Echo (ping-pong + feedback) ─────────────────
    case 'echoS': {
      // Ticks as a live ref so the Time slider retunes without a recompile.
      const timeTicks = k('time', p.time ?? 1.25)
      const timeSamps = tickTimeSamps(timeTicks, rowHzNode)
      const time2 = el.mul(timeSamps, el.const({ value: 2 }))
      const fb = k('feedback', p.feedback ?? 0.25)
      const fb2 = el.mul(fb, fb)
      const mix = k('mix', p.mix ?? 0.5)
      const pp = k('pingpong', p.pingpong ?? 0)
      const invPp = el.sub(el.const({ value: 1 }), pp)

      // Plain per-channel echo at pp=0.
      const plainL = el.delay({ key: `${channelId}:${fx.id}:pL`, size: TICK_DELAY_SIZE }, timeSamps, fb, input.left)
      const plainR = el.delay({ key: `${channelId}:${fx.id}:pR`, size: TICK_DELAY_SIZE }, timeSamps, fb, input.right)

      // Ping-pong network: the first repeat crosses at T, then alternates
      // every T — per-channel 2T lines with fb² loop gain, fed by the input
      // plus the other side's first cross repeat.
      const crossL = el.delay({ key: `${channelId}:${fx.id}:xL`, size: TICK_DELAY_SIZE }, timeSamps, 0, input.left)
      const crossR = el.delay({ key: `${channelId}:${fx.id}:xR`, size: TICK_DELAY_SIZE }, timeSamps, 0, input.right)
      const ppL = el.delay({ key: `${channelId}:${fx.id}:ppL`, size: TICK_DELAY_SIZE }, time2, fb2, el.add(input.left, el.mul(crossR, fb)))
      const ppR = el.delay({ key: `${channelId}:${fx.id}:ppR`, size: TICK_DELAY_SIZE }, time2, fb2, el.add(input.right, el.mul(crossL, fb)))

      const wetL = el.add(el.mul(plainL, invPp), el.mul(el.add(crossR, ppL), pp))
      const wetR = el.add(el.mul(plainR, invPp), el.mul(el.add(crossL, ppR), pp))
      // Dry passes at full level; mix scales only the wet.
      const effected: StereoOut = {
        left: el.add(input.left, el.mul(wetL, mix)),
        right: el.add(input.right, el.mul(wetR, mix)),
      }
      return bypassable(effected)
    }

    // ── FDN Reverb (Jot-style, srvb port) ───────────────────
    case 'reverb': {
      const roomSize = k('roomSize', p.roomSize ?? 0.5)
      const feedback = k('feedback', p.feedback ?? 0.45)
      const damping = k('damping', p.damping ?? 0.5)
      const stereoWidth = k('stereoWidth', p.stereoWidth ?? 0.6)
      const wetMix = k('mix', p.mix ?? 0.35)

      const effected = makeFdnReverb(
        `chan:${channelId}:${fx.id}`,
        roomSize, feedback, damping, stereoWidth, wetMix,
        input.left, input.right,
      )
      return bypassable(effected)
    }

    // ── Compressor (stereo-linked) ─────────────────────────
    case 'comp': {
      const mode = k('mode', p.mode ?? 1)
      const threshold = k('threshold', p.threshold ?? -20)
      const ratio = k('ratio', p.ratio ?? 4)
      const attack = k('attack', p.attack ?? 10)
      const release = k('release', p.release ?? 100)
      const knee = k('knee', p.knee ?? 6)
      const makeup = k('makeup', p.makeup ?? 0)

      // Shared detection: both channels feed one sidechain (mono sum × ½, so
      // a centered mono source still reads 0 dB) and get identical gain
      // reduction. Detection is BEFORE makeup gain.
      const sidechain = el.mul(el.add(input.left, input.right), el.const({ value: 0.5 }))
      // knee=0 → /0 inside skcompress; NaN propagates through el.select.
      const kneeSafe = el.max(knee, el.const({ value: 0.01 }))
      const modeSel = el.le(mode, el.const({ value: 0.5 }))
      const compL = el.select(
        modeSel,
        el.compress(attack, release, threshold, ratio, sidechain, input.left),
        el.skcompress(attack, release, threshold, ratio, kneeSafe, sidechain, input.left),
      )
      const compR = el.select(
        modeSel,
        el.compress(attack, release, threshold, ratio, sidechain, input.right),
        el.skcompress(attack, release, threshold, ratio, kneeSafe, sidechain, input.right),
      )
      const effected: StereoOut = {
        left: el.mul(el.db2gain(makeup), compL),
        right: el.mul(el.db2gain(makeup), compR),
      }
      return bypassable(effected)
    }

    // ── Convolution (IR) Reverb ────────────────────────────
    case 'conv': {
      const idx = Math.round(p.sampleIndex ?? 0)
      const meta = idx >= 0 && idx < sampleMeta.length ? sampleMeta[idx] : null
      // Missing/unloaded IR → pass through untouched rather than silence.
      if (!meta?.hash) return input
      const mix = k('mix', p.mix ?? 0.5)
      const gain = k('gain', p.gain ?? 1)
      const dry = el.sub(el.const({ value: 1 }), mix)
      // L1-normalize: dividing wet by Σ|IR| guarantees it can never exceed
      // the dry peak, whatever sample is used as the impulse response.
      const norm = meta.l1 && meta.l1 > 0 ? el.const({ value: 1 / meta.l1 }) : el.const({ value: 1 })
      const convSide = (sig: NodeRepr_t, sideKey: string): NodeRepr_t =>
        el.mul(el.convolve({ key: `${channelId}:${fx.id}:${sideKey}:${meta.hash}`, path: meta.hash }, sig), norm, gain)

      // Legacy per-side instances (docs from before conv became stereo):
      // only that channel is processed, the other passes through.
      if (side) {
        const effected: StereoOut = {
          left: el.add(el.mul(input.left, dry), el.mul(convSide(input.left, 'L'), mix)),
          right: el.add(el.mul(input.right, dry), el.mul(convSide(input.right, 'R'), mix)),
        }
        return bypassable(
          side === 'L' ? { left: effected.left, right: input.right } : { left: input.left, right: effected.right },
        )
      }

      // Stereo instance: convolve both channels, then width-process the wet pair.
      const w = k('width', p.width ?? 1)
      const wetL0 = convSide(input.left, 'L')
      const wetR0 = convSide(input.right, 'R')
      const mid = el.mul(el.const({ value: 0.5 }), el.add(wetL0, wetR0))
      const sideWet = el.mul(el.const({ value: 0.5 }), el.sub(wetL0, wetR0))
      // Haas pseudo-side past width 1 so mono sources spread too.
      const spread = el.max(el.const({ value: 0 }), el.sub(w, el.const({ value: 1 })))
      const pseudo = el.delay({ key: `${channelId}:${fx.id}:wspread`, size: HAAS_DELAY_SIZE }, el.const({ value: HAAS_DELAY_SAMPLES }), 0, mid)
      const wetL = el.add(mid, el.mul(w, sideWet), el.mul(spread, pseudo))
      const wetR = el.sub(mid, el.mul(w, sideWet), el.mul(spread, pseudo))
      const effected: StereoOut = {
        left: el.add(el.mul(input.left, dry), el.mul(wetL, mix)),
        right: el.add(el.mul(input.right, dry), el.mul(wetR, mix)),
      }
      return bypassable(effected)
    }

    // ── Stereo Width (mid/side + Haas) ─────────────────────
    case 'width': {
      const w = k('width', p.width ?? 1)
      const mid = el.mul(el.const({ value: 0.5 }), el.add(input.left, input.right))
      const sideReal = el.mul(el.const({ value: 0.5 }), el.sub(input.left, input.right))
      // Pseudo-side for mono sources (Haas): a delayed copy of mid, injected
      // only past width 1. L+R still sums to 2×mid, so mono stays compatible.
      const spread = el.max(el.const({ value: 0 }), el.sub(w, el.const({ value: 1 })))
      const pseudo = el.delay({ key: `${channelId}:${fx.id}:spread`, size: 2048 }, el.const({ value: HAAS_DELAY_SAMPLES }), 0, mid)
      const effected: StereoOut = {
        left: el.add(mid, el.mul(w, sideReal), el.mul(spread, pseudo)),
        right: el.sub(mid, el.mul(w, sideReal), el.mul(spread, pseudo)),
      }
      return bypassable(effected)
    }

    default:
      return input
  }
}

/** Apply stereo pan/balance using a param ref so pan changes don't recompile the graph.
 *  panRef should be a ref or const node in range -1..+1 (0 = center).
 *  Constant-power law: angle = (pan + 1) * π/4, left = cos(angle) * √2, right = sin(angle) * √2. */
export function applyPan(input: StereoOut, panNode: NodeRepr_t): StereoOut {
  const one = el.const({ value: 1 })
  const angle = el.mul(el.add(panNode, one), el.const({ value: Math.PI / 4 }))
  return {
    left: el.mul(input.left, el.cos(angle), el.const({ value: Math.SQRT2 })),
    right: el.mul(input.right, el.sin(angle), el.const({ value: Math.SQRT2 })),
  }
}

/** Create a param ref for channel or instrument pan. */
export function panRef(
  key: string,
  value: number,
  paramRefs?: ParamRefRegistry,
): NodeRepr_t {
  return kconst(key, value, paramRefs)
}

/** Apply channel volume (0..2, 1 = unity) and pan to a stereo pair.
 *  Both volume and pan use param refs so fader moves are instant. */
export function applyChannelMix(
  input: StereoOut,
  volume: number,
  pan: number,
  channelId: string,
  paramRefs?: ParamRefRegistry,
): StereoOut {
  const volRef = kconst(`chan:${channelId}:volume`, volume, paramRefs)
  const p = kconst(`chan:${channelId}:pan`, pan, paramRefs)
  const panned = applyPan(input, p)
  return {
    left: el.mul(panned.left, volRef),
    right: el.mul(panned.right, volRef),
  }
}
