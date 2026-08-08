import { useEffect, useRef } from 'react'
import { AudioHost } from '../audio/host'
import { compileGraph } from '../engine/compile'
import { buildArrangement } from '../engine/arrangement'
import { buildPlaybackData } from '../player/playbackData'
import { syncSamplesToVfs } from '../audio/vfsLoader'
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
 * Renders are coalesced to one per animation frame. A slider drag fires dozens
 * of mutations per second; coalescing caps it at ~60/s with only the latest
 * state — a single graph edit is instant, so one render per frame keeps audio
 * smooth.
 */
export function useEngine(): AudioHost {
  const hostRef = useRef<AudioHost | null>(null)
  if (hostRef.current === null) hostRef.current = new AudioHost()
  const host = hostRef.current

  // Dev-only handles for debugging / audio verification from the console.
  if (import.meta.env.DEV) {
    const g = globalThis as Record<string, unknown>
    g.__host = host
    g.__docStore = useDocStore
    g.__transportStore = useTransportStore
    g.__midiStore = useMidiStore
    // Expose el for console testing
    import('@elemaudio/core').then((m) => { g.__el = m.el })
  }

  // Track pending VFS sync so we don't render graphs referencing unloaded samples.
  const vfsSyncRef = useRef<Promise<void> | null>(null)
  const lastVfsKeysRef = useRef('')
  const vfsLoadedRef = useRef<Set<string>>(new Set())

  // Structural key for detecting edits that require a recompile (vs note edits
  // that only update the scheduler).
  const lastStructuralKeyRef = useRef('')
  // Track the last play session to distinguish play vs update.
  const lastEpochRef = useRef(0)

  useEffect(() => {
    let frame = 0

    /** Compute a structural hash over parts of the doc that require a recompile
     *  when changed (instrument entities, track→instrument bindings, pattern
     *  trackIds, mix channels, effect definitions, sample hashes).
     *  Every value that compileGraph reads to build graph nodes MUST appear here
     *  — a missing field means a "silent" edit that never takes effect. */
    function structuralKey(): string {
      const { doc } = useDocStore.getState()
      const parts: string[] = []
      // Instruments — any change that alters the signal chain needs a recompile.
      for (const [id, inst] of Object.entries(doc.entities.instruments)) {
        const chan = `ch${inst.channelId}:pan${inst.pan}`
        if (inst.kind === 'osc') {
          parts.push(`osc:${id}:${chan}:${JSON.stringify(inst.params)}`)
        } else if (inst.kind === 'drumkit') {
          const slots = inst.slots.map((s) =>
            `${s.note}:${s.pitchOffset}:${s.instrumentId ?? ''}:${s.sampleId ?? ''}`,
          ).join(',')
          parts.push(`dk:${id}:${chan}:${slots}`)
        } else if (inst.kind === 'modular') {
          // Module types + output routing determine the signal chain.
          // Params are ref-based so they don't appear here.
          const mods = Object.keys(inst.modules).sort().map((mid) =>
            `${mid}:${inst.modules[mid].type}`,
          ).join(',')
          // Connections (cords) define the signal flow between modules.
          const conns = Object.values(inst.connections)
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((c) => `${c.from.moduleId}:${c.from.port}->${c.to.moduleId}:${c.to.port}:${c.gain}`)
            .join(',')
          parts.push(`mod:${id}:${chan}:mods[${mods}]:conns[${conns}]:out${inst.outputId}`)
        }
      }
      // Track→instrument bindings
      for (const [id, t] of Object.entries(doc.entities.tracks)) {
        parts.push(`track:${id}->${t.instrumentId}`)
      }
      // Pattern→trackIds ordering
      for (const [id, p] of Object.entries(doc.entities.patterns)) {
        parts.push(`pat:${id}:${p.trackIds.join(',')}`)
      }
      // Mix channels — kind + effect identity chain.
      for (const [id, c] of Object.entries(doc.entities.mixChannels)) {
        const fx = c.effects.map((e) => `${e.type}:${e.id}`).join(',')
        parts.push(`chan:${id}:${c.kind}:${fx}`)
      }
      // Sample hashes
      for (const s of Object.values(doc.entities.samples)) {
        parts.push(`samp:${s.hash}`)
      }
      // Sections
      for (const [id, sec] of Object.entries(doc.entities.sections)) {
        parts.push(`sec:${id}:${sec.patternIds.join(',')}`)
      }
      return parts.join('|')
    }

    const render = () => {
      frame = 0
      if (!host.isReady) return

      const { doc, mutedTracks, soloedTracks } = useDocStore.getState()
      // Compute effective mute: when any track is soloed, only soloed tracks
      // are audible; mute state is ignored for soloed tracks.
      const hasSolo = Object.values(soloedTracks).some(Boolean)
      const effectiveMute = hasSolo
        ? Object.fromEntries(
            doc.entities.patterns[doc.patternId]?.trackIds.map((tid) => [tid, !soloedTracks[tid]]) ?? [],
          )
        : mutedTracks
      const slug = useProjectStore.getState().slug

      // If samples changed, start loading them into VFS.
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

        // Build the flattened arrangement.
        const arrangement = playMode !== 'pattern'
          ? buildArrangement(doc, playMode)
          : undefined
        const effectiveArrangement = arrangement && arrangement.length > 1 ? arrangement : undefined

        // Build playback data first (pure, cheap — no compile needed).
        const arr = effectiveArrangement ?? [{ patternId: doc.patternId, startRow: 0 }]
        const playbackData = buildPlaybackData(doc, arr)

        // Track → scheduler channel mapping.
        const trackChannels = new Map<Id, { offset: number; count: number; instId: Id }>()

        // Only recompile if the structural key changed (instruments, tracks,
        // effects, samples). Note-only edits skip the compile entirely.
        const currentKey = structuralKey()
        const needRecompile = currentKey !== lastStructuralKeyRef.current
        if (needRecompile) {
          console.log('[useEngine] structural change — recompiling')
          lastStructuralKeyRef.current = currentKey

          // Assign channel offsets before compile so they match el.in nodes.
          let chOffset = 0
          const seen = new Set<Id>()
          for (const item of arr) {
            const pat = doc.entities.patterns[item.patternId]
            if (!pat) continue
            for (const tid of pat.trackIds) {
              if (seen.has(tid)) continue
              seen.add(tid)
              const t = doc.entities.tracks[tid]
              const i = t && doc.entities.instruments[t.instrumentId]
              if (!i) continue
              const count = i.kind === 'drumkit' ? i.slots.length + 1 : 3
              trackChannels.set(tid, { offset: chOffset, count, instId: i.id })
              chOffset += count
            }
          }

          // Clear stale refs from the previous graph so getOrCreate
          // produces fresh createRef nodes for the new graph. Old refs
          // whose setters point to destroyed audio-thread nodes cause
          // silence after recompile.
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
            trackChannels,
          })
          host.render(stereo)
        } else {
          // No structural change — reuse last channel layout from the doc.
          // We rebuild channel offsets here to align playbackData.
          let chOffset = 0
          const seen = new Set<Id>()
          for (const item of arr) {
            const pat = doc.entities.patterns[item.patternId]
            if (!pat) continue
            for (const tid of pat.trackIds) {
              if (seen.has(tid)) continue
              seen.add(tid)
              const t = doc.entities.tracks[tid]
              const i = t && doc.entities.instruments[t.instrumentId]
              if (!i) continue
              const count = i.kind === 'drumkit' ? i.slots.length + 1 : 3
              trackChannels.set(tid, { offset: chOffset, count, instId: i.id })
              chOffset += count
            }
          }
        }

        // Align channel offsets in playbackData.
        for (const t of playbackData.tracks) {
          const ch = trackChannels.get(t.trackId)
          if (ch) t.channelOffset = ch.offset
        }

        // If playing, send data to the scheduler.
        const transport = useTransportStore.getState()
        if (transport.playing && host.schedulerNode) {
          if (transport.playEpoch !== lastEpochRef.current) {
            console.log('[useEngine] new play session playEpoch=', transport.playEpoch)
            lastEpochRef.current = transport.playEpoch
            host.paramRefs.setValue('transport:playing', 1)
            host.schedulerNode.play(
              playbackData,
              transport.bpm,
              transport.linesPerBeat,
              transport.startRow,
            )
          } else {
            host.schedulerNode.update(playbackData)
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

    // Coalesce bursts of store mutations into a single render on the next frame.
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(render)
    }

    // ── docStore subscription ─────────────────────────────────────────
    const unsubDoc = useDocStore.subscribe((state, prev) => {
      if (state.silentBatch) return
      if (state.doc === prev.doc) return
      // App.tsx sets skipNextRecompile before changing doc.patternId during
      // section/song playback — the pattern change is purely for UI.
      if (host.skipNextRecompile) { host.skipNextRecompile = false; return }

      // Always schedule a render — recompile only if structuralKey changed,
      // but the scheduler always needs fresh playback data for note edits,
      // hold signs, staccato values, etc.
      schedule()
    })

    // ── transport subscription ────────────────────────────────────────
    const unsubTransport = useTransportStore.subscribe((state, prev) => {
      if (state === prev) return

      // Play: send data to the scheduler worklet (NO recompile — graph
      // already has el.in nodes and voice slots).
      if (state.playing && !prev.playing) {
        schedule() // calls render() which builds playbackData and calls schedulerNode.play()
        return
      }

      // Stop: gate off + stop scheduler.
      if (!state.playing && prev.playing) {
        host.paramRefs.setValue('transport:playing', 0)
        host.schedulerNode?.stop()
        lastEpochRef.current = 0
        return
      }

      // BPM change while playing: update scheduler tempo only.
      if (state.playing && state.bpm !== prev.bpm && host.schedulerNode) {
        host.schedulerNode.setTempo(state.bpm, state.linesPerBeat)
      }
    })

    // ── mute/solo subscription ─────────────────────────────────────────
    // Mute is a ref write, not a recompile. When mute or solo state changes
    // we only update the track:xxx:mute refs in the running graph.
    const unsubMute = useDocStore.subscribe((state, prev) => {
      if (state.mutedTracks === prev.mutedTracks && state.soloedTracks === prev.soloedTracks) return
      const { doc, mutedTracks, soloedTracks } = state
      const hasSolo = Object.values(soloedTracks).some(Boolean)
      const pattern = doc.entities.patterns[doc.patternId]
      if (!pattern) return
      for (const tid of pattern.trackIds) {
        const muted = hasSolo ? !soloedTracks[tid] : !!mutedTracks[tid]
        host.paramRefs.setValue(`track:${tid}:mute`, muted ? 0 : 1)
      }
    })

    host.onReady = () => {
      // Wire scheduler row events → transportStore for UI playhead.
      if (host.schedulerNode) {
        host.schedulerNode.onRow = (row) => {
          useTransportStore.getState().setCurrentRow(row)
        }
      }
      schedule()
    }
    // Voice pools write directly to refs (no recompile needed — all voice
    // slots are compiled once in compileAllVoiceSlots).

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
