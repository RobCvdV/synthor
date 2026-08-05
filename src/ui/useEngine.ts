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
     *  trackIds, mix channels, effect definitions, sample hashes). */
    function structuralKey(): string {
      const { doc } = useDocStore.getState()
      const parts: string[] = []
      // Instruments
      for (const [id, inst] of Object.entries(doc.entities.instruments)) {
        const params = inst.kind === 'osc' ? `p:${JSON.stringify(inst.params)}`
          : inst.kind === 'drumkit' ? `dk:${inst.slots.length}`
          : `mod:${Object.keys(inst.modules).length}`
        parts.push(`${id}:${inst.kind}:${params}`)
      }
      // Track→instrument bindings
      for (const [id, t] of Object.entries(doc.entities.tracks)) {
        parts.push(`${id}->${t.instrumentId}`)
      }
      // Pattern→trackIds ordering
      for (const [id, p] of Object.entries(doc.entities.patterns)) {
        parts.push(`${id}:${p.trackIds.join(',')}`)
      }
      // Mix channels
      for (const [id, c] of Object.entries(doc.entities.mixChannels)) {
        parts.push(`chan:${id}:${c.kind}:${c.effects.map((e) => e.type).join(',')}`)
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
              const count = i.kind === 'drumkit' ? i.slots.length : 2
              trackChannels.set(tid, { offset: chOffset, count, instId: i.id })
              chOffset += count
            }
          }

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
              const count = i.kind === 'drumkit' ? i.slots.length : 2
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

      // Check if this is a structural change (requires recompile).
      const newKey = structuralKey()
      if (newKey !== lastStructuralKeyRef.current) {
        schedule()
      }
      // Note edits, playhead changes, etc. don't recompile — the scheduler
      // gets updated via the render() → doRecompile() path which always
      // sends playback data to the worklet.
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

    host.onReady = schedule
    // Voice pools write directly to refs (no recompile needed — all voice
    // slots are compiled once in compileAllVoiceSlots).

    // Wire scheduler row events → transportStore for UI playhead.
    if (host.schedulerNode) {
      host.schedulerNode.onRow = (row) => {
        useTransportStore.getState().setCurrentRow(row)
      }
    }

    schedule() // catch any state that changed before the host was ready

    return () => {
      host.onReady = null
      host.onVoicePoolCreated = null
      if (frame) cancelAnimationFrame(frame)
      unsubDoc()
      unsubTransport()
    }
  }, [host])

  return host
}
