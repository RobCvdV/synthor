import { memo, type RefObject } from 'react'
import { PLAY_MODES, type PlayMode, type View } from '../state/appStore'
import type { AudioStatus } from '../state/audioStore'
import type { Instrument } from '../domain/types'
import { FreePlayToggle } from './FreePlayToggle'
import { InstrumentSelect } from './components/InstrumentSelect'
import { EditableLabel } from './components/EditableLabel'
import { Button } from './components/Button'

interface ToolbarProps {
  playing: boolean
  audioStatus: AudioStatus
  playbackStarted: boolean
  onTogglePlay: () => void
  playMode: PlayMode
  onSetPlayMode: (mode: PlayMode) => void
  projectName: string
  onRenameSong: (name: string) => void
  editingTempo: boolean
  tempoDraft: string
  bpm: number
  tapFlash: boolean
  tempoInputRef: RefObject<HTMLInputElement | null>
  onTempoDraftChange: (v: string) => void
  onCommitTempo: () => void
  onCancelTempoEdit: () => void
  onBeginEditTempo: () => void
  onTapBpm: () => void
  instruments: Instrument[]
  selectedInstrumentId: string | null
  onSelectInstrument: (id: string) => void
  noteRange: string
  onOctaveDown: () => void
  onOctaveUp: () => void
  onPanic: () => void
  view: View
  onSetView: (v: View) => void
}

/** App header: transport, song title/tempo, instrument select, octave, panic, views. */
export const Toolbar = memo(function Toolbar({
  playing,
  audioStatus,
  playbackStarted,
  onTogglePlay,
  playMode,
  onSetPlayMode,
  projectName,
  onRenameSong,
  editingTempo,
  tempoDraft,
  bpm,
  tapFlash,
  tempoInputRef,
  onTempoDraftChange,
  onCommitTempo,
  onCancelTempoEdit,
  onBeginEditTempo,
  onTapBpm,
  instruments,
  selectedInstrumentId,
  onSelectInstrument,
  noteRange,
  onOctaveDown,
  onOctaveUp,
  onPanic,
  view,
  onSetView,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      {/* Left: transport controls */}
      <button
        className={
          'toolbar-play' +
          (playing ? ' playing' : '') +
          (audioStatus === 'warming' ? ' warming' : '') +
          (playing && !playbackStarted ? ' armed' : '')
        }
        title={
          playing
            ? playbackStarted ? 'Stop (Space)' : 'Starting audio…'
            : audioStatus === 'warming' ? 'Preparing audio…' : 'Play (Space)'
        }
        onClick={onTogglePlay}
      >
        {playing && playbackStarted ? '■' : '▶'}
      </button>
      <span className="toolbar-mode-group" title="Play mode — Tab to cycle">
        {PLAY_MODES.map((mode) => (
          <button
            key={mode}
            className={'toolbar-mode-btn' + (playMode === mode ? ' active' : '')}
            onClick={() => onSetPlayMode(mode)}
          >
            {mode === 'song' ? 'Song' : mode === 'section' ? 'Section' : 'Pattern'}
          </button>
        ))}
      </span>

      {/* Song title */}
      <EditableLabel value={projectName} onCommit={onRenameSong} commitOnBlur
        className="toolbar-title" inputClassName="toolbar-title-input" title="Double-click to rename the song" />

      {/* Tempo */}
      <span className="toolbar-tempo-group">
        {editingTempo ? (
          <input
            ref={tempoInputRef}
            className="toolbar-tempo-input"
            value={tempoDraft}
            onChange={(e) => onTempoDraftChange(e.target.value)}
            onBlur={onCommitTempo}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitTempo()
              if (e.key === 'Escape') onCancelTempoEdit()
            }}
          />
        ) : (
          <span
            className="toolbar-tempo"
            title="Double-click to edit tempo"
            onDoubleClick={onBeginEditTempo}
          >
            {bpm}
          </span>
        )}
        <span className="muted">BPM</span>
        <button
          className={'toolbar-tap-btn' + (tapFlash ? ' flash' : '')}
          title="Tap tempo"
          onClick={onTapBpm}
        >
          TAP
        </button>
      </span>

      <span className="spacer" />

      {/* Global keyboard instrument */}
      <InstrumentSelect className="midi-inst-select" instruments={instruments}
        value={selectedInstrumentId ?? ''} onChange={onSelectInstrument} emptyLabel="No instruments"
        title="Global keyboard instrument — note keys play this in every view" />
      <FreePlayToggle />

      {/* Octave group */}
      <span className="toolbar-octave-group" title="Keyboard playable note range">
        <span className="muted toolbar-octave-range">{noteRange}</span>
        <Button onClick={onOctaveDown}>oct −</Button>
        <Button onClick={onOctaveUp}>oct +</Button>
      </span>

      {/* Global panic */}
      <button
        className="panic-btn"
        title="Panic — stop all audio (Esc)"
        onClick={onPanic}
      >
        PANIC
      </button>

      {/* Page switch buttons */}
      <Button active={view === 'tracker'} onClick={() => onSetView('tracker')}
        title="Tracker (⌘T)"
      >
        Tracker
      </Button>
      <Button active={view === 'instruments'} onClick={() => onSetView('instruments')}
        title="Instruments (⌘I)"
      >
        Instruments
      </Button>
      <Button active={view === 'samples'} onClick={() => onSetView('samples')}
        title="Samples (⌘S)"
      >
        Samples
      </Button>
      <Button active={view === 'mixer'} onClick={() => onSetView('mixer')}
        title="Mixer (⌘M)"
      >
        Mixer
      </Button>
    </header>
  )
})
