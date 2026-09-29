import { Button } from '../components/Button'
import s from './SampleEditor.module.css'

export type EditDialogKind = 'volume' | 'fadeIn' | 'fadeOut'

export interface EditorActions {
  play: () => void
  copy: () => void
  cut: () => void
  paste: () => void
  insert: () => void
  replace: () => void
  reverse: () => void
  openDialog: (kind: EditDialogKind) => void
  saveAs: () => void
  exportFile: () => void
  zoomOut: () => void
  zoomIn: () => void
  zoomFit: () => void
  close: () => void
}

export function EditorToolbar({ ready, hasSel, hasClip, actions: a }: {
  /** The sample is loaded and no save is running. */
  ready: boolean
  hasSel: boolean
  hasClip: boolean
  actions: EditorActions
}) {
  return (
    <div className={s.toolbar}>
      <Button disabled={!ready} onClick={a.play} title="Play from cursor/selection (Space)">▶ Play</Button>
      <span className={s.spacer} />
      <Button disabled={!hasSel} onClick={a.copy} title="Copy selection to paste buffer (⌘C)">Copy</Button>
      <Button disabled={!hasSel} onClick={a.cut} title="Cut selection to paste buffer (⌘X)">Cut</Button>
      <Button disabled={!hasClip} onClick={a.paste} title="Paste at cursor, overwriting (⌘V)">Paste</Button>
      <Button disabled={!hasClip} onClick={a.insert} title="Insert at cursor, shifting content">Insert</Button>
      <Button disabled={!hasSel || !hasClip} onClick={a.replace} title="Replace selection with paste buffer">Replace</Button>
      <Button disabled={!hasSel} onClick={a.reverse} title="Reverse selection (sounds backwards)">Reverse</Button>
      <Button disabled={!hasSel} onClick={() => a.openDialog('volume')} title="Change volume of selection">Volume…</Button>
      <Button disabled={!hasSel} onClick={() => a.openDialog('fadeIn')} title="Fade selection in (0→100%)">Fade In…</Button>
      <Button disabled={!hasSel} onClick={() => a.openDialog('fadeOut')} title="Fade selection out (100→0%)">Fade Out…</Button>
      <span className={s.spacer} />
      <Button disabled={!ready} onClick={a.saveAs} title="Save the edited sample as a new sample in the list">Save As…</Button>
      <Button disabled={!ready} onClick={a.exportFile} title="Export sample to file">Export</Button>
      <span className={s.spacer} />
      <Button onClick={a.zoomOut} title="Zoom out">zoom −</Button>
      <Button onClick={a.zoomIn} title="Zoom in">zoom +</Button>
      <Button onClick={a.zoomFit} title="Fit whole sample">zoom fit</Button>
      <Button onClick={a.close} title="Close editor">Close ×</Button>
    </div>
  )
}
