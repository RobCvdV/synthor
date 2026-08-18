import { useEffect, useRef } from 'react'
import { AudioHost } from '../audio/host'
import { compileGraph } from '../engine/compile'
import { buildArrangement } from '../engine/arrangement'
import { buildPlaybackData, mapPatternTracksToSlots, type PlaybackData, type VoiceSlotData } from '../player/playbackData'
import { syncSamplesToVfs } from '../audio/vfsLoader'
import { computeSlotLayouts } from '../engine/voiceSlotLayout'
import { useDocStore } from '../state/docStore'
import { useMidiStore } from '../state/midiStore'
import { useProjectStore } from '../state/projectStore'
import { rowHz, useTransportStore } from '../state/transportStore'
import { useAppStore } from '../state/appStore'
import { useAudioStore } from '../state/audioStore'

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
  const l1SumsRef = useRef<Record<string, number>>({})

  const lastStructuralKeyRef = useRef('')
  const lastEpochRef = useRef(0)

  /** Latest playback data from the most recent pass — a deferred play-start
   *  must send the data matching the live graph, not its own stale pass. */
  const latestPlaybackRef = useRef<PlaybackData | null>(null)
  const latestBatchRef = useRef<Map<number, VoiceSlotData[]>>(new Map())
  /** Promise of the most recent host.render(). Awaited before sch.play so the
   *  row clock never starts on a graph still uploading. Never nulled — a
   *  resolved promise awaits instantly. */
  const renderSettleRef = useRef<Promise<void> | null>(null)

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
            if (mod.type === 'sample' || mod.type === 'wave' || mod.type === 'conv') key += `:s${mod.params.sampleIndex ?? 0}`
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
        // conv's sampleIndex is structural: different hash → different VFS path.
        const fx = c.effects.map((e) =>
          `${e.type}:${e.id}` + (e.type === 'conv' ? `:s${e.params.sampleIndex ?? 0}` : ''),
        ).join(',')
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

    /** Push mute/solo state into every track-slot mute ref across all patterns.
     *  Solo overrides mute. Runs after structural recompiles (paramRefs.clear
     *  wipes the refs) and on mute/solo changes — ref-only, never a recompile. */
    const applyMuteRefs = () => {
      if (!host.isReady) return
      const { doc } = useDocStore.getState()
      const { mutedTrackNumbers, soloedTrackNumbers } = useAppStore.getState()
      const hasSolo = Object.values(soloedTrackNumbers).some(Boolean)
      // Current pattern last so it wins any slot shared between patterns.
      const patterns = Object.values(doc.entities.patterns).sort(
        (a, b) => (a.id === doc.patternId ? 1 : 0) - (b.id === doc.patternId ? 1 : 0),
      )
      for (const pattern of patterns) {
        const trackToSlot = mapPatternTracksToSlots(doc, pattern.id)
        pattern.trackIds.forEach((trackId, ti) => {
          const si = trackToSlot.get(trackId)
          if (si === undefined) return
          const track = doc.entities.tracks[trackId]
          if (!track) return
          const trackNum = ti + 1
          const muted = hasSolo ? !soloedTrackNumbers[trackNum] : !!mutedTrackNumbers[trackNum]
          host.paramRefs.setValue(`tracker:${track.instrumentId}:ts:${si}:mute`, muted ? 0 : 1)
        })
      }
    }

    const markAudioReady = () => {
      const audio = useAudioStore.getState()
      if (audio.status !== 'ready') audio.setStatus('ready')
    }

    const render = () => {
      frame = 0
      if (!host.isReady) return

      const { doc } = useDocStore.getState()
      const slug = useProjectStore.getState().slug

      // Sync samples to VFS.
      const samples = Object.values(doc.entities.samples)
      const keys = samples.map((s) => s.hash).sort().join(',')
      if (keys !== lastVfsKeysRef.current) {
        lastVfsKeysRef.current = keys
        if (samples.length > 0) {
          useAudioStore.getState().setStatus('warming')
          vfsSyncRef.current = syncSamplesToVfs(host, samples, slug).then(
            ({ loaded, l1Sums }) => { vfsSyncRef.current = null; vfsLoadedRef.current = loaded; l1SumsRef.current = l1Sums; useDocStore.getState().setVfsLoaded(loaded) },
          )
        }
      }

      /** Start the scheduler clock once the graph is live. Deferred past the
       *  latest render so rows never advance against a dead graph. Re-reads
       *  the store fresh: a stop during the wait cancels, and a newer play
       *  session (higher epoch) supersedes this deferred pass. Synchronous
       *  from the guard to sch.play, so nothing can interleave. */
      const startPlayback = (epoch: number) => {
        const t = useTransportStore.getState()
        const latest = latestPlaybackRef.current
        if (!t.playing || t.playEpoch !== epoch || !latest) return
        host.playStartTime = host.currentTime
        host.playStartRow = t.startRow
        host.paramRefs.setValue('transport:playing', 1)
        for (const [nodeIdx, sch] of host.schedulerNodes.entries()) {
          const batch = latestBatchRef.current.get(nodeIdx) ?? []
          sch.play(
            { slots: batch, totalRows: latest.totalRows, arrangement: latest.arrangement },
            t.bpm,
            t.linesPerBeat,
            t.startRow,
          )
        }
        const audio = useAudioStore.getState()
        audio.setPlaybackStarted(true)
        if (audio.status !== 'ready') audio.setStatus('ready')
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
            vfsLoadedHashes: vfsLoadedRef.current,
            l1Sums: l1SumsRef.current,
            midiCcValues: useMidiStore.getState().ccValues,
            paramRefs: host.paramRefs,
            ccBindings: host.ccBindings,
            arrangement: effectiveArrangement,
          })
          renderSettleRef.current = host.render(stereo)
          renderSettleRef.current.then(markAudioReady)
          applyMuteRefs()
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

        // Every pass overwrites these: a deferred play-start (below) must
        // read the latest batch, not the data captured by its own pass.
        latestPlaybackRef.current = playbackData
        latestBatchRef.current = batchedSlots

        // Send data to schedulers.
        const transport = useTransportStore.getState()
        const schNodes = host.schedulerNodes
        if (transport.playing && schNodes.length > 0) {
          if (transport.playEpoch !== lastEpochRef.current) {
            console.log('[useEngine] new play session playEpoch=', transport.playEpoch)
            lastEpochRef.current = transport.playEpoch
            const epoch = transport.playEpoch
            const settle = renderSettleRef.current
            if (settle) settle.then(() => startPlayback(epoch))
            else startPlayback(epoch)
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
        useAudioStore.getState().setPlaybackStarted(false)
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
    const unsubMute = useAppStore.subscribe((state, prev) => {
      if (state.mutedTrackNumbers === prev.mutedTrackNumbers &&
          state.soloedTrackNumbers === prev.soloedTrackNumbers) return
      applyMuteRefs()
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
