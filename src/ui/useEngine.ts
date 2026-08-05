import { useEffect, useRef } from 'react'
import { AudioHost } from '../audio/host'
import { compileGraph } from '../engine/compile'
import { buildArrangement } from '../engine/arrangement'
import { syncSamplesToVfs } from '../audio/vfsLoader'
import { useDocStore } from '../state/docStore'
import { useMidiStore } from '../state/midiStore'
import { usePreviewStore } from '../state/previewStore'
import { useProjectStore } from '../state/projectStore'
import { rowHz, useTransportStore } from '../state/transportStore'
import { useAppStore } from '../state/appStore'

/**
 * Wires the reactive stores to the audio host: any change to the document,
 * transport, or preview recompiles the Elementary graph and re-renders it.
 * Elementary reconciles the diff, so edits-while-playing just work.
 *
 * Renders are coalesced to one per animation frame. A slider drag fires dozens
 * to hundreds of store mutations per second; rendering synchronously on each
 * one would rebuild the whole graph and post that many messages to the audio
 * worklet, starving the audio thread (dropouts that recover once the drag
 * stops). Coalescing caps it at ~60/s with only the latest state — a single
 * graph edit is instant, so one render per frame keeps audio smooth.
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

  // Track the last playEpoch we rendered so we can refine playStartTime
  // at render time (more precise than the eager set in the toggle handler).
  const lastEpochRef = useRef(0)

  useEffect(() => {
    let frame = 0

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
      // Read slug fresh each render — it changes when a different song is loaded.
      const slug = useProjectStore.getState().slug

      // If samples changed, start loading them into VFS. The render happens
      // after the VFS is ready so Elementary doesn't reject unknown paths.
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

      const doRender = () => {
        const { bpm, linesPerBeat, playing, startRow, playEpoch } = useTransportStore.getState()
        const playMode = useAppStore.getState().playMode

        // Build the flattened arrangement for section/song mode so pattern
        // switches within the arrangement don't require a recompile.
        const arrangement = playMode !== 'pattern'
          ? buildArrangement(doc, playMode)
          : undefined
        const effectiveArrangement = arrangement && arrangement.length > 1 ? arrangement : undefined

        // Single instrument for live voice slots — keyboard preview takes
        // priority (notes are actually held), then first VoicePool for MIDI.
        const preview = usePreviewStore.getState()
        const hasKeyboardKeys = preview.instrumentId && Object.keys(preview.voices).length > 0
        const liveInstId = hasKeyboardKeys ? preview.instrumentId
          : (host.voicePools.size > 0 ? [...host.voicePools.keys()][0] : null)

        // Build the graph first, THEN capture playStartTime — so the playhead
        // doesn't jump ahead during compilation.
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
        })

        if (playing && lastEpochRef.current !== playEpoch) {
          host.playStartTime = host.currentTime
          host.playStartRow = startRow
          lastEpochRef.current = playEpoch
        } else if (!playing) {
          host.playStartTime = 0
          host.playStartRow = 0
          lastEpochRef.current = 0
        }

        host.render(stereo)
      }

      // Wait for any in-flight VFS sync before rendering, so sample
      // paths referenced in the graph actually exist in Elementary's VFS.
      const pending = vfsSyncRef.current
      if (pending) {
        pending.then(() => doRender())
      } else {
        doRender()
      }
    }

    // Coalesce bursts of store mutations into a single render on the next frame.
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(render)
    }

    // Live-jam dirty flag: when playing in pattern mode, edits are deferred
    // to the loop boundary so the playing pattern doesn't glitch mid-loop.
    let dirty = false

    const unsubDoc = useDocStore.subscribe((state, prev) => {
      if (state.silentBatch) return
      if (state.doc === prev.doc) return
      // App.tsx sets skipNextRecompile before changing doc.patternId during
      // section/song playback — the graph already spans the full arrangement.
      if (host.skipNextRecompile) { host.skipNextRecompile = false; return }
      // Live-jam mode: defer recompile to loop boundary.
      if (useTransportStore.getState().playing && useAppStore.getState().playMode === 'pattern') {
        dirty = true
        return
      }
      schedule()
    })
    const unsubTransport = useTransportStore.subscribe(schedule)
    host.onReady = schedule
    host.onVoicePoolCreated = schedule // recompile when new instrument gets MIDI input
    schedule() // catch any state that changed before the host was ready

    // Live-jam dirty-flag monitor: when edits are deferred during pattern-mode
    // playback, trigger a recompile near the loop boundary (2 rows before wrap)
    // so the new graph is ready before the next iteration starts.
    let dirtyRaf = 0
    const dirtyTick = () => {
      if (!dirty || !host.isReady) { dirtyRaf = requestAnimationFrame(dirtyTick); return }
      const { playing, bpm, linesPerBeat, startRow } = useTransportStore.getState()
      const playMode = useAppStore.getState().playMode
      if (!playing || playMode !== 'pattern') { dirtyRaf = requestAnimationFrame(dirtyTick); return }
      const elapsed = host.currentTime - host.playStartTime
      const rowsPerSec = rowHz(bpm, linesPerBeat)
      const globalRow = startRow + Math.floor(elapsed * rowsPerSec)
      const doc = useDocStore.getState().doc
      const pattern = doc.entities.patterns[doc.patternId]
      const len = pattern?.length ?? 64
      const localRow = ((globalRow % len) + len) % len
      // Trigger recompile when within 2 rows of the loop boundary.
      if (localRow >= len - 2) {
        dirty = false
        schedule()
      }
      dirtyRaf = requestAnimationFrame(dirtyTick)
    }
    dirtyRaf = requestAnimationFrame(dirtyTick)

    return () => {
      host.onReady = null
      host.onVoicePoolCreated = null
      if (frame) cancelAnimationFrame(frame)
      if (dirtyRaf) cancelAnimationFrame(dirtyRaf)
      unsubDoc()
      unsubTransport()
    }
  }, [host])

  return host
}
