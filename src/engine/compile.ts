import { el, type NodeRepr_t } from '@elemaudio/core'
import type { Doc, Id, SampleEntity, Instrument } from '../domain/types'
import { MASTER_CHANNEL_ID } from '../domain/types'
import { midiToFreq } from '../domain/notes'
import { renderDrumKitSlot, renderInstrument } from './instruments'
import type { StereoOut } from './modular'
import { applyPan, applyChannelMix, compileChannelEffects } from './mixer'
import type { ArrangementItem } from './arrangement'
import { LIVE_VOICE_COUNT } from './voicePool'
import { computeSlotLayouts, REGULAR_CH, DRUMKIT_CH, DRUMKIT_EXTRA_CHANNELS } from './voiceSlotLayout'
import type { InstrumentSlotLayout } from './voiceSlotLayout'

/** Build the sorted sample metadata list for sampleIndex → VFS key + channels resolution. */
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

/** Get the default gain for an instrument, regardless of kind. */
function getInstGain(inst: Instrument): number {
  if (inst.kind === 'modular') return 1
  return inst.params.gain
}

/** Build portamento frequency multiplier from a 0..1 signal (0.5 = center). */
function buildPortamento(sig: NodeRepr_t, maxSemitones: number): NodeRepr_t {
  const half = el.const({ value: 0.5 })
  const semis = el.mul(el.sub(sig, half), 2 * maxSemitones)
  return el.exp(el.mul(semis, Math.LN2 / 12))
}

/** Build a vibrato frequency multiplier from rate/depth el.in signals.
 *  When depth is 0 (default), modulation has no effect. */
function buildVibrato(
  freqBase: NodeRepr_t,
  vibRate: NodeRepr_t,
  vibDepth: NodeRepr_t,
  maxHz: number,
  maxDepth: number,
): NodeRepr_t {
  const vibHz = el.mul(0.5, el.exp(el.mul(vibRate, Math.log(maxHz / 0.5))))
  const vibLfo = el.cycle(vibHz)
  const vibSemi = el.mul(vibLfo, vibDepth, maxDepth)
  const vibMul = el.exp(el.mul(vibSemi, Math.LN2 / 12))
  return el.mul(freqBase, vibMul)
}

/** Build a tremolo volume multiplier from rate/depth el.in signals.
 *  When depth is 0 (default), modulation has no effect. */
function buildTremolo(
  volBase: NodeRepr_t,
  tremRate: NodeRepr_t,
  tremDepth: NodeRepr_t,
  maxHz: number,
  maxDepth: number,
): NodeRepr_t {
  const tremHz = el.mul(0.5, el.exp(el.mul(tremRate, Math.log(maxHz / 0.5))))
  const tremlfo = el.cycle(tremHz)
  const tremMod = el.sub(1, el.mul(tremDepth, el.mul(el.sub(1, el.abs(tremlfo)), maxDepth)))
  return el.mul(volBase, tremMod)
}

/** Everything the compiler needs from the transport, as plain data. */
export interface RenderContext {
  rowHz: number
  playing: number
  startRow: number
  playEpoch: number
  mutedTracks?: Record<string, boolean>
  vfsLoadedHashes?: Set<string>
  midiCcValues?: Record<number, number>
  paramRefs?: import('../audio/paramRefs').ParamRefRegistry
  ccBindings?: import('../audio/ccBindings').CcBindings
  arrangement?: ArrangementItem[]
}

/**
 * Voice slots for EVERY instrument — compiled once at graph build time.
 * Keyboard preview, MIDI input, and tracker scheduler all write to the
 * same refs directly. No recompile needed for any note event.
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
  const defaultFreq = midiToFreq(69)

  let allLeft: NodeRepr_t = lvZero
  let allRight: NodeRepr_t = lvZero

  for (const inst of Object.values(doc.entities.instruments)) {
    if (inst.kind === 'drumkit') {
      const subVoicesPerSlot = 1
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
            sampleMeta, sampleHashById, midiCcValues, paramRefs, ccBindings, {}, inst.id, inst.pan ?? 0,
          )
          kitL = el.add(kitL, el.mul(voice.left, velRef))
          kitR = el.add(kitR, el.mul(voice.right, velRef))
        }
      }
      const masterGain = paramRefs.getOrCreate(`${inst.id}:gain`, inst.params.gain)
      allLeft = el.add(allLeft, el.mul(kitL, 0.3, masterGain))
      allRight = el.add(allRight, el.mul(kitR, 0.3, masterGain))
    } else {
      const slotVoices: StereoOut[] = []
      for (let i = 0; i < voiceCount; i++) {
        const voiceKey = `${inst.id}:v:${i}`
        const freq = paramRefs.getOrCreate(`${voiceKey}:freq`, defaultFreq)
        const gate = paramRefs.getOrCreate(`${voiceKey}:gate`, 0)
        const velRef = paramRefs.getOrCreate(`${voiceKey}:vel`, 1)
        slotVoices.push(renderInstrument(inst, freq, gate, voiceKey, sampleMeta, 0, sampleHashById, velRef, {}, midiCcValues, paramRefs, ccBindings))
      }
      allLeft = el.add(allLeft, el.mul(slotVoices.reduce((a, v) => el.add(a, v.left), lvZero), 0.3))
      allRight = el.add(allRight, el.mul(slotVoices.reduce((a, v) => el.add(a, v.right), lvZero), 0.3))
    }
  }

  if (Object.keys(doc.entities.instruments).length === 0) return null
  return { left: allLeft, right: allRight }
}

/**
 * Compile tracker voice slots with fixed el.in channel positions.
 *
 * Each instrument gets one slot per concurrent track.  The slot's channels are
 * at predetermined positions (see REGULAR_CH / DRUMKIT_CH).  Data flows from
 * the scheduler AudioWorklet → Web Audio routing → el.in → signal processing →
 * mix channels.  Zero recompiles for notes, effects, pattern switches, or
 * play-mode changes.
 */
function compileTrackerVoiceSlots(
  doc: Doc,
  slotLayouts: InstrumentSlotLayout[],
  ctx: RenderContext,
  sampleMeta: ReturnType<typeof buildSampleMeta>,
  sampleHashById: Record<Id, string>,
): Map<Id, StereoOut[]> {
  const zero = el.const({ value: 0 })
  const one = el.const({ value: 1 })
  const channelVoices = new Map<Id, StereoOut[]>()
  const getChannel = (id: Id): StereoOut[] => {
    let arr = channelVoices.get(id)
    if (!arr) { arr = []; channelVoices.set(id, arr) }
    return arr
  }

  for (const layout of slotLayouts) {
    const inst = doc.entities.instruments[layout.instId]
    if (!inst) continue
    const effSettings = inst.kind !== 'drumkit' ? inst.effectSettings : undefined

    for (let si = 0; si < layout.slotCount; si++) {
      const offset = layout.slotBaseChannels[si]
      const trackerKey = `${inst.id}:ts:${si}`

      // ── Named inlet signals (shared between regular and drumkit) ──
      const inletSignals: Record<string, NodeRepr_t> = {}
      if (layout.isDrumkit) {
        const drumSounds = layout.drumSounds ?? 0
        for (let ni = 0; ni < layout.namedInletIds.length; ni++) {
          inletSignals[layout.namedInletIds[ni]] = el.in({
            channel: offset + 2 * drumSounds + DRUMKIT_EXTRA_CHANNELS + ni,
          })
        }
      } else {
        for (let ni = 0; ni < layout.namedInletIds.length; ni++) {
          inletSignals[layout.namedInletIds[ni]] = el.in({ channel: offset + 11 + ni })
        }
      }

      // ── Slot mute ref (for solo/mute without recompile) ──
      const slotMuteRef = ctx.paramRefs
        ? ctx.paramRefs.getOrCreate(`tracker:${trackerKey}:mute`, 1)
        : one

      // Instrument-level gain via ref.
      const masterGain = ctx.paramRefs
        ? ctx.paramRefs.getOrCreate(`${inst.id}:gain`, getInstGain(inst))
        : el.const({ value: getInstGain(inst) })

      // Instrument-level pan via ref.
      const instPanRef = ctx.paramRefs
        ? ctx.paramRefs.getOrCreate(`inst:${inst.id}:pan`, inst.pan ?? 0)
        : el.const({ value: inst.pan ?? 0 })

      if (layout.isDrumkit && inst.kind === 'drumkit') {
        const drumSounds = layout.drumSounds ?? 0
        const effBase = 2 * drumSounds

        // ── Drum gate + freq channels ──
        const drumGates: NodeRepr_t[] = []
        const drumFreqs: NodeRepr_t[] = []
        for (let d = 0; d < drumSounds; d++) {
          drumGates.push(el.in({ channel: offset + d }))
          drumFreqs.push(el.in({ channel: offset + drumSounds + d }))
        }

        // ── Effect channels ──
        const dkVol = el.in({ channel: offset + effBase + DRUMKIT_CH.vol })
        const portamento = el.in({ channel: offset + effBase + DRUMKIT_CH.portamento })
        const freqMul = buildPortamento(portamento, effSettings?.portamento ?? 4)
        const volMod = el.in({ channel: offset + effBase + DRUMKIT_CH.volumeSlide })
        const pan = el.in({ channel: offset + effBase + DRUMKIT_CH.panning })
        const tremRate = el.in({ channel: offset + effBase + DRUMKIT_CH.tremoloRate })
        const tremDepth = el.in({ channel: offset + effBase + DRUMKIT_CH.tremoloDepth })

        // Tremolo on drumkit mix.
        let dkEffVol = buildTremolo(
          volMod, tremRate, tremDepth,
          effSettings?.tremoloRate ?? 100,
          effSettings?.tremoloDepth ?? 1,
        )

        let mixL: NodeRepr_t = zero
        let mixR: NodeRepr_t = zero
        for (let d = 0; d < drumSounds; d++) {
          const dkSlot = inst.slots[d]
          const slotFreq = el.mul(drumFreqs[d], freqMul)
          const voice = renderDrumKitSlot(
            dkSlot, doc.entities.instruments, drumGates[d], slotFreq,
            trackerKey, sampleMeta, sampleHashById,
            ctx.midiCcValues, ctx.paramRefs, ctx.ccBindings,
            inletSignals, inst.id, instPanRef,
          )
          mixL = el.add(mixL, voice.left)
          mixR = el.add(mixR, voice.right)
        }

        // Apply pan, vol, mute.  instPan is already folded into slot-level pan.
        const panAngle = el.mul(pan, Math.PI / 2)
        const dkVoice: StereoOut = {
          left: el.mul(mixL, dkEffVol, dkVol, slotMuteRef, el.cos(panAngle), masterGain, el.const({ value: 0.25 })),
          right: el.mul(mixR, dkEffVol, dkVol, slotMuteRef, el.sin(panAngle), masterGain, el.const({ value: 0.25 })),
        }
        getChannel(inst.channelId ?? MASTER_CHANNEL_ID).push(dkVoice)
      } else {
        // ── Regular instrument slot ──
        const gate = el.in({ channel: offset + REGULAR_CH.gate })
        const freq = el.in({ channel: offset + REGULAR_CH.freq })
        const vol = el.in({ channel: offset + REGULAR_CH.vol })

        // Effect channels.
        const portamento = el.in({ channel: offset + REGULAR_CH.portamento })
        const freqMul = buildPortamento(portamento, effSettings?.portamento ?? 4)
        const volMod = el.in({ channel: offset + REGULAR_CH.volumeSlide })
        const pan = el.in({ channel: offset + REGULAR_CH.panning })
        const vibRate = el.in({ channel: offset + REGULAR_CH.vibratoRate })
        const vibDepth = el.in({ channel: offset + REGULAR_CH.vibratoDepth })
        const tremRate = el.in({ channel: offset + REGULAR_CH.tremoloRate })
        const tremDepth = el.in({ channel: offset + REGULAR_CH.tremoloDepth })

        // Frequency modulation: portamento + vibrato.
        let effFreq = el.mul(freq, freqMul)
        effFreq = buildVibrato(
          effFreq, vibRate, vibDepth,
          effSettings?.vibratoRate ?? 100,
          effSettings?.vibratoDepth ?? 0.5,
        )

        // Volume modulation: volumeSlide + tremolo.
        let effVol = buildTremolo(
          volMod, tremRate, tremDepth,
          effSettings?.tremoloRate ?? 100,
          effSettings?.tremoloDepth ?? 1,
        )

        const voice = renderInstrument(
          inst, effFreq, gate, trackerKey,
          sampleMeta, 0, sampleHashById,
          effVol, inletSignals,
          ctx.midiCcValues, ctx.paramRefs, ctx.ccBindings,
        )

        // Apply pan, vol, staccato (staccato is handled by the scheduler;
        // we just pass it through as a modulation hint — actual gate timing
        // is managed in the scheduler processor).
        const panAngle = el.mul(pan, Math.PI / 2)
        const panned: StereoOut = {
          left: el.mul(voice.left, el.cos(panAngle)),
          right: el.mul(voice.right, el.sin(panAngle)),
        }

        const gated: StereoOut = {
          left: el.mul(panned.left, vol, effVol, slotMuteRef, el.const({ value: 0.25 })),
          right: el.mul(panned.right, vol, effVol, slotMuteRef, el.const({ value: 0.25 })),
        }

        getChannel(inst.channelId ?? MASTER_CHANNEL_ID).push(applyPan(gated, instPanRef))
      }
    }
  }

  return channelVoices
}

/**
 * Compile the full document into a stereo pair.  No React, no Zustand, no
 * AudioContext — pure, unit-testable, and reusable for offline bounce.
 */
export function compileGraph(doc: Doc, ctx: RenderContext): StereoOut {
  ctx.ccBindings?.clear()

  const sampleMeta = buildSampleMeta(doc.entities.samples, ctx.vfsLoadedHashes)
  const sampleHashById = buildSampleHashById(doc.entities.samples)

  // Live voice slots for every instrument — keyboard, MIDI and tracker
  // all write to VoicePool refs. No recompile for any note event.
  const liveOut = compileAllVoiceSlots(
    doc, ctx.paramRefs, sampleMeta, sampleHashById,
    ctx.midiCcValues, ctx.ccBindings,
  )

  // Compute slot layouts from the document.  This determines how many
  // slots each instrument needs and their channel offsets.
  const slotLayouts = computeSlotLayouts(doc)

  // Tracker voice slots — one slot per concurrent track, with fixed
  // el.in channel positions.  Data flows from scheduler → el.in → voice.
  const channelVoices = slotLayouts.length > 0
    ? compileTrackerVoiceSlots(doc, slotLayouts, ctx, sampleMeta, sampleHashById)
    : new Map<Id, StereoOut[]>()

  if (slotLayouts.length > 0) {
    console.log(
      '[compile] slots:',
      slotLayouts.map((l) => {
        const chs = l.slotBaseChannels.map((c) => `${c}-${c + l.channelsPerSlot - 1}`).join(',')
        return `${l.instId}: ${l.slotCount} slots × ${l.channelsPerSlot}ch = [${chs}] (${l.isDrumkit ? 'dk' : 'reg'})`
      }).join(', '),
    )
  }

  // ── Channel routing: sum per-channel → effects → vol/pan → master ──
  const zero = el.const({ value: 0 })
  let masterLeft: NodeRepr_t = zero
  let masterRight: NodeRepr_t = zero

  for (const [chanId, voices] of channelVoices) {
    const chanSum: StereoOut = {
      left: voices.reduce((acc, v) => el.add(acc, v.left), zero),
      right: voices.reduce((acc, v) => el.add(acc, v.right), zero),
    }

    const channel = doc.entities.mixChannels[chanId]
    if (!channel) {
      masterLeft = el.add(masterLeft, chanSum.left)
      masterRight = el.add(masterRight, chanSum.right)
      continue
    }

    const processed = channel.kind === 'sub' || channel.kind === 'master'
      ? compileChannelEffects(channel.effects, chanSum, chanId, ctx.paramRefs)
      : chanSum

    const mixed = applyChannelMix(processed, channel.volume, channel.pan, chanId, ctx.paramRefs)

    masterLeft = el.add(masterLeft, mixed.left)
    masterRight = el.add(masterRight, mixed.right)
  }

  // Apply master channel effects and volume.
  const masterChannel = doc.entities.mixChannels[MASTER_CHANNEL_ID]
  let masterOut: StereoOut = { left: masterLeft, right: masterRight }
  if (masterChannel) {
    masterOut = compileChannelEffects(masterChannel.effects, masterOut, MASTER_CHANNEL_ID, ctx.paramRefs)
    masterOut = applyChannelMix(masterOut, masterChannel.volume, masterChannel.pan, MASTER_CHANNEL_ID, ctx.paramRefs)
  }

  // Master output, gated by the transport:playing ref.
  const playingGate = ctx.paramRefs
    ? ctx.paramRefs.getOrCreate('transport:playing', ctx.playing)
    : el.const({ value: ctx.playing })
  const patternOut: StereoOut = {
    left: el.mul(masterOut.left, playingGate),
    right: el.mul(masterOut.right, playingGate),
  }

  return liveOut
    ? { left: el.add(patternOut.left, liveOut.left), right: el.add(patternOut.right, liveOut.right) }
    : patternOut
}
