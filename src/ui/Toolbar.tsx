import { memo } from 'react'
import { PLAY_MODES, type PlayMode, type View } from '../state/appStore'
import type { AudioStatus } from '../state/audioStore'
import type { Instrument } from '../domain/types'
import { FreePlayToggle } from './FreePlayToggle'
import { TempoControl } from './TempoControl'
import { UpdateButton } from './UpdateButton'
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
      <TempoControl />

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

      <UpdateButton />

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
        title="Tracker"
      >
        Tracker
      </Button>
      <Button active={view === 'instruments'} onClick={() => onSetView('instruments')}
        title="Instruments"
      >
        Instruments
      </Button>
      <Button active={view === 'samples'} onClick={() => onSetView('samples')}
        title="Samples"
      >
        Samples
      </Button>
      <Button active={view === 'mixer'} onClick={() => onSetView('mixer')}
        title="Mixer"
      >
        Mixer
      </Button>
    </header>
  )
})
