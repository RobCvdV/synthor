/**
 * Mixer engine — channel-level effect processing and routing.
 *
 * Pure functions: no React, no Zustand, no AudioContext. Takes Elementary
 * nodes in, returns Elementary nodes out. Reuses effect compilation patterns
 * from `engine/modular.ts` but adapted for stereo channel processing.
 */

import { el, type NodeRepr_t } from '@elemaudio/core'
import type { ChannelEffect } from '../domain/types'
import type { StereoOut } from './modular'
import type { ParamRefRegistry } from '../audio/paramRefs'

type Node = NodeRepr_t | number

/** Maximum delay buffer in samples — 4 seconds at 44.1 kHz (matches modular.ts). */
const DELAY_SIZE = 176400

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
): StereoOut {
  let out = input
  for (const fx of effects) {
    out = compileOneEffect(fx, out, channelId, paramRefs)
  }
  return out
}

/** Compile a single channel effect, stereo in → stereo out. */
function compileOneEffect(
  fx: ChannelEffect,
  input: StereoOut,
  channelId: string,
  paramRefs?: ParamRefRegistry,
): StereoOut {
  const p = fx.params
  const key = (name: string) => chanRefKey(channelId, fx.id, name)
  const k = (name: string, value: number) => kconst(key(name), value, paramRefs)

  switch (fx.type) {
    // ── Filter ──────────────────────────────────────────────
    case 'filter': {
      if (p.bypass) return input
      const cutoff = k('cutoff', p.cutoff ?? 1200)
      const q = k('q', p.q ?? 0.7)
      const mode = k('mode', p.mode ?? 0)
      // Three parallel SVFs per channel, selected by mode ref.
      const chan = (side: 'L' | 'R', sig: NodeRepr_t): NodeRepr_t => {
        const svfKey = `${channelId}:${fx.id}:${side}`
        const lp = el.svf({ key: `${svfKey}:lp`, mode: 'lowpass' }, cutoff, q, sig)
        const hp = el.svf({ key: `${svfKey}:hp`, mode: 'highpass' }, cutoff, q, sig)
        const bp = el.svf({ key: `${svfKey}:bp`, mode: 'bandpass' }, cutoff, q, sig)
        return el.select(
          el.le(mode, el.const({ value: 0.5 })), lp,
          el.select(el.le(mode, el.const({ value: 1.5 })), hp, bp),
        )
      }
      return { left: chan('L', input.left), right: chan('R', input.right) }
    }

    // ── Gain ────────────────────────────────────────────────
    case 'gain': {
      if (p.bypass) return input
      const level = k('level', p.level ?? 0.8)
      return { left: el.mul(input.left, level), right: el.mul(input.right, level) }
    }

    // ── Saturator (tanh) ────────────────────────────────────
    case 'tanh': {
      if (p.bypass) return input
      const drive = k('drive', p.drive ?? 4)
      const level = k('level', p.level ?? 1)
      return {
        left: el.mul(el.tanh(el.mul(input.left, drive)), level),
        right: el.mul(el.tanh(el.mul(input.right, drive)), level),
      }
    }

    // ── Hard Clip ───────────────────────────────────────────
    case 'clip': {
      if (p.bypass) return input
      const drive = k('drive', p.drive ?? 4)
      const threshold = k('threshold', p.threshold ?? 0.7)
      const level = k('level', p.level ?? 0.7)
      const neg = el.sub(el.const({ value: 0 }), threshold)
      const clipChan = (sig: NodeRepr_t): NodeRepr_t => {
        const driven = el.mul(sig, drive)
        return el.mul(el.max(neg, el.min(threshold, driven)), level)
      }
      return { left: clipChan(input.left), right: clipChan(input.right) }
    }

    // ── Wave Folder ─────────────────────────────────────────
    case 'fold': {
      if (p.bypass) return input
      const drive = k('drive', p.drive ?? 3)
      const threshold = k('threshold', p.threshold ?? 0.35)
      const level = k('level', p.level ?? 0.7)
      const neg = el.sub(el.const({ value: 0 }), threshold)
      const two = el.const({ value: 2 })
      const foldChan = (sig: NodeRepr_t): NodeRepr_t => {
        const driven = el.mul(sig, drive)
        const overPos = el.ge(driven, threshold)
        const overNeg = el.le(driven, neg)
        const folded = el.select(
          overPos,
          el.sub(el.mul(two, threshold), driven),
          el.select(overNeg, el.sub(el.mul(two, neg), driven), driven),
        )
        return el.mul(folded, level)
      }
      return { left: foldChan(input.left), right: foldChan(input.right) }
    }

    // ── Bit Crusher ─────────────────────────────────────────
    case 'crush': {
      if (p.bypass) return input
      const bits = k('bits', p.bits ?? 4)
      const level = k('level', p.level ?? 1)
      const steps = el.pow(el.const({ value: 2 }), el.sub(bits, el.const({ value: 1 })))
      const crushChan = (sig: NodeRepr_t): NodeRepr_t => {
        const q = el.div(el.round(el.mul(sig, steps)), steps)
        return el.mul(q, level)
      }
      return { left: crushChan(input.left), right: crushChan(input.right) }
    }

    // ── Single-tap Delay ────────────────────────────────────
    case 'delay': {
      if (p.bypass) return input
      const timeSamps = el.ms2samps(k('time', p.time ?? 150))
      const mix = k('mix', p.mix ?? 0.5)
      const dry = el.sub(el.const({ value: 1 }), mix)
      const wetL = el.delay({ key: `${channelId}:${fx.id}:L`, size: DELAY_SIZE }, timeSamps, 0, input.left)
      const wetR = el.delay({ key: `${channelId}:${fx.id}:R`, size: DELAY_SIZE }, timeSamps, 0, input.right)
      return {
        left: el.add(el.mul(input.left, dry), el.mul(wetL, mix)),
        right: el.add(el.mul(input.right, dry), el.mul(wetR, mix)),
      }
    }

    // ── Echo (delay + feedback) ─────────────────────────────
    case 'echo': {
      if (p.bypass) return input
      const timeSamps = el.ms2samps(k('time', p.time ?? 150))
      const fb = k('feedback', p.feedback ?? 0.25)
      const mix = k('mix', p.mix ?? 0.5)
      const dry = el.sub(el.const({ value: 1 }), mix)
      const wetL = el.delay({ key: `${channelId}:${fx.id}:L`, size: DELAY_SIZE }, timeSamps, fb, input.left)
      const wetR = el.delay({ key: `${channelId}:${fx.id}:R`, size: DELAY_SIZE }, timeSamps, fb, input.right)
      return {
        left: el.add(el.mul(input.left, dry), el.mul(wetL, mix)),
        right: el.add(el.mul(input.right, dry), el.mul(wetR, mix)),
      }
    }

    // ── Stereo Reverb ───────────────────────────────────────
    case 'reverb': {
      if (p.bypass) return input
      const roomSize = k('roomSize', p.roomSize ?? 0.5)
      const feedback = k('feedback', p.feedback ?? 0.45)
      const damping = k('damping', p.damping ?? 0.5)
      const stereoWidth = k('stereoWidth', p.stereoWidth ?? 0.6)
      const wetMix = k('mix', p.mix ?? 0.35)

      const baseTimes = [29.7, 37.1, 41.3, 43.7]
      const stereoOff = [1.3, 2.1, 0.9, 1.7]

      function buildChannel(side: 'L' | 'R', sig: NodeRepr_t): Node {
        const offsetMul = side === 'R' ? stereoWidth : el.const({ value: 0 })

        const combs = baseTimes.map((base, i) => {
          const off = el.mul(el.const({ value: stereoOff[i] }), offsetMul)
          const timeMs = el.mul(el.add(el.const({ value: base }), off), roomSize)
          const timeSamps = el.ms2samps(timeMs)

          const dampHi = el.const({ value: 16000 })
          const dampLo = el.const({ value: 400 })
          const dampFreq = el.add(dampLo, el.mul(el.sub(el.const({ value: 1 }), damping), el.sub(dampHi, dampLo)))
          const damped = el.svf(
            { key: `${channelId}:${fx.id}:damp${side}${i}`, mode: 'lowpass' },
            dampFreq,
            el.const({ value: 0.5 }),
            sig,
          )
          return el.delay(
            { key: `${channelId}:${fx.id}:comb${side}${i}`, size: DELAY_SIZE },
            timeSamps,
            feedback,
            damped,
          )
        })

        const combSum = el.mul(
          combs.reduce((a, b) => el.add(a, b), el.const({ value: 0 })),
          el.const({ value: 0.35 }),
        )

        const toneHi = el.const({ value: 14000 })
        const toneLo = el.const({ value: 800 })
        const toneFreq = el.add(toneLo, el.mul(el.sub(el.const({ value: 1 }), damping), el.sub(toneHi, toneLo)))
        return el.svf(
          { key: `${channelId}:${fx.id}:tone${side}`, mode: 'lowpass' },
          toneFreq,
          el.const({ value: 0.5 }),
          combSum,
        )
      }

      const wetL = buildChannel('L', input.left)
      const wetR = buildChannel('R', input.right)
      const dryGain = el.sub(el.const({ value: 1 }), wetMix)

      return {
        left: el.add(el.mul(input.left, dryGain), el.mul(wetL, wetMix)),
        right: el.add(el.mul(input.right, dryGain), el.mul(wetR, wetMix)),
      }
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
