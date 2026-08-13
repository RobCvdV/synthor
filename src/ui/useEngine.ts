import { useEffect, useRef } from 'react'
import { AudioHost } from '../audio/host'
import { compileGraph } from '../engine/compile'
import { buildArrangement } from '../engine/arrangement'
import { buildPlaybackData } from '../player/playbackData'
import { syncSamplesToVfs } from '../audio/vfsLoader'
import { computeSlotLayouts } from '../engine/voiceSlotLayout'
import { useDocStore } from '../state/docStore'
import { useMidiStore } from '../state/midiStore'
import { useProjectStore } from '../state/projectStore'
import { rowHz, useTransportStore } from '../state/transportStore'
import { useAppStore } from '../state/appStore'
import type { Id } from '../domain/types'

/**
 * Wires reactive stores to the audio host + scheduler AudioWorklet.
 *
 * Playback is driven by the audio-thread scheduler — note events (gate/freq)
 * flow directly from the scheduler worklet to Elementary via el.in. No main
 * thread, no recompile for note edits / play / stop / BPM changes.
 *
 * The graph is only recompiled for structural edits (instrument changes,
 * track add/remove, effect structure, sample changes).
 *
 * Voice slots are pre-allocated per instrument based on max concurrent tracks
 * in any single pattern. Tracks from non-overlapping patterns share slots.
 * Renders are coalesced to one per animation frame.
 */
export function useEngine(): AudioHost {
  const hostRef = useRef<AudioHost | null>(null)
  if (hostRef.current === null) hostRef.current = new AudioHost()
  const host = hostRef.current

  // Dev-only handles for debugging.
  if (import.meta.env.DEV) {
    const g = globalThis as Record<string, unknown>
    g.__host = host
    g.__docStore = useDocStore
    g.__transportStore = useTransportStore
    g.__midiStore = useMidiStore
    import('@elemaudio/core').then((m) => { g.__el = m.el })
  }

  const vfsSyncRef = useRef<Promise<void> | null>(null)
  const lastVfsKeysRef = useRef('')
  const vfsLoadedRef = useRef<Set<string>>(new Set())

  const lastStructuralKeyRef = useRef('')
  const lastEpochRef = useRef(0)

  useEffect(() => {
    let frame = 0

    /** Compute a structural hash over parts of the doc that require a recompile. */
    function structuralKey(): string {
      const { doc } = useDocStore.getState()
      const parts: string[] = []

      // Instruments — any change that alters the signal chain.
      for (const [id, inst] of Object.entries(doc.entities.instruments)) {
        const chan = `ch${inst.channelId}:pan${inst.pan}`
        if (inst.kind === 'drumkit') {
          const slots = inst.slots.map((s) =>
            `${s.note}:${s.baseNote}:${s.instrumentId ?? ''}:${s.sampleId ?? ''}`,
          ).join(',')
          parts.push(`dk:${id}:${chan}:${slots}`)
        } else if (inst.kind === 'modular') {
          const mods = Object.keys(inst.modules).sort().map((mid) => {
            const mod = inst.modules[mid]
            let key = `${mid}:${mod.type}`
            // Sample index changes are structural (different hash → different table key).
            if (mod.type === 'sample' || mod.type === 'wave') key += `:s${mod.params.sampleIndex ?? 0}`
            return key
          }).join(',')
          const conns = Object.values(inst.connections)
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((c) => `${c.from.moduleId}:${c.from.port}->${c.to.moduleId}:${c.to.port}:${c.gain}`)
            .join(',')
          parts.push(`mod:${id}:${chan}:mods[${mods}]:conns[${conns}]:out${inst.outputId}`)
        }
      }

      // Track→instrument bindings + effect lane identity.
      for (const [id, t] of Object.entries(doc.entities.tracks)) {
        const laneDefs = t.effectLanes.map((l) => `${l.id}:${l.type}`).join(',')
        parts.push(`track:${id}->${t.instrumentId}:fx[${laneDefs}]`)
      }

      // Pattern→trackIds ordering.
      for (const [id, p] of Object.entries(doc.entities.patterns)) {
        parts.push(`pat:${id}:${p.trackIds.join(',')}`)
      }

      // Mix channels.
      for (const [id, c] of Object.entries(doc.entities.mixChannels)) {
        const fx = c.effects.map((e) => `${e.type}:${e.id}`).join(',')
        parts.push(`chan:${id}:${c.kind}:${fx}`)
      }

      // Samples.
      for (const s of Object.values(doc.entities.samples)) {
        parts.push(`samp:${s.hash}`)
      }

      // Sections.
      for (const [id, sec] of Object.entries(doc.entities.sections)) {
        parts.push(`sec:${id}:${sec.patternIds.join(',')}`)
      }

      // Instrument slot layouts — captures named inlet changes and slot counts.
      const slotLayouts = computeSlotLayouts(doc)
      for (const l of slotLayouts) {
        parts.push(`slots:${l.instId}:${l.slotCount}:${l.channelsPerSlot}:${l.slotBaseChannels.join(',')}:in[${l.namedInletIds.join(',')}]`)
      }

      return parts.join('|')
    }

    const render = () => {
      frame = 0
      if (!host.isReady) return

      const { doc, mutedTracks, soloedTracks } = useDocStore.getState()
      const hasSolo = Object.values(soloedTracks).some(Boolean)
      const effectiveMute = hasSolo
        ? Object.fromEntries(
            doc.entities.patterns[doc.patternId]?.trackIds.map((tid) => [tid, !soloedTracks[tid]]) ?? [],
          )
        : mutedTracks
      const slug = useProjectStore.getState().slug

      // Sync samples to VFS.
      const samples = Object.values(doc.entities.samples)
      const keys = samples.map((s) => s.hash).sort().join(',')
      if (keys !== lastVfsKeysRef.current) {
        lastVfsKeysRef.current = keys
        if (samples.length > 0) {
          vfsSyncRef.current = syncSamplesToVfs(host, samples, slug).then(
            (loaded) => { vfsSyncRef.current = null; vfsLoadedRef.current = loaded; useDocStore.getState().setVfsLoaded(loaded) },
          )
        }
      }

      const doRecompile = () => {
        const { bpm, linesPerBeat, playing, startRow, playEpoch } = useTransportStore.getState()
        const playMode = useAppStore.getState().playMode

        const arrangement = playMode !== 'pattern'
          ? buildArrangement(doc, playMode)
          : undefined
        const effectiveArrangement = arrangement && arrangement.length > 1 ? arrangement : undefined

        const arr = effectiveArrangement ?? [{ patternId: doc.patternId, startRow: 0 }]
        const playbackData = buildPlaybackData(doc, arr)

        const currentKey = structuralKey()
        const needRecompile = currentKey !== lastStructuralKeyRef.current
        if (needRecompile) {
          console.log('[useEngine] structural change — recompiling')
          lastStructuralKeyRef.current = currentKey

          host.paramRefs.clear()

          const stereo = compileGraph(doc, {
            rowHz: rowHz(bpm, linesPerBeat),
            playing: playing ? 1 : 0,
            startRow,
            playEpoch,
            mutedTracks: effectiveMute,
            vfsLoadedHashes: vfsLoadedRef.current,
            midiCcValues: useMidiStore.getState().ccValues,
            paramRefs: host.paramRefs,
            ccBindings: host.ccBindings,
            arrangement: effectiveArrangement,
          })
          host.render(stereo)
        }

        // Split slots into batches, one per scheduler node (32 channels each).
        const CHANNELS_PER_NODE = 32
        const batchedSlots = new Map<number, typeof playbackData.slots>()
        for (const slot of playbackData.slots) {
          const nodeIdx = Math.floor(slot.channelOffset / CHANNELS_PER_NODE)
          if (!batchedSlots.has(nodeIdx)) batchedSlots.set(nodeIdx, [])
          batchedSlots.get(nodeIdx)!.push({
            ...slot,
            channelOffset: slot.channelOffset - nodeIdx * CHANNELS_PER_NODE,
          })
        }

        if (playbackData.slots.length > 0) {
          const batchInfo = [...batchedSlots.entries()].map(
            ([ni, slots]) => {
              const names = slots.map((s) => {
                const name = doc.entities.instruments[s.instId]?.name ?? s.instId.slice(0, 8)
                return `${name}/${s.slotIndex}`
              }).join(', ')
              return `  Scheduler ${ni}: ${slots.length} slots, ch 0-${slots.reduce((m, s) => Math.max(m, s.channelOffset + s.signals.length), 0) - 1} (${names})`
            },
          )
          console.log('[useEngine] batching:\n' + batchInfo.join('\n'))
        }

        // Send data to schedulers.
        const transport = useTransportStore.getState()
        const schNodes = host.schedulerNodes
        if (transport.playing && schNodes.length > 0) {
          if (transport.playEpoch !== lastEpochRef.current) {
            console.log('[useEngine] new play session playEpoch=', transport.playEpoch)
            lastEpochRef.current = transport.playEpoch
            host.paramRefs.setValue('transport:playing', 1)
            for (const [nodeIdx, sch] of schNodes.entries()) {
              const batch = batchedSlots.get(nodeIdx) ?? []
              sch.play(
                { slots: batch, totalRows: playbackData.totalRows, arrangement: playbackData.arrangement },
                transport.bpm,
                transport.linesPerBeat,
                transport.startRow,
              )
            }
          } else {
            for (const [nodeIdx, sch] of schNodes.entries()) {
              const batch = batchedSlots.get(nodeIdx) ?? []
              sch.update({ slots: batch, totalRows: playbackData.totalRows, arrangement: playbackData.arrangement })
            }
          }
        } else if (!transport.playing) {
          lastEpochRef.current = 0
        }
      }

      const pending = vfsSyncRef.current
      if (pending) {
        pending.then(() => doRecompile())
      } else {
        doRecompile()
      }
    }

    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(render)
    }

    // ── docStore subscription ─────────────────────────────────────────
    const unsubDoc = useDocStore.subscribe((state, prev) => {
      if (state.silentBatch) return
      if (state.doc === prev.doc) return
      if (host.skipNextRecompile) { host.skipNextRecompile = false; return }
      schedule()
    })

    // ── transport subscription ────────────────────────────────────────
    const unsubTransport = useTransportStore.subscribe((state, prev) => {
      if (state === prev) return

      if (state.playing && !prev.playing) {
        schedule()
        return
      }

      if (!state.playing && prev.playing) {
        host.paramRefs.setValue('transport:playing', 0)
        for (const sch of host.schedulerNodes) sch.stop()
        lastEpochRef.current = 0
        return
      }

      if (state.bpm !== prev.bpm || state.linesPerBeat !== prev.linesPerBeat) {
        // Keep tempo-synced delay/echo times live without a recompile.
        host.paramRefs.setValue('transport:rowHz', rowHz(state.bpm, state.linesPerBeat))
        if (state.playing && host.schedulerNodes.length > 0) {
          for (const sch of host.schedulerNodes) sch.setTempo(state.bpm, state.linesPerBeat)
        }
      }
    })

    // ── mute/solo subscription ─────────────────────────────────────────
    const unsubMute = useDocStore.subscribe((state, prev) => {
      if (state.mutedTracks === prev.mutedTracks && state.soloedTracks === prev.soloedTracks) return
      const { doc, mutedTracks, soloedTracks } = state
      const hasSolo = Object.values(soloedTracks).some(Boolean)
      const pattern = doc.entities.patterns[doc.patternId]
      if (!pattern) return

      // Map tracks to slots for the current pattern (same logic as buildPlaybackData).
      const nextSlot = new Map<Id, number>()
      for (const tid of pattern.trackIds) {
        const track = doc.entities.tracks[tid]
        if (!track) continue
        const si = nextSlot.get(track.instrumentId) ?? 0
        nextSlot.set(track.instrumentId, si + 1)
        const muted = hasSolo ? !soloedTracks[tid] : !!mutedTracks[tid]
        const refKey = `tracker:${track.instrumentId}:ts:${si}:mute`
        host.paramRefs.setValue(refKey, muted ? 0 : 1)
      }
    })

    host.onReady = () => {
      const sch0 = host.schedulerNodes[0]
      if (sch0) {
        sch0.onRow = (row) => {
          useTransportStore.getState().setCurrentRow(row)
        }
      }
      schedule()
    }

    return () => {
      host.onReady = null
      host.onVoicePoolCreated = null
      if (frame) cancelAnimationFrame(frame)
      unsubDoc()
      unsubTransport()
      unsubMute()
    }
  }, [host])

  return host
}
