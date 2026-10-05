import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AudioHost } from '../../audio/host'
import { drawLine, framesOf, type PcmData } from '../../audio/sampleEdit'
import { fitsWavetable, waveUse } from '../../domain/sampleChoices'
import type { Id } from '../../domain/types'
import { useAppStore } from '../../state/appStore'
import { useDocStore } from '../../state/docStore'
import { useSampleClipboard } from '../../state/sampleClipboard'
import { formatDuration } from '../format'
import { isEditableTarget } from '../keymap'
import { sampleDialogOpenRef } from '../sampleDialogRef'
import {
  copySelection, cutSelection, fadeSelection, gainSelection, normalizeSelection, pasteClip, removeDcSelection,
  repitchSelection, replaceSelection, reverseSelection, silenceSelection, snapSelection, targetRange, trimSelection,
  type EditResult,
} from './editCommands'
import { EditorToolbar, type EditDialogKind, type EditorActions, type ProcessKind } from './EditorToolbar'
import { EditDialog } from './SampleEditDialog'
import { MakeCycleDialog } from './MakeCycleDialog'
import { SaveAsDialog } from './SampleSaveAsDialog'
import { fitToLength, pointerDown, pointerMove, pointerUp, type Drag, type Sel } from './selectionGestures'
import { useSamplePcm } from './useSamplePcm'
import { useWaveformCanvas } from './useWaveformCanvas'
import { useElementSize, useWaveView } from './useWaveView'
import { WaveScrollbar } from './WaveScrollbar'
import { frameAtX, laneAt, laneLayout, valueAtY, visibleFrames } from './waveView'
import { AmplitudeAxis } from './AmplitudeAxis'
import s from './SampleEditor.module.css'

interface Props {
  host: AudioHost
  slug: string
  sampleId: Id
  onClose: () => void
  /** Switch the editor to another sample (used by Save As). */
  onSwitchSample: (id: Id) => void
}

/**
 * Waveform editor for one sample: channels as lanes, zoom and scroll, click-to-cursor, drag /
 * Cmd / Shift selection with draggable edges, and destructive but undoable edit commands.
 */
export function SampleEditor({ host, slug, sampleId, onClose, onSwitchSample }: Props) {
  const entity = useDocStore((st) => st.doc.entities.samples[sampleId])
  const sample = useSamplePcm(slug, entity)
  const { pcm, meta, busy, commit } = sample
  const frames = meta?.frames ?? 0

  const [cursor, setCursor] = useState<number | null>(null)
  const [sel, setSel] = useState<Sel | null>(null)
  const [dialog, setDialog] = useState<EditDialogKind | null>(null)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [cycleRange, setCycleRange] = useState<Sel | null>(null)
  const [drawing, setDrawing] = useState(false)
  /** The audio being drawn on; committed as one edit when the stroke ends. */
  const [draft, setDraft] = useState<PcmData | null>(null)
  const stroke = useRef<{ data: PcmData; lane: number; frame: number; value: number } | null>(null)
  const clip = useSampleClipboard((st) => st.pb)

  const waveRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { width, height } = useElementSize(waveRef)
  const view = useWaveView(frames, width, waveRef)
  const { fit } = view
  const laneCount = pcm?.length ?? 0
  const lanes = useMemo(() => laneLayout(height, laneCount), [height, laneCount])
  useWaveformCanvas(canvasRef, { pcm: draft ?? pcm, width, height, lanes, px: view.px, scroll: view.scroll, sel, cursor })

  // Handlers read the latest values without re-subscribing.
  const live = useRef({ pcm, meta, sel, cursor, busy, dialog, view, cycleRange, drawing, lanes })
  live.current = { pcm, meta, sel, cursor, busy, dialog, view, cycleRange, drawing, lanes }
  const drag = useRef<Drag | null>(null)

  useEffect(() => { sampleDialogOpenRef.current = dialog !== null || cycleRange !== null }, [dialog, cycleRange])
  useEffect(() => () => host.stopSamplePreviews(), [host])

  // A shorter sample (edit, undo, relink) must not leave the cursor or selection past its end.
  useEffect(() => {
    const fitted = fitToLength(live.current.sel, live.current.cursor, frames)
    setSel(fitted.sel)
    setCursor(fitted.cursor)
  }, [frames])

  // Show a freshly loaded sample whole, once the waveform area has a width.
  const fitPending = useRef(false)
  useEffect(() => { if (sample.loads > 0) fitPending.current = true }, [sample.loads])
  useEffect(() => {
    if (fitPending.current && width > 0 && frames > 0) {
      fitPending.current = false
      fit()
    }
  }, [sample.loads, width, frames, fit])

  // ── Edits ─────────────────────────────────────────────────────────────────
  const apply = useCallback((result: EditResult | null) => {
    if (!result) return
    setSel(result.sel)
    setCursor(result.cursor)
    void commit(result.pcm)
  }, [commit])

  const editState = () => {
    const { pcm: data, sel: sl, cursor: c } = live.current
    return data ? { pcm: data, sel: sl, cursor: c } : null
  }
  const toClipboard = (data: typeof pcm) => {
    const m = live.current.meta
    if (data && m) useSampleClipboard.getState().setClipboard({ data, sampleRate: m.sampleRate, channels: data.length, frames: framesOf(data) })
  }

  const play = useCallback(() => {
    const { pcm: data, meta: m, sel: sl, cursor: c } = live.current
    if (!data || !m) return
    host.stopSamplePreviews()
    void host.playPcmPreview(data, m.sampleRate, (sl ? sl.start : c ?? 0) / m.sampleRate)
  }, [host])

  const copy = useCallback(() => {
    const st = editState()
    if (st) toClipboard(copySelection(st))
  }, [])

  const cut = useCallback(() => {
    const st = editState()
    const result = st && cutSelection(st)
    if (!result) return
    toClipboard(result.removed)
    apply(result)
  }, [apply])

  const paste = useCallback((mode: 'overwrite' | 'insert') => {
    const st = editState()
    const pb = useSampleClipboard.getState().pb
    if (st && pb) apply(pasteClip(st, pb.data, mode))
  }, [apply])

  /** What zooming keeps centred: the selection, else the cursor, else the view's middle. */
  const zoomFocus = () => {
    const { sel: sl, cursor: c } = live.current
    return sl ? (sl.start + sl.end) / 2 : c ?? undefined
  }

  const actions: EditorActions = {
    play,
    copy,
    cut,
    paste: () => paste('overwrite'),
    insert: () => paste('insert'),
    replace: () => {
      const st = editState()
      const pb = useSampleClipboard.getState().pb
      if (st && pb) apply(replaceSelection(st, pb.data))
    },
    reverse: () => { const st = editState(); if (st) apply(reverseSelection(st)) },
    snap: () => { const st = editState(); const next = st && snapSelection(st); if (next) setSel(next) },
    process: (kind: ProcessKind) => {
      const st = editState()
      if (!st) return
      if (kind === 'pitch') setDialog('pitch')
      else apply({ trim: trimSelection, silence: silenceSelection, normalize: normalizeSelection, removeDc: removeDcSelection }[kind](st))
    },
    toggleDraw: () => setDrawing((d) => !d),
    makeCycle: () => { const st = editState(); if (st) setCycleRange(targetRange(st)) },
    openDialog: setDialog,
    saveAs: () => setSaveAsOpen(true),
    exportFile: () => void sample.exportFile(),
    zoomOut: () => view.zoomBy(0.5, zoomFocus()),
    zoomIn: () => view.zoomBy(2, zoomFocus()),
    zoomSel: () => { const sl = live.current.sel; if (sl) view.zoomTo(sl.start, sl.end) },
    zoomFit: view.fit,
    close: onClose,
  }

  const previewPcm = (data: PcmData) => {
    const m = live.current.meta
    if (!m) return
    host.stopSamplePreviews()
    void host.playPcmPreview(data, m.sampleRate)
  }

  const saveAs = async (name: string, data?: PcmData, cycleLength?: number) => {
    const created = await sample.saveAs(name, data, cycleLength)
    if (!created) return
    setCycleRange(null)
    useAppStore.getState().setSelectedSampleId(created.id)
    onSwitchSample(created.id)
  }

  // Capture phase, so Space and Cmd+C/X/V win over the app-wide handlers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (live.current.dialog || live.current.cycleRange || isEditableTarget(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const handler =
        e.code === 'Space' && !mod && !e.altKey ? play
          : mod && !e.altKey && !e.shiftKey ? { KeyC: copy, KeyX: cut, KeyV: () => paste('overwrite') }[e.code as 'KeyC']
            : undefined
      if (!handler) return
      e.preventDefault()
      e.stopPropagation()
      handler()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [play, copy, cut, paste])

  // ── Pointer gestures on the waveform ──────────────────────────────────────
  // Presses anywhere in the wave box count, measured from the waveform's left edge: the axis and the
  // right gutter lie outside the sample, so a drag from there starts at its very start or end.
  const pointerX = (e: React.PointerEvent) => e.clientX - (waveRef.current?.getBoundingClientRect().left ?? 0)
  const pointerY = (e: React.PointerEvent) => e.clientY - (waveRef.current?.getBoundingClientRect().top ?? 0)
  const frameOf = (x: number) => frameAtX(x, live.current.view.scroll, live.current.view.px, frames)

  // Draw strokes: each move draws a line from the last point, so fast drags leave no gaps.
  const drawTo = (e: React.PointerEvent) => {
    const s0 = stroke.current
    if (!s0) return
    const frame = Math.min(frames - 1, frameOf(pointerX(e)))
    const value = valueAtY(live.current.lanes[s0.lane], pointerY(e))
    drawLine(s0.data[s0.lane], s0.frame, s0.value, frame, value)
    stroke.current = { ...s0, frame, value }
    setDraft([...s0.data])
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const { pcm: data, busy: isBusy, drawing: isDrawing, lanes: laneList } = live.current
    if (!data || isBusy) return
    if (isDrawing) {
      const lane = laneAt(laneList, pointerY(e))
      const frame = Math.min(frames - 1, frameOf(pointerX(e)))
      const value = valueAtY(laneList[lane], pointerY(e))
      stroke.current = { data: data.map((ch) => new Float32Array(ch)), lane, frame, value }
      drawTo(e)
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    const x = pointerX(e)
    const next = pointerDown({
      frame: frameOf(x), x, scroll: view.scroll, px: view.px, sel, cursor,
      mod: e.ctrlKey || e.metaKey, shift: e.shiftKey,
    })
    setSel(next.sel)
    setCursor(next.cursor)
    drag.current = next.drag
    if (next.drag) e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stroke.current) return drawTo(e)
    if (!drag.current) return
    const next = pointerMove(drag.current, frameOf(pointerX(e)), live.current.sel, live.current.cursor)
    setSel(next.sel)
    setCursor(next.cursor)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (stroke.current) {
      const data = stroke.current.data
      stroke.current = null
      void commit(data).finally(() => setDraft(null))
      return
    }
    setSel(pointerUp(drag.current, live.current.sel))
    drag.current = null
  }

  const missing = !entity || sample.error !== null || (!pcm && !busy)

  return (
    <div className={s.editor}>
      <EditorToolbar ready={!missing && !busy} hasSel={sel !== null} hasClip={clip !== null} drawing={drawing} actions={actions} />

      {meta && entity && (
        <div className={s.info}>
          <span>
            {entity.name} · {meta.sampleRate.toLocaleString()} Hz · {meta.channels === 2 ? 'stereo' : 'mono'} · {formatDuration(meta.sampleRate, meta.frames)}
          </span>
          <span className={fitsWavetable(meta) ? undefined : s.warn}>{waveUse(meta)}</span>
        </div>
      )}

      <div className={drawing ? `${s.wave} ${s.drawing}` : s.wave} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <AmplitudeAxis lanes={lanes} />
        <div className={s.canvasBox} ref={waveRef}>
          <canvas ref={canvasRef} className={s.canvas} />
        </div>
        <div className={s.gutter} />
        {missing && (
          <div className={s.overlay}>
            <p className="muted">{entity ? sample.error ?? 'Loading…' : 'Sample deleted'}</p>
          </div>
        )}
      </div>

      <WaveScrollbar width={width} frames={frames} visible={visibleFrames(width, view.px)}
        scroll={view.scroll} onScroll={view.setScroll} />

      {dialog && (sel || dialog === 'pitch') && (
        <EditDialog kind={dialog} onClose={() => setDialog(null)}
          onApplyVolume={(pct) => { const st = editState(); if (st) apply(gainSelection(st, pct)) }}
          onApplyFade={(from, to) => { const st = editState(); if (st) apply(fadeSelection(st, from, to)) }}
          onApplyPitch={(semis) => { const st = editState(); if (st) apply(repitchSelection(st, semis)) }} />
      )}

      {cycleRange && pcm && meta && entity && (
        <MakeCycleDialog pcm={pcm} range={cycleRange} sampleRate={meta.sampleRate} defaultName={entity.name}
          busy={busy} onPreview={previewPcm} onSave={(name, cycle, length) => void saveAs(name, cycle, length)}
          onClose={() => setCycleRange(null)} />
      )}

      {saveAsOpen && entity && (
        <SaveAsDialog defaultName={`${entity.name} copy`} busy={busy}
          onClose={() => setSaveAsOpen(false)} onSave={(name) => void saveAs(name)} />
      )}
    </div>
  )
}
