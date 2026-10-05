import { useEffect, useMemo } from 'react'
import { useDocStore } from './state/docStore'
import { useTransportStore } from './state/transportStore'
import { useAppStore } from './state/appStore'
import { useEngine } from './ui/useEngine'
import { useAutosave } from './ui/useAutosave'
import { usePatternSync } from './ui/usePlayhead'
import { Toolbar } from './ui/Toolbar'
import { TrackerGrid } from './ui/tracker/TrackerGrid'
import { useTrackerKeys } from './ui/tracker/useTrackerKeys'
import { useAppKeys } from './ui/useAppKeys'
import { useStartupSong } from './ui/useStartupSong'
import { useTrackerCursorSync } from './ui/tracker/useTrackerCursorSync'
import { TrackerRightPane } from './ui/tracker/TrackerRightPane'
import { InstrumentsView } from './ui/InstrumentsView'
import { SampleLibraryView } from './ui/SampleLibraryView'
import { MixerView } from './ui/mixer/MixerView'
import { DialogHost } from './ui/components/DialogHost'
import { SongCommandHost } from './ui/SongCommandHost'
import { renameCurrentSong } from './ui/songActions'
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

  // The placeholder doc never renders; the saved song replaces it first.
  const ready = useStartupSong()
  useTrackerCursorSync(ready)

  const doc = useDocStore((s) => s.doc)
  const instruments = Object.values(doc.entities.instruments)

  const projectName = useProjectStore((s) => s.name)
  const playing = useTransportStore((s) => s.playing)
  const audioStatus = useAudioStore((s) => s.status)
  const playbackStarted = useAudioStore((s) => s.playbackStarted)
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

  const pattern = doc.entities.patterns[doc.patternId]
  // Compute keyboard note range for the octave display
  const noteRange = `${midiToName(octave * 12)} … ${midiToName(octave * 12 + 30)}`

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
              onCellDrag={trackerKeys.onCellDrag}
            />
          </main>
          <TrackerRightPane doc={doc} />
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
      {ready && <SongCommandHost />}
      <DialogHost />
    </div>
  )
}

