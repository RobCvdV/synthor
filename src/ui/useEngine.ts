import { useEffect, useRef } from 'react'
import { AudioHost } from '../audio/host'
import { compileGraph } from '../engine/compile'
import { buildArrangement } from '../engine/arrangement'
import { buildPlaybackData } from '../player/playbackData'
import { syncSamplesToVfs } from '../audio/vfsLoader'
import { useDocStore } from '../state/docStore'
import { useMidiStore } from '../state/midiStore'
import { usePreviewStore } from '../state/previewStore'
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

        // Build the flattened arrangement for section/song mode so pattern
        // switches within the arrangement don't require a recompile.
        const arrangement = playMode !== 'pattern'
          ? buildArrangement(doc, playMode)
          : undefined
        const effectiveArrangement = arrangement && arrangement.length > 1 ? arrangement : undefined

        // Single instrument for live voice slots.
        const preview = usePreviewStore.getState()
        const hasKeyboardKeys = preview.instrumentId && Object.keys(preview.voices).length > 0
        const liveInstId = hasKeyboardKeys ? preview.instrumentId
          : (host.voicePools.size > 0 ? [...host.voicePools.keys()][0] : null)

        // Track → scheduler channel mapping, populated by compileGraph.
        const trackChannels = new Map<Id, { offset: number; count: number; instId: Id }>()

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
          liveInstrumentId: liveInstId ?? undefined,
          trackChannels,
        })

        host.render(stereo)

        // Update structural key tracking.
        lastStructuralKeyRef.current = structuralKey()

        // Build playback data for the scheduler using the same channel layout
        // that compileGraph just populated.
        const arr = effectiveArrangement ?? [{ patternId: doc.patternId, startRow: 0 }]
        const playbackData = buildPlaybackData(doc, arr)
        // Align channel offsets with what compileGraph assigned.
        for (const t of playbackData.tracks) {
          const ch = trackChannels.get(t.trackId)
          if (ch) {
            t.channelOffset = ch.offset
          }
        }

        // If playing, send data to the scheduler.
        const transport = useTransportStore.getState()
        if (transport.playing && host.schedulerNode) {
          // Distinguish new play session from update.
          if (transport.playEpoch !== lastEpochRef.current) {
            lastEpochRef.current = transport.playEpoch
            // Set transport:playing ref to 1 so the master gate opens.
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

      const playing = useTransportStore.getState().playing
      if (!playing) {
        // Stopped: always recompile (things may have changed structurally).
        schedule()
        return
      }

      // Playing: check if this is a structural change.
      // Phase 1: always recompile on doc change while playing.
      // Phase 2: optimize by comparing structuralKey and skipping
      // recompile if only note data changed.
      schedule()
    })

    // ── transport subscription ────────────────────────────────────────
    const unsubTransport = useTransportStore.subscribe((state, prev) => {
      if (state === prev) return

      // Play/stop.
      if (state.playing !== prev.playing) {
        if (state.playing) {
          schedule() // render will compile + call schedulerNode.play()
        } else {
          host.paramRefs.setValue('transport:playing', 0)
          host.schedulerNode?.stop()
          lastEpochRef.current = 0
        }
        return
      }

      // BPM change while playing: update scheduler tempo.
      if (state.playing && state.bpm !== prev.bpm && host.schedulerNode) {
        host.schedulerNode.setTempo(state.bpm, state.linesPerBeat)
      }
    })

    host.onReady = schedule
    host.onVoicePoolCreated = schedule

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
