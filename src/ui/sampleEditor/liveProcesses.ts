import { fadeRange, gainRange, insertAt, repitchRange, type PcmData } from '../../audio/sampleEdit'
import { crushRange, driveRange, smoothRange } from '../../audio/sampleProcess'
import { targetRange, type EditState } from './editCommands'
import type { Sel } from './selectionGestures'

export type LiveProcessKind = 'insertSilence' | 'volume' | 'fadeIn' | 'fadeOut' | 'pitch' | 'smooth' | 'drive' | 'crush'

export interface LiveContext {
  sampleRate: number
  /** Frames per cycle when the sample is a single cycle or wavetable. */
  cycleLength?: number
}

export interface LiveParam {
  key: string
  label: string
  min: number
  max: number
  step: number
  initial: number
  unit: string
  /** Extra readout next to the value, e.g. the frequency it amounts to. */
  describe?: (v: number, ctx: LiveContext) => string
}

/** A process tuned with sliders and heard while tuning, before it is committed. */
export interface LiveProcessDef {
  kind: LiveProcessKind
  title: string
  /** Inserts at the cursor (or the selection start) instead of processing a range. */
  atCursor?: boolean
  params: LiveParam[]
  apply: (pcm: PcmData, range: Sel, values: Record<string, number>, ctx: LiveContext) => PcmData
}

const SMOOTH_OCTAVES = 10

/** Cutoff in cycles per frame: Nyquist at 0%, ten octaves lower at 100%. */
export function smoothCutoff(amount: number): number {
  return 0.5 * Math.pow(2, -SMOOTH_OCTAVES * amount / 100)
}

/** Drive gain: near-linear at 0%, hard saturation at 100%. */
export function driveGain(amount: number): number {
  return 0.01 + 31.99 * Math.pow(amount / 100, 2)
}

const formatHz = (hz: number) => hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`

/** A whole run of cycles is filtered cycle by cycle, so the loop point stays seamless. */
const cyclePeriod = (pcm: PcmData, range: Sel, ctx: LiveContext) =>
  ctx.cycleLength && range.start === 0 && range.end === pcm[0].length ? ctx.cycleLength : undefined

const fade = (kind: 'fadeIn' | 'fadeOut', title: string, from: number, to: number): LiveProcessDef => ({
  kind,
  title,
  params: [
    { key: 'from', label: 'Begin', min: 0, max: 100, step: 1, initial: from, unit: '%' },
    { key: 'to', label: 'End', min: 0, max: 100, step: 1, initial: to, unit: '%' },
  ],
  apply: (pcm, r, v) => v.from === 100 && v.to === 100 ? pcm : fadeRange(pcm, r.start, r.end, v.from / 100, v.to / 100),
})

export const LIVE_PROCESSES: Record<LiveProcessKind, LiveProcessDef> = {
  insertSilence: {
    kind: 'insertSilence',
    title: 'Insert Silence',
    atCursor: true,
    params: [{ key: 'ms', label: 'Length', min: 0, max: 2000, step: 1, initial: 100, unit: 'ms',
      describe: (v, ctx) => `${silenceFrames(v, ctx).toLocaleString()} frames` }],
    apply: (pcm, r, v, ctx) => {
      const n = silenceFrames(v.ms, ctx)
      return n === 0 ? pcm : insertAt(pcm, r.start, pcm.map(() => new Float32Array(n)))
    },
  },
  volume: {
    kind: 'volume',
    title: 'Volume',
    params: [{ key: 'percent', label: 'Volume', min: 0, max: 400, step: 1, initial: 100, unit: '%',
      describe: (v) => v === 0 ? '−∞ dB' : `${(20 * Math.log10(v / 100)).toFixed(1)} dB` }],
    apply: (pcm, r, v) => v.percent === 100 ? pcm : gainRange(pcm, r.start, r.end, v.percent / 100),
  },
  fadeIn: fade('fadeIn', 'Fade In', 0, 100),
  fadeOut: fade('fadeOut', 'Fade Out', 100, 0),
  pitch: {
    kind: 'pitch',
    title: 'Pitch',
    params: [{ key: 'semitones', label: 'Pitch', min: -48, max: 48, step: 0.1, initial: 0, unit: 'st',
      describe: () => 'changes the length' }],
    apply: (pcm, r, v) => repitchRange(pcm, r.start, r.end, v.semitones),
  },
  smooth: {
    kind: 'smooth',
    title: 'Smooth',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 100, step: 0.5, initial: 30, unit: '%',
      describe: (v, ctx) => v === 0 ? 'off' : formatHz(smoothCutoff(v) * ctx.sampleRate) }],
    apply: (pcm, r, v, ctx) => v.amount <= 0 ? pcm : smoothRange(pcm, r.start, r.end, smoothCutoff(v.amount), cyclePeriod(pcm, r, ctx)),
  },
  drive: {
    kind: 'drive',
    title: 'Drive',
    params: [{ key: 'amount', label: 'Drive', min: 0, max: 100, step: 0.5, initial: 30, unit: '%' }],
    apply: (pcm, r, v) => v.amount <= 0 ? pcm : driveRange(pcm, r.start, r.end, driveGain(v.amount)),
  },
  crush: {
    kind: 'crush',
    title: 'Crush',
    params: [
      { key: 'bits', label: 'Bits', min: 1, max: 16, step: 1, initial: 8, unit: 'bit' },
      { key: 'hold', label: 'Rate', min: 1, max: 32, step: 1, initial: 1, unit: '÷',
        describe: (v, ctx) => v === 1 ? 'full rate' : formatHz(ctx.sampleRate / v) },
    ],
    apply: (pcm, r, v) => crushRange(pcm, r.start, r.end, v.bits, v.hold),
  },
}

const silenceFrames = (ms: number, ctx: LiveContext) => Math.round(ms * ctx.sampleRate / 1000)

/** Where a process applies: a point for inserts, else the selection or the whole sample. */
export function processRange(def: LiveProcessDef, st: EditState): Sel {
  if (!def.atCursor) return targetRange(st)
  const at = st.sel?.start ?? st.cursor ?? 0
  return { start: at, end: at }
}

/** The selection once a process changed its range's length by `grown` frames: the new range, if anything was selected or inserted. */
export function processedSel(sel: Sel | null, range: Sel, grown: number): Sel | null {
  if (!grown || (!sel && range.start !== range.end)) return sel
  return { start: range.start, end: range.end + grown }
}

export function isLiveProcess(kind: string): kind is LiveProcessKind {
  return Object.hasOwn(LIVE_PROCESSES, kind)
}

export function initialValues(def: LiveProcessDef): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.initial]))
}
