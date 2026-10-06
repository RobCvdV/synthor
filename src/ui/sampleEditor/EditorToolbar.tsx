import { Button } from '../components/Button'
import { Select } from '../components/Select'
import type { LiveProcessKind } from './liveProcesses'
import s from './SampleEditor.module.css'

/** Processing applied to the selection; the ones marked `whole` fall back to the whole sample. */
export type ProcessKind = 'trim' | 'silence' | 'normalize' | 'removeDc' | LiveProcessKind

const PROCESS_CHOICES: { value: ProcessKind; label: string; whole?: boolean; notForCycles?: boolean }[] = [
  { value: 'trim', label: 'Trim to selection' },
  { value: 'silence', label: 'Silence' },
  { value: 'normalize', label: 'Normalize', whole: true },
  { value: 'removeDc', label: 'Remove DC offset', whole: true },
  { value: 'pitch', label: 'Pitch…', whole: true, notForCycles: true },
  { value: 'smooth', label: 'Smooth…', whole: true },
  { value: 'drive', label: 'Drive…', whole: true },
  { value: 'crush', label: 'Crush…', whole: true },
]

export interface EditorActions {
  play: () => void
  copy: () => void
  cut: () => void
  paste: () => void
  insert: () => void
  replace: () => void
  reverse: () => void
  snap: () => void
  process: (kind: ProcessKind) => void
  makeCycle: () => void
  toggleDraw: () => void
  saveAs: () => void
  exportFile: () => void
  zoomOut: () => void
  zoomIn: () => void
  zoomSel: () => void
  zoomFit: () => void
  close: () => void
}

export function EditorToolbar({ ready, hasSel: selected, hasClip: clipped, drawing = false, processing = false, cycles = false, actions: a }: {
  /** The sample is loaded and no save is running. */
  ready: boolean
  /** A live process is being tuned: only playing and viewing stay available. */
  processing?: boolean
  /** A single cycle or wavetable: the note sets its pitch, so repitching only costs resolution. */
  cycles?: boolean
  /** Dragging on the waveform draws instead of selecting. */
  drawing?: boolean
  hasSel: boolean
  hasClip: boolean
  actions: EditorActions
}) {
  const edit = ready && !processing
  const hasSel = selected && !processing
  const hasClip = clipped && !processing
  return (
    <div className={s.toolbar}>
      <Button disabled={!ready} onClick={a.play} title="Play from cursor/selection (Space)">▶ Play</Button>
      <Button disabled={!edit} active={drawing} onClick={a.toggleDraw} title="Draw on the waveform with the mouse">✎ Draw</Button>
      <span className={s.spacer} />
      <Button disabled={!hasSel} onClick={a.copy} title="Copy selection to paste buffer (⌘C)">Copy</Button>
      <Button disabled={!hasSel} onClick={a.cut} title="Cut selection to paste buffer (⌘X)">Cut</Button>
      <Button disabled={!hasClip} onClick={a.paste} title="Paste at cursor, overwriting (⌘V)">Paste</Button>
      <Button disabled={!hasClip} onClick={a.insert} title="Insert at cursor, shifting content">Insert</Button>
      <Button disabled={!edit} onClick={() => a.process('insertSilence')} title="Insert silence at the cursor (or the selection start), shifting content">Insert Silence…</Button>
      <Button disabled={!hasSel || !hasClip} onClick={a.replace} title="Replace selection with paste buffer">Replace</Button>
      <Button disabled={!hasSel} onClick={a.reverse} title="Reverse selection (sounds backwards)">Reverse</Button>
      <Button disabled={!edit} onClick={() => a.process('volume')} title="Change the volume of the selection or the whole sample">Volume…</Button>
      <Button disabled={!edit} onClick={() => a.process('fadeIn')} title="Fade the selection or the whole sample in">Fade In…</Button>
      <Button disabled={!edit} onClick={() => a.process('fadeOut')} title="Fade the selection or the whole sample out">Fade Out…</Button>
      <Select value="" disabled={!edit} aria-label="Process"
        title="Process the selection, or the whole sample where nothing is selected"
        onChange={(e) => { if (e.target.value) a.process(e.target.value as ProcessKind) }}>
        <option value="">Process…</option>
        {PROCESS_CHOICES.map((c) => (
          <option key={c.value} value={c.value} disabled={(!hasSel && !c.whole) || (cycles && c.notForCycles)}>
            {cycles && c.notForCycles ? `${c.label} (not for cycles)` : c.label}
          </option>
        ))}
      </Select>
      <Button disabled={!hasSel} onClick={a.snap} title="Move the selection edges to the nearest rising zero crossings">Snap</Button>
      <Button disabled={!edit} onClick={a.makeCycle} title="Make a single-cycle waveform from the selection, for the Sample Waveform module">Make Cycle…</Button>
      <span className={s.spacer} />
      <Button disabled={!edit} onClick={a.saveAs} title="Save the edited sample as a new sample in the list">Save As…</Button>
      <Button disabled={!edit} onClick={a.exportFile} title="Export sample to file">Export</Button>
      <span className={s.spacer} />
      <Button onClick={a.zoomOut} title="Zoom out, keeping the selection or cursor centred">zoom −</Button>
      <Button onClick={a.zoomIn} title="Zoom in, keeping the selection or cursor centred">zoom +</Button>
      <Button disabled={!selected} onClick={a.zoomSel} title="Zoom to the selection">zoom sel</Button>
      <Button onClick={a.zoomFit} title="Fit whole sample">zoom fit</Button>
      <Button onClick={a.close} title="Close editor">Close ×</Button>
    </div>
  )
}
