import { el, type NodeRepr_t } from '@elemaudio/core'
import type { Doc, Id, SampleEntity } from '../domain/types'
import { MASTER_CHANNEL_ID } from '../domain/types'
import { isBuiltinLaneType } from '../domain/effects'
import { midiToFreq } from '../domain/notes'
import { buildSequences } from './sequences'
import { renderDrumKitSlot, renderInstrument } from './instruments'
import { buildEffectSignals } from './effects'
import type { StereoOut } from './modular'
import { applyPan, applyChannelMix, compileChannelEffects } from './mixer'
import type { ArrangementItem } from './arrangement'
import { LIVE_VOICE_COUNT } from './voicePool'

/** Pad a sequence array into a larger timeline, placing the data at `startRow`.
 *  Rows before and after are filled with `padValue`. Used for flattened
 *  arrangements where each pattern occupies only its window within the total. */
function padSeq(seq: number[], startRow: number, totalRows: number, padValue = 0): number[] {
  const out = new Array(totalRows).fill(padValue)
  for (let i = 0; i < seq.length; i++) out[startRow + i] = seq[i]
  return out
}

/** Build the sorted sample metadata list for sampleIndex → VFS key + channels resolution.
 *  Only includes samples whose data is actually loaded in Elementary's VFS. */
function buildSampleMeta(
  samples: Record<Id, SampleEntity>,
  vfsLoaded?: Set<string>,
): { hash: string; channels: number; sampleRate: number; frames: number }[] {
  return Object.values(samples)
    .filter((s) => !vfsLoaded || vfsLoaded.has(s.hash))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ hash: s.hash, channels: s.channels, sampleRate: s.sampleRate, frames: s.frames }))
}

/** Build a sampleId → hash lookup for drumkit slot resolution. */
function buildSampleHashById(samples: Record<Id, SampleEntity>): Record<Id, string> {
  const map: Record<Id, string> = {}
  for (const [id, s] of Object.entries(samples)) {
    map[id] = s.hash
  }
  return map
}

/** Everything the compiler needs from the transport, as plain data. */
export interface RenderContext {
  /** Rows advanced per second (from tempo). */
  rowHz: number
  /** 1 while playing, 0 when stopped (silences output without tearing down). */
  playing: number
  /** Pattern row at which playback started (0 = top, or cursor row). */
  startRow: number
  /** Incremented on each play start so the audio graph gets fresh clock/seq2 nodes. */
  playEpoch: number
  /** Muted track ids. Muted voices are gained to 0 but kept in the graph so
   *  their sequencer phase is preserved across mute/unmute. */
  mutedTracks?: Record<string, boolean>
  /** Hashes of samples successfully loaded into Elementary's VFS.
   *  Sample entities whose hashes aren't in this set are skipped. */
  vfsLoadedHashes?: Set<string>
  /** MIDI CC values, keyed by CC number (0-127).  Used by `midicc` source modules. */
  midiCcValues?: Record<number, number>
  /** Param ref registry for zero-recompile value updates. */
  paramRefs?: import('../audio/paramRefs').ParamRefRegistry
  /** CC# → ref-key mapping, populated during compile so MIDI CC changes
   *  update the right refs without a recompile. */
  ccBindings?: import('../audio/ccBindings').CcBindings
  /** When provided with >1 items, compile a flattened graph spanning all
   *  patterns in the arrangement instead of compiling just doc.patternId.
   *  Pattern switches within the arrangement require zero recompile. */
  arrangement?: ArrangementItem[]
  /** Populated during compilation: track → scheduler input channel mapping.
   *  Mutated in-place — useEngine reads it after compileGraph returns to
   *  align buildPlaybackData channel offsets with the compiled graph. */
  trackChannels?: Map<Id, { offset: number; count: number; instId: Id }>
}

/**
 * Voice slots for EVERY instrument — compiled once at graph build time.
 * Keyboard preview, MIDI input, and tracker scheduler all write to the
 * same refs directly. No recompile needed for any note event.
 *
 * Ref keys match VoicePool exactly:
 *   Osc/modular:  ${instId}:v:${i}:freq, :gate, :vel
 *   Drumkit:      ${instId}:ds:${si}:v${sv}:freq, :gate, :vel
 */
function compileAllVoiceSlots(
  doc: Doc,
  paramRefs: RenderContext['paramRefs'],
  sampleMeta: ReturnType<typeof buildSampleMeta>,
  sampleHashById: Record<Id, string>,
  midiCcValues?: Record<number, number>,
  ccBindings?: RenderContext['ccBindings'],
): StereoOut | null {
  if (!paramRefs) return null

  const voiceCount = LIVE_VOICE_COUNT
  const lvZero = el.const({ key: 'lv:zero', value: 0 })
  const defaultFreq = midiToFreq(69) // 440 Hz (A4)

  let allLeft: NodeRepr_t = lvZero
  let allRight: NodeRepr_t = lvZero

  for (const inst of Object.values(doc.entities.instruments)) {
    if (inst.kind === 'drumkit') {
      const subVoicesPerSlot = 2
      let kitL: NodeRepr_t = lvZero
      let kitR: NodeRepr_t = lvZero
      for (let si = 0; si < inst.slots.length; si++) {
        for (let sv = 0; sv < subVoicesPerSlot; sv++) {
          const voiceKey = `${inst.id}:ds:${si}:v${sv}`
          const freq = paramRefs.getOrCreate(`${voiceKey}:freq`, defaultFreq)
          const gate = paramRefs.getOrCreate(`${voiceKey}:gate`, 0)
          const velRef = paramRefs.getOrCreate(`${voiceKey}:vel`, 1)
          const voice = renderDrumKitSlot(
            inst.slots[si], doc.entities.instruments, gate, freq, voiceKey,
            sampleMeta, sampleHashById, midiCcValues, paramRefs, ccBindings, {}, inst.id,
          )
          kitL = el.add(kitL, el.mul(voice.left, velRef))
          kitR = el.add(kitR, el.mul(voice.right, velRef))
        }
      }
      const masterGain = paramRefs.getOrCreate(`${inst.id}:masterGain`, inst.params.gain)
      allLeft = el.add(allLeft, el.mul(kitL, 0.3, masterGain))
      allRight = el.add(allRight, el.mul(kitR, 0.3, masterGain))
    } else {
      // Osc / modular: one signal chain per voice slot.
      const slotVoices: StereoOut[] = []
      for (let i = 0; i < voiceCount; i++) {
        const voiceKey = `${inst.id}:v:${i}`
        const freq = paramRefs.getOrCreate(`${voiceKey}:freq`, defaultFreq)
        const gate = paramRefs.getOrCreate(`${voiceKey}:gate`, 0)
        const velRef = paramRefs.getOrCreate(`${voiceKey}:vel`, 1)
        slotVoices.push(renderInstrument(inst, freq, gate, voiceKey, sampleMeta, 0, sampleHashById, 0, velRef, {}, midiCcValues, paramRefs, ccBindings))
      }
      allLeft = el.add(allLeft, el.mul(slotVoices.reduce((a, v) => el.add(a, v.left), lvZero), 0.3))
      allRight = el.add(allRight, el.mul(slotVoices.reduce((a, v) => el.add(a, v.right), lvZero), 0.3))
    }
  }

  if (Object.keys(doc.entities.instruments).length === 0) return null
  return { left: allLeft, right: allRight }
}

/**
 * Rotate an array so that index `offset` becomes index 0.
 * newSeq[i] = oldSeq[(i + offset) % len]
 */
function rotateSeq<T>(seq: T[], offset: number): T[] {
  if (offset === 0 || seq.length === 0) return seq
  const len = seq.length
  const off = ((offset % len) + len) % len
  return seq.slice(off).concat(seq.slice(0, off))
}

/** In flat mode, pad seq to totalRows (no rotation — offset handles startRow).
 *  In per-pattern mode, rotate seq to startRow (current behavior). */
function prepSeq(seq: number[], startRow: number, patternStartRow: number, totalRows: number, isFlat: boolean): number[] {
  if (isFlat) return padSeq(seq, patternStartRow, totalRows, 0)
  return rotateSeq(seq, startRow)
}

/** Create an el.seq2 with optional offset (flat mode).
 *  In flat mode, `flatSuffix` is appended to the key so the same track
 *  appearing at different positions in the arrangement gets distinct nodes. */
function mkSeq2(
  key: string,
  seq: number[],
  clock: NodeRepr_t,
  reset: NodeRepr_t,
  hold: boolean,
  isFlat: boolean,
  startRow: number,
  flatSuffix: number,
): NodeRepr_t {
  const finalKey = isFlat ? `${key}:${flatSuffix}` : key
  const props: Record<string, unknown> = { key: finalKey, seq, hold, loop: true }
  if (isFlat) props.offset = startRow
  return el.seq2(props as Parameters<typeof el.seq2>[0], clock, reset)
}

/**
 * Compile the full document into a stereo pair. No React, no Zustand, no
 * AudioContext — pure, unit-testable, and reusable for offline bounce.
 */
export function compileGraph(doc: Doc, ctx: RenderContext): StereoOut {
  // Re-populated during graph build; clearing first prevents stale registrations.
  ctx.ccBindings?.clear()
  const silence: StereoOut = {
    left: el.const({ value: 0 }),
    right: el.const({ value: 0 }),
  }

  const sampleMeta = buildSampleMeta(doc.entities.samples, ctx.vfsLoadedHashes)
  const sampleHashById = buildSampleHashById(doc.entities.samples)

  // Live voice slots for every instrument — keyboard, MIDI and tracker
  // all write to VoicePool refs. No recompile for any note event.
  const liveOut = compileAllVoiceSlots(doc, ctx.paramRefs, sampleMeta, sampleHashById, ctx.midiCcValues, ctx.ccBindings)

  // Build the arrangement or fall back to the current pattern.  When the
  // arrangement has >1 items we compile a flattened graph spanning all
  // patterns — pattern switches within it require zero recompile.
  const arrangement = ctx.arrangement && ctx.arrangement.length > 0
    ? ctx.arrangement
    : [{ patternId: doc.patternId, startRow: 0 }]
  const isFlat = arrangement.length > 1
  const firstPattern = doc.entities.patterns[arrangement[0].patternId]
  if (!firstPattern) return liveOut ?? silence

  // Total rows in the timeline.  In flat mode this spans every pattern in the
  // arrangement; in single-pattern mode it's just the one pattern.
  const totalRows = isFlat
    ? arrangement.reduce((sum, a) => sum + (doc.entities.patterns[a.patternId]?.length ?? 0), 0)
    : firstPattern.length
  if (totalRows === 0) return liveOut ?? silence

  // Clock key suffix: in flat mode the clock is distinct from per-pattern mode
  // so Elementary doesn't collide with single-pattern graphs.  The clock runs
  // continuously across all arrangement patterns.
  const clockSuffix = isFlat ? ':flat' : ''
  const epochZero = el.const({ key: `train:${ctx.playEpoch}${clockSuffix}`, value: 0 })
  const clockRate = el.add(el.const({ value: ctx.rowHz }), epochZero)
  const rawClock = el.train(clockRate)
  const clock = el.mul(rawClock, ctx.playing)

  // Reset wraps at totalRows.  In flat mode the key is arrangement-agnostic
  // so Elementary preserves the reset train across recompiles (same key).
  const loopHz = ctx.rowHz / totalRows
  const resetSuffix = isFlat ? ':flat' : `:${doc.patternId}`
  const loopEpochZero = el.const({ key: `reset:${ctx.playEpoch}${resetSuffix}`, value: 0 })
  const resetRate = el.add(el.const({ value: loopHz }), loopEpochZero)
  const rawReset = el.train(resetRate)
  const reset = el.mul(rawReset, ctx.playing)

  // Pre-pass: assign scheduler input channel offsets per unique track.
  // Regular tracks get 2 channels (gate, freq); drumkit tracks get
  // 1 channel per slot (gate only — freq is per-slot constant).
  // This MUST match the iteration order in buildPlaybackData.
  if (ctx.trackChannels) ctx.trackChannels.clear()
  let chOffset = 0
  if (ctx.trackChannels) {
    const seen = new Set<Id>()
    for (const item of arrangement) {
      const pat = doc.entities.patterns[item.patternId]
      if (!pat) continue
      for (const tid of pat.trackIds) {
        if (seen.has(tid)) continue
        seen.add(tid)
        const t = doc.entities.tracks[tid]
        const i = t && doc.entities.instruments[t.instrumentId]
        if (!i) continue
        const count = i.kind === 'drumkit' ? i.slots.length : 2
        ctx.trackChannels.set(tid, { offset: chOffset, count, instId: i.id })
        chOffset += count
      }
    }
    console.log('[compile] trackChannels:', chOffset, 'total channels,', seen.size, 'tracks,',
      [...ctx.trackChannels.entries()].slice(0, 5).map(([tid, c]) => `${tid.slice(0,8)}:${c.offset}+${c.count}`))
  }

  const zero = el.const({ value: 0 })
  /** Voice pairs grouped by the instrument's mix channel. */
  const channelVoices = new Map<Id, StereoOut[]>()
  const getChannel = (id: Id): StereoOut[] => {
    let arr = channelVoices.get(id)
    if (!arr) { arr = []; channelVoices.set(id, arr) }
    return arr
  }

  // Iterate every pattern in the arrangement.  Note data (gate/freq) comes
  // from the scheduler AudioWorklet via el.in; effect modulation (vol/pan/
  // LFO/lane) still uses seq2 driven by the graph clock.
  for (const item of arrangement) {
  const pattern = doc.entities.patterns[item.patternId]
  if (!pattern) continue
  for (const trackId of pattern.trackIds) {
    const track = doc.entities.tracks[trackId]
    const inst = doc.entities.instruments[track.instrumentId]
    const muted = ctx.mutedTracks?.[trackId] === true
    const chInfo = ctx.trackChannels?.get(trackId)

    if (inst.kind === 'drumkit') {
      const { volumeSeq, effectLanes: laneSeqs, laneDefs } = buildSequences(track, pattern.length)

      // Effect lane processing (built-in effects apply at mix level).
      const effSig = buildEffectSignals(laneSeqs, laneDefs, pattern.length)

      // Prepare sequences (rotate or pad depending on mode).
      const dkVol = prepSeq(volumeSeq, ctx.startRow, item.startRow, totalRows, isFlat)
      const dkVolMod = prepSeq(effSig.volMod, ctx.startRow, item.startRow, totalRows, isFlat)
      const dkFreqMul = prepSeq(effSig.freqMul, ctx.startRow, item.startRow, totalRows, isFlat)
      const dkPan = prepSeq(effSig.pan, ctx.startRow, item.startRow, totalRows, isFlat)

      // Prepare per-lane sequences.
      const dkLaneSeqs: Record<Id, number[]> = {}
      for (const [laneId, seq] of Object.entries(laneSeqs)) {
        dkLaneSeqs[laneId] = prepSeq(seq, ctx.startRow, item.startRow, totalRows, isFlat)
      }

      // Per-lane seq2 nodes for named instrument inlets.
      const laneNodes: Record<Id, NodeRepr_t> = {}
      for (const [laneId, seq] of Object.entries(dkLaneSeqs)) {
        laneNodes[laneId] = mkSeq2(`${trackId}:eff:${laneId}:${ctx.playEpoch}`, seq, clock, reset, true, isFlat, ctx.startRow, item.startRow)
      }

      // Build inlet name → seq2 node map for named inlets.
      const inletSignals: Record<string, NodeRepr_t> = {}
      for (const lane of laneDefs) {
        if (!isBuiltinLaneType(lane.type)) {
          inletSignals[lane.type] = laneNodes[lane.id]
        }
      }

      // Volume modulation from per-cell volume × effect volume modifiers.
      const vol = mkSeq2(`${trackId}:vol:${ctx.playEpoch}`, dkVol, clock, reset, true, isFlat, ctx.startRow, item.startRow)
      let effVol: NodeRepr_t = el.mul(vol, mkSeq2(`${trackId}:volMod:${ctx.playEpoch}`, dkVolMod, clock, reset, true, isFlat, ctx.startRow, item.startRow))

      // --- Tremolo on drumkit mix ---
      const hasDkTremolo = effSig.tremoloDepth.some((d) => d > 0)
      if (hasDkTremolo) {
        const dkTremRate = prepSeq(effSig.tremoloRate, ctx.startRow, item.startRow, totalRows, isFlat)
        const dkTremDepth = prepSeq(effSig.tremoloDepth, ctx.startRow, item.startRow, totalRows, isFlat)
        const tremRateSeq = mkSeq2(`${trackId}:tremRate:${ctx.playEpoch}`, dkTremRate, clock, reset, true, isFlat, ctx.startRow, item.startRow)
        const tremDepthSeq = mkSeq2(`${trackId}:tremDepth:${ctx.playEpoch}`, dkTremDepth, clock, reset, true, isFlat, ctx.startRow, item.startRow)
        const tremHz = el.mul(0.5, el.exp(el.mul(tremRateSeq, Math.log(100 / 0.5))))
        const tremlfo = el.cycle(tremHz)
        const tremMod = el.sub(1, el.mul(tremDepthSeq, el.sub(1, el.abs(tremlfo))))
        effVol = el.mul(effVol, tremMod)
      }

      // Portamento on mix (applied as freqMul).
      const freqMulSeq = mkSeq2(`${trackId}:freqMul:${ctx.playEpoch}`, dkFreqMul, clock, reset, true, isFlat, ctx.startRow, item.startRow)

      const masterGain = el.const({ value: inst.params.gain })

      let mixL: NodeRepr_t = zero
      let mixR: NodeRepr_t = zero
      for (let si = 0; si < inst.slots.length; si++) {
        const slot = inst.slots[si]
        // Gate from scheduler (el.in); freq from slot's base note × portamento.
        const slotGate = chInfo
          ? el.in({ channel: chInfo.offset + si })
          : el.const({ value: 0 })
        const slotFreq = el.mul(
          el.const({ value: midiToFreq(slot.note + slot.pitchOffset) }),
          freqMulSeq,
        )
        const voice = renderDrumKitSlot(slot, doc.entities.instruments, slotGate, slotFreq, trackId, sampleMeta, sampleHashById, ctx.midiCcValues, ctx.paramRefs, ctx.ccBindings, inletSignals, inst.id)
        mixL = el.add(mixL, voice.left)
        mixR = el.add(mixR, voice.right)
      }

      // Apply per-row panning if any row has a pan effect.
      const hasDkPan = effSig.pan.some((p) => p !== 0.5)
      let dkVoice: StereoOut
      if (hasDkPan && !muted) {
        const panSeq = mkSeq2(`${trackId}:pan:${ctx.playEpoch}`, dkPan, clock, reset, true, isFlat, ctx.startRow, item.startRow)
        const panAngle = el.mul(panSeq, Math.PI / 2)
        dkVoice = { left: el.mul(mixL, effVol, el.cos(panAngle), masterGain), right: el.mul(mixR, effVol, el.sin(panAngle), masterGain) }
      } else {
        dkVoice = muted
          ? { left: el.mul(mixL, 0), right: el.mul(mixR, 0) }
          : { left: el.mul(mixL, effVol, masterGain), right: el.mul(mixR, effVol, masterGain) }
      }
      // Apply instrument-level pan from the mixer (ref-based, no recompile on pan change).
      const dkPanRef = ctx.paramRefs
        ? ctx.paramRefs.getOrCreate(`inst:${inst.id}:pan`, inst.pan ?? 0)
        : el.const({ value: inst.pan ?? 0 })
      getChannel(inst.channelId ?? MASTER_CHANNEL_ID).push(applyPan(dkVoice, dkPanRef))
      continue
    }

    // Osc / modular: gate + freq from scheduler AudioWorklet via el.in,
    // vol/effect lanes/LFO from seq2.
    const { volumeSeq, effectLanes: laneSeqs, laneDefs } = buildSequences(track, pattern.length)
    const firstNote = track.cells.find((c) => c.note != null)?.note
    const trackBaseFreq = firstNote != null ? midiToFreq(firstNote) : 0

    // Per-instrument effect range settings.
    const effSettings = inst.effectSettings

    // Build per-row effect modulation signals from built-in lane types.
    const effSig = buildEffectSignals(laneSeqs, laneDefs, pattern.length, effSettings)

    // Prepare effect sequences (rotate or pad depending on mode).
    const prepVolume = prepSeq(volumeSeq, ctx.startRow, item.startRow, totalRows, isFlat)
    const prepFreqMul = prepSeq(effSig.freqMul, ctx.startRow, item.startRow, totalRows, isFlat)
    const prepVolMod = prepSeq(effSig.volMod, ctx.startRow, item.startRow, totalRows, isFlat)
    const prepPan = prepSeq(effSig.pan, ctx.startRow, item.startRow, totalRows, isFlat)

    // Prepare per-lane sequences.
    const prepLaneSeqs: Record<Id, number[]> = {}
    for (const [laneId, seq] of Object.entries(laneSeqs)) {
      prepLaneSeqs[laneId] = prepSeq(seq, ctx.startRow, item.startRow, totalRows, isFlat)
    }

    // Gate + freq from the scheduler via SharedArrayBuffer → el.in.
    // Elementary's WorkletProcessor.js reads SAB and fills WASM input buffers
    // directly in process() (no Web Audio input port needed).
    if (chInfo) {
      console.log('[compile] track', trackId.slice(0,8), 'el.in gate ch=', chInfo.offset, 'freq ch=', chInfo.offset + 1)
    }
    const gate = chInfo
      ? el.in({ channel: chInfo.offset })
      : el.const({ value: 0 })
    const effFreqBase = chInfo
      ? el.in({ channel: chInfo.offset + 1 })
      : el.const({ value: trackBaseFreq || midiToFreq(69) })
    const freqMulSeq = mkSeq2(`${trackId}:freqMul:${ctx.playEpoch}`, prepFreqMul, clock, reset, true, isFlat, ctx.startRow, item.startRow)
    let effFreq: NodeRepr_t = el.mul(effFreqBase, freqMulSeq)

    const vol = mkSeq2(`${trackId}:vol:${ctx.playEpoch}`, prepVolume, clock, reset, true, isFlat, ctx.startRow, item.startRow)
    let effVol: NodeRepr_t = el.mul(vol, mkSeq2(`${trackId}:volMod:${ctx.playEpoch}`, prepVolMod, clock, reset, true, isFlat, ctx.startRow, item.startRow))

    // --- Vibrato: audio-rate sine LFO for smooth continuous modulation ---
    const hasVibrato = effSig.vibratoDepth.some((d) => d > 0)
    if (hasVibrato) {
      const prepVibRate = prepSeq(effSig.vibratoRate, ctx.startRow, item.startRow, totalRows, isFlat)
      const prepVibDepth = prepSeq(effSig.vibratoDepth, ctx.startRow, item.startRow, totalRows, isFlat)
      const vibRateSeq = mkSeq2(`${trackId}:vibRate:${ctx.playEpoch}`, prepVibRate, clock, reset, true, isFlat, ctx.startRow, item.startRow)
      const vibDepthSeq = mkSeq2(`${trackId}:vibDepth:${ctx.playEpoch}`, prepVibDepth, clock, reset, true, isFlat, ctx.startRow, item.startRow)
      // Exponential: 0..1 → 0.5–max Hz
      const vibMaxHz = effSettings?.vibratoRate ?? 100
      const vibHz = el.mul(0.5, el.exp(el.mul(vibRateSeq, Math.log(vibMaxHz / 0.5))))
      const vibLfo = el.cycle(vibHz)
      // Depth in semitones: ±(max/2)
      const vibMaxDepth = effSettings?.vibratoDepth ?? 0.5
      const vibSemi = el.mul(vibLfo, vibDepthSeq, vibMaxDepth)
      // 2^(semitones/12) via el.exp
      const vibMul = el.exp(el.mul(vibSemi, Math.LN2 / 12))
      effFreq = el.mul(effFreq, vibMul)
    }

    // --- Tremolo: audio-rate sine LFO for smooth amplitude modulation ---
    const hasTremolo = effSig.tremoloDepth.some((d) => d > 0)
    if (hasTremolo) {
      const prepTremRate = prepSeq(effSig.tremoloRate, ctx.startRow, item.startRow, totalRows, isFlat)
      const prepTremDepth = prepSeq(effSig.tremoloDepth, ctx.startRow, item.startRow, totalRows, isFlat)
      const tremRateSeq = mkSeq2(`${trackId}:tremRate:${ctx.playEpoch}`, prepTremRate, clock, reset, true, isFlat, ctx.startRow, item.startRow)
      const tremDepthSeq = mkSeq2(`${trackId}:tremDepth:${ctx.playEpoch}`, prepTremDepth, clock, reset, true, isFlat, ctx.startRow, item.startRow)
      // Exponential: 0..1 → 0.5–max Hz
      const tremMaxHz = effSettings?.tremoloRate ?? 100
      const tremHz = el.mul(0.5, el.exp(el.mul(tremRateSeq, Math.log(tremMaxHz / 0.5))))
      const tremlfo = el.cycle(tremHz)
      // AM: dips at LFO zero crossings, 1 at peaks — depth controls how deep
      const tremMaxDepth = effSettings?.tremoloDepth ?? 1
      const tremMod = el.sub(1, el.mul(tremDepthSeq, el.mul(el.sub(1, el.abs(tremlfo)), tremMaxDepth)))
      effVol = el.mul(effVol, tremMod)
    }

    // Build per-lane seq2 nodes for named instrument inlets.
    const laneNodes: Record<Id, NodeRepr_t> = {}
    for (const [laneId, seq] of Object.entries(prepLaneSeqs)) {
      laneNodes[laneId] = mkSeq2(`${trackId}:eff:${laneId}:${ctx.playEpoch}`, seq, clock, reset, true, isFlat, ctx.startRow, item.startRow)
    }

    // Build inlet name → seq2 node map for named instrument inlets.
    const inletSignals: Record<string, NodeRepr_t> = {}
    for (const lane of laneDefs) {
      if (!isBuiltinLaneType(lane.type)) {
        inletSignals[lane.type] = laneNodes[lane.id]
      }
    }

    const voice = renderInstrument(inst, effFreq, gate, trackId, sampleMeta, 0, sampleHashById, trackBaseFreq, effVol, inletSignals, ctx.midiCcValues, ctx.paramRefs, ctx.ccBindings)

    // Apply per-row panning if any row has a pan effect.
    const hasPan = effSig.pan.some((p) => p !== 0.5)
    let trackVoice: StereoOut
    if (hasPan && !muted) {
      // Convert 0..1 pan values to constant-power stereo gains.
      const panSeq = mkSeq2(`${trackId}:pan:${ctx.playEpoch}`, prepPan, clock, reset, true, isFlat, ctx.startRow, item.startRow)
      const panAngle = el.mul(panSeq, Math.PI / 2)
      trackVoice = { left: el.mul(voice.left, el.cos(panAngle)), right: el.mul(voice.right, el.sin(panAngle)) }
    } else {
      trackVoice = muted
        ? { left: el.mul(voice.left, 0), right: el.mul(voice.right, 0) }
        : voice
    }
    // Apply instrument-level pan from the mixer (ref-based, no recompile on pan change).
    const instPanRef = ctx.paramRefs
      ? ctx.paramRefs.getOrCreate(`inst:${inst.id}:pan`, inst.pan ?? 0)
      : el.const({ value: inst.pan ?? 0 })
    getChannel(inst.channelId ?? MASTER_CHANNEL_ID).push(applyPan(trackVoice, instPanRef))
  }
  } // close arrangement loop

  // ── Channel routing: sum per-channel → effects → vol/pan → master ──
  let masterLeft: NodeRepr_t = zero
  let masterRight: NodeRepr_t = zero

  for (const [chanId, voices] of channelVoices) {
    // Sum all voices routed to this channel.
    const chanSum: StereoOut = {
      left: voices.reduce((acc, v) => el.add(acc, v.left), zero),
      right: voices.reduce((acc, v) => el.add(acc, v.right), zero),
    }

    const channel = doc.entities.mixChannels[chanId]
    if (!channel) {
      // Unknown channel — route directly to master.
      masterLeft = el.add(masterLeft, chanSum.left)
      masterRight = el.add(masterRight, chanSum.right)
      continue
    }

    // Apply channel insert effects, then volume + pan.
    const processed = channel.kind === 'sub' || channel.kind === 'master'
      ? compileChannelEffects(channel.effects, chanSum, chanId, ctx.paramRefs)
      : chanSum

    const mixed = applyChannelMix(processed, channel.volume, channel.pan, chanId, ctx.paramRefs)

    if (channel.kind === 'master') {
      masterLeft = el.add(masterLeft, mixed.left)
      masterRight = el.add(masterRight, mixed.right)
    } else {
      masterLeft = el.add(masterLeft, mixed.left)
      masterRight = el.add(masterRight, mixed.right)
    }
  }

  // Apply master channel effects and volume. The master channel is always present.
  const masterChannel = doc.entities.mixChannels[MASTER_CHANNEL_ID]
  let masterOut: StereoOut = { left: masterLeft, right: masterRight }
  if (masterChannel) {
    masterOut = compileChannelEffects(masterChannel.effects, masterOut, MASTER_CHANNEL_ID, ctx.paramRefs)
    masterOut = applyChannelMix(masterOut, masterChannel.volume, masterChannel.pan, MASTER_CHANNEL_ID, ctx.paramRefs)
  }

  // Master output, gated by the transport:playing ref so play/stop is a
  // ref write instead of a recompile. Live voices sit outside the gate.
  const playingGate = ctx.paramRefs
    ? ctx.paramRefs.getOrCreate('transport:playing', 0)
    : el.const({ value: ctx.playing })
  const patternOut: StereoOut = {
    left: el.mul(masterOut.left, playingGate),
    right: el.mul(masterOut.right, playingGate),
  }

  return liveOut
    ? { left: el.add(patternOut.left, liveOut.left), right: el.add(patternOut.right, liveOut.right) }
    : patternOut
}
