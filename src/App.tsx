import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDocStore } from './state/docStore'
import { useTransportStore } from './state/transportStore'
import { useAppStore, clampCursor } from './state/appStore'
import { useEngine } from './ui/useEngine'
import { useAutosave } from './ui/useAutosave'
import { usePatternSync } from './ui/usePlayhead'
import { Toolbar } from './ui/Toolbar'
import { TrackerGrid } from './ui/tracker/TrackerGrid'
import { useTrackerKeys } from './ui/tracker/useTrackerKeys'
import { useAppKeys } from './ui/useAppKeys'
import { TrackerRightPane } from './ui/tracker/TrackerRightPane'
import { InstrumentsView } from './ui/InstrumentsView'
import { SampleLibraryView } from './ui/SampleLibraryView'
import { MixerView } from './ui/mixer/MixerView'
import { DialogHost } from './ui/components/DialogHost'
import { renameCurrentSong } from './ui/songActions'
import { loadRecent, readSong } from './persist/opfsStore'
import { useProjectStore } from './state/projectStore'
import { midiToName } from './domain/notes'
import { useMidi } from './midi/useMidi'
import { useMidiStore } from './state/midiStore'
import { usePreviewStore } from './state/previewStore'
import { KeyboardPlayer } from './audio/keyboardPlayer'
import { installWarmup } from './audio/warmup'
import { useAudioStore } from './state/audioStore'

export default function App() {
  const host = useEngine()
  useAutosave()
  useMidi(host) // connect to Web MIDI API
  const keyboardPlayer = useMemo(() => new KeyboardPlayer(host), [host])

  // Start the audio host on the first user interaction so the first play
  // press finds a warm, silent graph instead of a cold compile.
  useEffect(() => installWarmup(host), [host])

  // Don't render the default placeholder doc — wait until either a persisted
  // song is loaded or a fresh default is created, then apply the rest of the
  // persisted app state (cursor, instrument, view) against the real document.
  const [ready, setReady] = useState(false)
  const loadedRef = useRef(false)
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void (async () => {
      try {
        const slug = await loadRecent()
        if (slug) {
          const file = await readSong(slug)
          if (file) {
            let doc = file.doc
            if (!doc.entities.patterns[doc.patternId]) {
              const firstPat = Object.keys(doc.entities.patterns)[0]
              if (firstPat) doc = { ...doc, patternId: firstPat }
            }
            useProjectStore.getState().reset(file.meta.name, file.meta.createdAt, slug)
            useDocStore.getState().loadDoc(doc)
          }
        }
        // If no persisted song was found, the store's built-in default doc is
        // already in place; reset project identity so it starts clean but
        // named "Untitled".
        if (!slug) {
          useProjectStore.getState().reset('Untitled', new Date().toISOString())
        }
      } catch (err) {
        console.error('Failed to load recent song:', err)
      } finally {
        // Validate persisted app state against the now-loaded document.
        const state = useAppStore.getState()
        const doc = useDocStore.getState().doc
        const pat = doc.entities.patterns[doc.patternId]
        if (pat) {
          state.setTrackerCursor(clampCursor(state.trackerCursor, pat, doc))
        }
        if (!state.selectedInstrumentId || !doc.entities.instruments[state.selectedInstrumentId]) {
          state.setSelectedInstrumentId(Object.keys(doc.entities.instruments)[0] ?? null)
        }
        setReady(true)
      }
    })()
  }, [])

  const doc = useDocStore((s) => s.doc)
  const instruments = Object.values(doc.entities.instruments)

  const projectName = useProjectStore((s) => s.name)
  const slug = useProjectStore((s) => s.slug)
  const playing = useTransportStore((s) => s.playing)
  const audioStatus = useAudioStore((s) => s.status)
  const playbackStarted = useAudioStore((s) => s.playbackStarted)
  const bpm = useTransportStore((s) => s.bpm)
  const setBpm = useTransportStore((s) => s.setBpm)
  const toggle = useTransportStore((s) => s.toggle)
  const playMode = useAppStore((s) => s.playMode)
  const setPlayMode = useAppStore((s) => s.setPlayMode)
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const trackerCursor = useAppStore((s) => s.trackerCursor)
  const selectedInstrumentId = useAppStore((s) => s.selectedInstrumentId)
  const octave = useAppStore((s) => s.octave)
  const setOctave = useAppStore((s) => s.setOctave)
  const mutedTrackNumbers = useAppStore((s) => s.mutedTrackNumbers)
  const soloedTrackNumbers = useAppStore((s) => s.soloedTrackNumbers)

  // Tempo editing
  const [editingTempo, setEditingTempo] = useState(false)
  const [tempoDraft, setTempoDraft] = useState('')
  const tempoInputRef = useRef<HTMLInputElement>(null)

  // Tap tempo
  const tapTimesRef = useRef<number[]>([])
  const [tapFlash, setTapFlash] = useState(false)
  const onTapBpm = useCallback(() => {
    const now = performance.now()
    const times = tapTimesRef.current
    if (times.length > 0 && now - times[times.length - 1] > 2000) times.length = 0
    times.push(now)
    if (times.length > 8) times.shift()
    if (times.length >= 2) {
      let totalInterval = 0
      for (let i = 1; i < times.length; i++) totalInterval += times[i] - times[i - 1]
      const avgInterval = totalInterval / (times.length - 1)
      const newBpm = Math.round(60000 / avgInterval)
      setBpm(Math.max(20, Math.min(300, newBpm)))
    }
    setTapFlash(true)
    setTimeout(() => setTapFlash(false), 150)
  }, [setBpm])

  // Tempo editing
  const beginEditTempo = useCallback(() => {
    setTempoDraft(String(bpm))
    setEditingTempo(true)
    setTimeout(() => tempoInputRef.current?.select(), 0)
  }, [bpm])

  const commitTempo = useCallback(() => {
    setEditingTempo(false)
    const n = Number(tempoDraft)
    if (!isNaN(n) && n >= 20 && n <= 300) setBpm(n)
  }, [tempoDraft, setBpm])

  const pattern = doc.entities.patterns[doc.patternId]
  // Compute keyboard note range for the octave display
  const noteRange = `${midiToName(octave * 12)} … ${midiToName(octave * 12 + 30)}`

  const trackCount = pattern.trackIds.length
  // When the pattern changes (song load, pattern switch), clamp the cursor
  // so it never points past the end of a track or effect lane. Gated on
  // `ready` so validation never runs against the store's factory default.
  useEffect(() => {
    if (!ready) return
    const { doc } = useDocStore.getState()
    const app = useAppStore.getState()
    app.setTrackerCursor(clampCursor(app.trackerCursor, doc.entities.patterns[doc.patternId], doc))
  }, [trackCount, ready])

  // Auto-select the global keyboard instrument from the cursor's current
  // track so note keys (and MIDI) always play the instrument you're editing.
  // Re-evaluates on cursor moves and pattern switches (section/song playback).
  // Empty tracks keep the last selection.
  useEffect(() => {
    const state = useDocStore.getState()
    const pattern = state.doc.entities.patterns[state.doc.patternId]
    const trackId = pattern?.trackIds[trackerCursor.track]
    const instId = trackId ? state.doc.entities.tracks[trackId]?.instrumentId : null
    useMidiStore.getState().setActiveInstrument(instId ?? null)
    if (instId) useAppStore.getState().setSelectedInstrumentId(instId)
  }, [trackerCursor.track, trackCount, ready])

  // Let the playhead hook manage section/song pattern switching (txseq-driven,
  // no rAF — transportStore.currentRow is audio-thread exact).
  usePatternSync(host)

  const trackerKeys = useTrackerKeys(host, keyboardPlayer)
  useAppKeys(host, keyboardPlayer, trackerKeys.handleKeyDown)

  return (
    <div className="app">
      <Toolbar
        playing={playing}
        audioStatus={audioStatus}
        playbackStarted={playbackStarted}
        onTogglePlay={() => {
          void host.start()
          toggle(host.currentTime, useAppStore.getState().trackerCursor.row)
        }}
        playMode={playMode}
        onSetPlayMode={setPlayMode}
        projectName={projectName}
        onRenameSong={(name) => void renameCurrentSong(name)}
        editingTempo={editingTempo}
        tempoDraft={tempoDraft}
        bpm={bpm}
        tapFlash={tapFlash}
        tempoInputRef={tempoInputRef}
        onTempoDraftChange={setTempoDraft}
        onCommitTempo={commitTempo}
        onCancelTempoEdit={() => setEditingTempo(false)}
        onBeginEditTempo={beginEditTempo}
        onTapBpm={onTapBpm}
        instruments={instruments}
        selectedInstrumentId={selectedInstrumentId}
        onSelectInstrument={(id) => {
          useAppStore.getState().setSelectedInstrumentId(id)
          useMidiStore.getState().setActiveInstrument(id)
        }}
        noteRange={noteRange}
        onOctaveDown={() => setOctave(octave - 1)}
        onOctaveUp={() => setOctave(octave + 1)}
        onPanic={() => {
          keyboardPlayer.clearHeld()
          host.panic()
          host.stopSamplePreviews()
          usePreviewStore.getState().panic()
          useAudioStore.getState().setPlaybackStarted(false)
        }}
        view={view}
        onSetView={setView}
      />

      {ready && (view === 'tracker' ? (
        <div className="layout">
          <main className="main">
            <TrackerGrid
              doc={doc}
              pattern={pattern}
              cursor={trackerCursor}
              muted={mutedTrackNumbers}
              soloed={soloedTrackNumbers}
              selection={trackerKeys.selection}
              volumeEntry={trackerKeys.volumeEntry}
              laneEntry={trackerKeys.laneEntry}
              onCellClick={trackerKeys.onCellClick}
            />
          </main>
          <TrackerRightPane doc={doc} slug={slug} />
        </div>
      ) : view === 'instruments' ? (
        <div className="layout">
          <InstrumentsView host={host} keyboardPlayer={keyboardPlayer} />
        </div>
      ) : view === 'mixer' ? (
        <div className="layout">
          <MixerView />
        </div>
      ) : (
        <div className="layout">
          <SampleLibraryView host={host} />
        </div>
      ))}
      <DialogHost />
    </div>
  )
}

