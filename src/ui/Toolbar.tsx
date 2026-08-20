import type { RefObject } from 'react'
import { PLAY_MODES, type PlayMode, type View } from '../state/appStore'
import type { AudioStatus } from '../state/audioStore'
import type { Instrument } from '../domain/types'

interface ToolbarProps {
  playing: boolean
  audioStatus: AudioStatus
  playbackStarted: boolean
  onTogglePlay: () => void
  playMode: PlayMode
  onSetPlayMode: (mode: PlayMode) => void
  editingTitle: boolean
  titleDraft: string
  projectName: string
  titleInputRef: RefObject<HTMLInputElement | null>
  onTitleDraftChange: (v: string) => void
  onCommitTitle: () => void
  onCancelTitleEdit: () => void
  onBeginEditTitle: () => void
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
export function Toolbar({
  playing,
  audioStatus,
  playbackStarted,
  onTogglePlay,
  playMode,
  onSetPlayMode,
  editingTitle,
  titleDraft,
  projectName,
  titleInputRef,
  onTitleDraftChange,
  onCommitTitle,
  onCancelTitleEdit,
  onBeginEditTitle,
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
      {editingTitle ? (
        <input
          ref={titleInputRef}
          className="toolbar-title-input"
          value={titleDraft}
          onChange={(e) => onTitleDraftChange(e.target.value)}
          onBlur={onCommitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitTitle()
            if (e.key === 'Escape') onCancelTitleEdit()
          }}
        />
      ) : (
        <span
          className="toolbar-title"
          title="Double-click to rename"
          onDoubleClick={onBeginEditTitle}
        >
          {projectName}
        </span>
      )}

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
      <select
        className="midi-inst-select"
        value={selectedInstrumentId ?? ''}
        onChange={(e) => {
          const id = e.target.value
          if (!id) return
          onSelectInstrument(id)
        }}
        title="Global keyboard instrument — note keys play this in every view"
      >
        {instruments.length === 0 && <option value="">No instruments</option>}
        {instruments.map((inst) => (
          <option key={inst.id} value={inst.id}>{inst.name}</option>
        ))}
      </select>

      {/* Octave group */}
      <span className="toolbar-octave-group" title="Keyboard playable note range">
        <span className="muted toolbar-octave-range">{noteRange}</span>
        <button className="octbtn" onClick={onOctaveDown}>oct −</button>
        <button className="octbtn" onClick={onOctaveUp}>oct +</button>
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
      <button
        className={'octbtn' + (view === 'tracker' ? ' active' : '')}
        onClick={() => onSetView('tracker')}
        title="Tracker (⌘T)"
      >
        Tracker
      </button>
      <button
        className={'octbtn' + (view === 'instruments' ? ' active' : '')}
        onClick={() => onSetView('instruments')}
        title="Instruments (⌘I)"
      >
        Instruments
      </button>
      <button
        className={'octbtn' + (view === 'samples' ? ' active' : '')}
        onClick={() => onSetView('samples')}
        title="Samples (⌘S)"
      >
        Samples
      </button>
      <button
        className={'octbtn' + (view === 'mixer' ? ' active' : '')}
        onClick={() => onSetView('mixer')}
        title="Mixer (⌘M)"
      >
        Mixer
      </button>
    </header>
  )
}
