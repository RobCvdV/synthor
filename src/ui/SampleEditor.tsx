import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocStore } from '../state/docStore'
import { useAppStore } from '../state/appStore'
import { useSampleClipboard } from '../state/sampleClipboard'
import { readSampleAsset, writeSampleData } from '../persist/sampleStorage'
import { computeHash } from '../audio/sampleLoader'
import { encodeWav } from '../audio/wav'
import {
  copyRange, cutRange, fadeRange, framesOf, gainRange,
  insertAt, pasteAt, replaceRange, reverseRange,
  type PcmData,
} from '../audio/sampleEdit'
import { newSampleEntity } from '../domain/factory'
import { WAVEFORM_MAX_LENGTH_SECONDS } from '../domain/moduleDefs'
import { isEditableTarget } from './keymap'
import { formatDuration } from './format'
import { downloadBytes } from './download'
import type { AudioHost } from '../audio/host'
import type { Id } from '../domain/types'
import { sampleDialogOpenRef } from './sampleDialogRef'
import { SaveAsDialog } from './SampleSaveAsDialog'
import { EditDialog } from './SampleEditDialog'

/** Shared decode context for the editor (sampleLoader pattern). */
let _editorDecodeCtx: AudioContext | null = null
function editorDecodeCtx(): AudioContext {
  if (!_editorDecodeCtx) _editorDecodeCtx = new AudioContext()
  return _editorDecodeCtx
}

const LANE_H = 56
const LANE_GAP = 10
const EDGE_PX = 6
const MIN_PX = 0.001
const MAX_PX = 64
const WAVE_COLOR = '#4fd1c5'
const CENTER_COLOR = '#242a33'
const SEL_FILL = 'rgba(79, 209, 197, 0.12)'
const SEL_EDGE = 'rgba(79, 209, 197, 0.55)'
const CURSOR_COLOR = 'rgba(79, 209, 197, 0.55)'

interface Sel {
  start: number
  end: number
}

type Drag =
  | { mode: 'select'; anchor: number }
  | { mode: 'edge-start'; anchor: number }
  | { mode: 'edge-end'; anchor: number }

interface Props {
  host: AudioHost
  slug: string
  sampleId: Id
  onClose: () => void
  /** Switch the editor to another sample (used by Save As). */
  onSwitchSample: (id: Id) => void
}

/**
 * Waveform editor for one sample: channels-as-lanes (mono = 1, stereo = L/R),
 * zoom + thin scrollbar, click-to-cursor, drag/ctrl/shift selection with
 * draggable edges, and destructive-but-undoable edit ops. Every committed edit
 * re-encodes to a WAV, writes it to OPFS under a new content hash, and points
 * the entity at it via replaceSampleAsset — undo just reverts the pointer.
 */
export function SampleEditor({ host, slug, sampleId, onClose, onSwitchSample }: Props) {
  const entity = useDocStore((s) => s.doc.entities.samples[sampleId])

  const [pcm, setPcm] = useState<PcmData | null>(null)
  const [meta, setMeta] = useState<{ sampleRate: number; channels: number; frames: number } | null>(null)
  const [pcmVersion, setPcmVersion] = useState(0)
  const [pxPerFrame, setPxPerFrame] = useState(0.05)
  const [scroll, setScroll] = useState(0)
  const [cursor, setCursor] = useState<number | null>(null)
  const [sel, setSel] = useState<Sel | null>(null)
  const [dialog, setDialog] = useState<'volume' | 'fadeIn' | 'fadeOut' | null>(null)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [wrapW, setWrapW] = useState(0)

  const pb = useSampleClipboard((s) => s.pb)

  // Refs mirror state for handlers that must not close over stale values.
  const pcmRef = useRef(pcm)
  pcmRef.current = pcm
  const metaRef = useRef(meta)
  metaRef.current = meta
  const entityRef = useRef(entity)
  entityRef.current = entity
  const pxRef = useRef(pxPerFrame)
  pxRef.current = pxPerFrame
  const scrollRef = useRef(scroll)
  scrollRef.current = scroll
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const selRef = useRef(sel)
  selRef.current = sel
  const busyRef = useRef(busy)
  busyRef.current = busy
  const dialogOpenRef = useRef(dialog !== null)
  dialogOpenRef.current = dialog !== null
  const wrapWRef = useRef(wrapW)
  wrapWRef.current = wrapW

  const dragRef = useRef<Drag | null>(null)
  const scrollDragRef = useRef<{ grabOffset: number } | null>(null)
  const loadSeqRef = useRef(0)
  const fitQueuedRef = useRef(true)
  const waveCacheRef = useRef<HTMLCanvasElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const scrollbarRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)

  const lanes = pcm?.length ?? 0
  const frames = meta?.frames ?? 0

  /** True while any editor dialog is open — SampleLibraryView suppresses note keys. */
  useEffect(() => {
    sampleDialogOpenRef.current = dialog !== null
  }, [dialog])

  // Cut any ringing editor playback when closing the editor.
  useEffect(() => () => host.stopSamplePreviews(), [host])

  // ── Load / reload on hash change (undo/redo/relink all land here) ─────────
  useEffect(() => {
    const seq = ++loadSeqRef.current
    setLoadError(null)
    setBusy(true)
    const hash = entity?.hash
    if (!entity) {
      setPcm(null)
      setMeta(null)
      setBusy(false)
      return
    }
    void (async () => {
      try {
        const raw = await readSampleAsset(slug, hash)
        if (seq !== loadSeqRef.current) return
        if (!raw) {
          setPcm(null)
          setMeta(null)
          setLoadError('Binary missing — re-import to edit')
          return
        }
        const buf = await editorDecodeCtx().decodeAudioData(raw.slice(0))
        if (seq !== loadSeqRef.current) return
        const data =
          buf.numberOfChannels === 1
            ? [new Float32Array(buf.getChannelData(0))]
            : [0, 1].map((ch) => new Float32Array(buf.getChannelData(ch)))
        setPcm(data)
        setMeta({ sampleRate: buf.sampleRate, channels: buf.numberOfChannels, frames: buf.length })
        setPcmVersion((v) => v + 1)
        setCursor((c) => (c === null ? null : Math.min(c, buf.length)))
        setSel((s) => (s && s.start < buf.length ? { start: s.start, end: Math.min(s.end, buf.length) } : null))
        setScroll((sc) => clampScroll(sc, buf.length))
        fitQueuedRef.current = true
      } catch {
        if (seq === loadSeqRef.current) {
          setPcm(null)
          setMeta(null)
          setLoadError('Failed to decode sample binary')
        }
      } finally {
        if (seq === loadSeqRef.current) setBusy(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity?.hash, slug])

  // ── Waveform render: rebuild visible window, blit, overlay ───────────────
  const contentH = lanes * LANE_H + Math.max(0, lanes - 1) * LANE_GAP

  const rebuildCache = useCallback(() => {
    const wrap = wrapRef.current
    const data = pcmRef.current
    if (!wrap || !data || data.length === 0 || wrap.clientWidth === 0) {
      waveCacheRef.current = null
      return
    }
    const dpr = window.devicePixelRatio || 1
    const w = wrap.clientWidth
    const px = pxRef.current
    const sc = scrollRef.current
    const cache = document.createElement('canvas')
    cache.width = Math.ceil(w * dpr)
    cache.height = Math.ceil(contentH * dpr)
    const ctx = cache.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    for (let l = 0; l < data.length; l++) {
      const ch = data[l]
      const top = l * (LANE_H + LANE_GAP)
      ctx.fillStyle = CENTER_COLOR
      ctx.fillRect(0, top + LANE_H / 2, w, 1)
      ctx.fillStyle = WAVE_COLOR
      for (let x = 0; x < w; x++) {
        const f0 = Math.floor(sc + x / px)
        const f1 = Math.ceil(sc + (x + 1) / px) - 1
        if (f0 >= ch.length) break
        const hi = Math.min(f1, ch.length - 1)
        let mn = ch[f0]
        let mx = ch[f0]
        for (let f = f0 + 1; f <= hi; f++) {
          const v = ch[f]
          if (v < mn) mn = v
          if (v > mx) mx = v
        }
        const y0 = top + ((1 - mx) * LANE_H) / 2
        const y1 = top + ((1 - mn) * LANE_H) / 2
        ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0))
      }
    }
    waveCacheRef.current = cache
  }, [contentH])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    const cache = waveCacheRef.current
    if (!canvas || !wrap) return
    const dpr = window.devicePixelRatio || 1
    const w = wrap.clientWidth
    const h = wrap.clientHeight
    if (canvas.width !== Math.ceil(w * dpr) || canvas.height !== Math.ceil(h * dpr)) {
      canvas.width = Math.ceil(w * dpr)
      canvas.height = Math.ceil(h * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const top = Math.max(8, (h - contentH) / 2)

    if (cache) ctx.drawImage(cache, 0, 0, cache.width, cache.height, 0, top, w, contentH)

    // Lane labels.
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillStyle = 'rgba(107, 116, 128, 0.8)'
    const labels = lanes === 2 ? ['L', 'R'] : ['Mono']
    for (let l = 0; l < labels.length; l++) {
      ctx.fillText(labels[l], 4, top + l * (LANE_H + LANE_GAP) + 11)
    }

    // Selection overlay.
    const s = selRef.current
    if (s && pxRef.current > 0) {
      const x0 = (s.start - scrollRef.current) * pxRef.current
      const x1 = (s.end - scrollRef.current) * pxRef.current
      const cx0 = Math.max(0, x0)
      const cx1 = Math.min(w, x1)
      if (cx1 > cx0) {
        ctx.fillStyle = SEL_FILL
        ctx.fillRect(cx0, top, cx1 - cx0, contentH)
        ctx.fillStyle = SEL_EDGE
        ctx.fillRect(x0 - 1, top, 2, contentH)
        ctx.fillRect(x1 - 1, top, 2, contentH)
      }
    }

    // Cursor line.
    const c = cursorRef.current
    if (c !== null) {
      const x = (c - scrollRef.current) * pxRef.current
      if (x >= -2 && x <= w + 2) {
        ctx.fillStyle = CURSOR_COLOR
        ctx.fillRect(x - 1, top, 2, contentH)
      }
    }

    if (fitQueuedRef.current && w > 0 && framesOf(pcmRef.current ?? []) > 0) {
      fitQueuedRef.current = false
      setPxPerFrame(Math.max(MIN_PX, Math.min(MAX_PX, w / framesOf(pcmRef.current!))))
      setScroll(0)
    }
  }, [contentH])

  // Track wrap width for zoom-fit + scroll math.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth))
    ro.observe(el)
    setWrapW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    rebuildCache()
    draw()
  }, [rebuildCache, draw, pcmVersion, pxPerFrame, scroll, cursor, sel, wrapW, pcm])

  const clampScroll = useCallback((sc: number, totalFrames?: number) => {
    const f = totalFrames ?? metaRef.current?.frames ?? 0
    const max = Math.max(0, f - wrapWRef.current / Math.max(MIN_PX, pxRef.current))
    return Math.max(0, Math.min(max, sc))
  }, [])

  const setScrollClamped = useCallback(
    (sc: number) => setScroll(clampScroll(sc)),
    [clampScroll],
  )

  const frameAt = useCallback((clientX: number): number => {
    const canvas = canvasRef.current
    if (!canvas) return 0
    const x = clientX - canvas.getBoundingClientRect().left
    const f = scrollRef.current + x / Math.max(MIN_PX, pxRef.current)
    return Math.max(0, Math.min(metaRef.current?.frames ?? 0, Math.round(f)))
  }, [])

  // ── Pointer state machine ────────────────────────────────────────────────
  const startDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pcmRef.current || busyRef.current) return
    const f = frameAt(e.clientX)
    const s = selRef.current
    const x = e.clientX - canvasRef.current!.getBoundingClientRect().left
    const sc = scrollRef.current
    const px = pxRef.current

    // Edge grab (plain modifier state only).
    if (s && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (Math.abs((s.start - sc) * px - x) <= EDGE_PX) {
        dragRef.current = { mode: 'edge-start', anchor: s.start }
        startDrag(e)
        return
      }
      if (Math.abs((s.end - sc) * px - x) <= EDGE_PX) {
        dragRef.current = { mode: 'edge-end', anchor: s.end }
        startDrag(e)
        return
      }
    }

    if (e.ctrlKey || e.metaKey) {
      // Move the nearest selection edge to the clicked position.
      if (s) {
        let { start, end } = s
        if (Math.abs(start - f) <= Math.abs(end - f)) start = f
        else end = f
        if (start > end) [start, end] = [end, start]
        setSel({ start, end })
      }
      setCursor(f)
      return
    }

    if (e.shiftKey) {
      // Set (and drag) the selection endpoint.
      const next: Sel = s
        ? f < s.start
          ? { start: f, end: s.start }
          : { start: s.start, end: f }
        : { start: cursorRef.current ?? f, end: f }
      setSel(next)
      setCursor(f)
      dragRef.current = { mode: 'edge-end', anchor: next.end }
      startDrag(e)
      return
    }

    dragRef.current = { mode: 'select', anchor: f }
    setSel({ start: f, end: f })
    setCursor(f)
    startDrag(e)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    if (!d) return
    const f = frameAt(e.clientX)
    if (d.mode === 'select') {
      setSel({ start: Math.min(d.anchor, f), end: Math.max(d.anchor, f) })
      setCursor(f)
    } else if (d.mode === 'edge-start') {
      setSel((s) => {
        if (!s) return null
        const start = Math.min(f, s.end)
        return start === s.end ? null : { start, end: s.end }
      })
    } else {
      setSel((s) => {
        if (!s) return null
        const end = Math.max(f, s.start)
        return end === s.start ? null : { start: s.start, end }
      })
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    const d = dragRef.current
    dragRef.current = null
    // Plain click (no movement) = cursor only, no selection.
    if (d?.mode === 'select') {
      setSel((s) => (s && s.start === s.end ? null : s))
    }
  }

  // ── Scrollbar (custom thin div) ──────────────────────────────────────────
  const visibleFrames = wrapW / Math.max(MIN_PX, pxPerFrame)
  const maxScroll = Math.max(0, frames - visibleFrames)
  const thumbRatio = frames > 0 ? Math.min(1, visibleFrames / frames) : 1

  const scrollFromPointer = useCallback((clientX: number) => {
    const track = scrollbarRef.current
    const grab = scrollDragRef.current
    if (!track || !grab) return
    const rect = track.getBoundingClientRect()
    const trackW = rect.width
    const thumbW = Math.max(24, trackW * thumbRatio)
    const denom = Math.max(1, trackW - thumbW)
    const x = clientX - rect.left
    setScrollClamped(((x - grab.grabOffset) / denom) * maxScroll)
  }, [thumbRatio, maxScroll, setScrollClamped])

  const onScrollbarDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (maxScroll <= 0 || !scrollbarRef.current) return
    const rect = scrollbarRef.current.getBoundingClientRect()
    const trackW = rect.width
    const thumbW = Math.max(24, trackW * thumbRatio)
    const x = e.clientX - rect.left
    const thumbLeft = ((trackW - thumbW) * scroll) / maxScroll
    scrollDragRef.current =
      e.target === thumbRef.current
        ? { grabOffset: x - thumbLeft }
        : { grabOffset: thumbW / 2 }
    e.currentTarget.setPointerCapture(e.pointerId)
    scrollFromPointer(e.clientX)
  }

  const onScrollbarMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrollDragRef.current) scrollFromPointer(e.clientX)
  }

  const onScrollbarUp = (e: React.PointerEvent<HTMLDivElement>) => {
    scrollDragRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // Wheel: horizontal scroll; ctrl/meta+wheel zooms around the pointer.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!pcmRef.current) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      if (e.ctrlKey || e.metaKey) {
        const frame = scrollRef.current + x / Math.max(MIN_PX, pxRef.current)
        const next = Math.max(MIN_PX, Math.min(MAX_PX, pxRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
        setPxPerFrame(next)
        setScrollClamped(frame - x / next)
      } else {
        setScrollClamped(scrollRef.current + (e.deltaY + e.deltaX) * 2)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setScrollClamped])

  // ── Playback ─────────────────────────────────────────────────────────────
  const play = useCallback(async () => {
    const data = pcmRef.current
    const m = metaRef.current
    if (!data || !m) return
    host.stopSamplePreviews()
    const s = selRef.current
    const offset = (s ? s.start : cursorRef.current ?? 0) / m.sampleRate
    void host.playPcmPreview(data, m.sampleRate, offset)
  }, [host])

  // ── Commit + edit ops ────────────────────────────────────────────────────
  const commit = useCallback(
    async (newPcm: PcmData) => {
      const m = metaRef.current
      const ent = entityRef.current
      if (!m || !ent) return
      setBusy(true)
      try {
        const bytes = encodeWav(newPcm, m.sampleRate)
        const hash = await computeHash(bytes)
        const newFrames = framesOf(newPcm)
        if (hash !== ent.hash || newFrames !== m.frames) {
          await writeSampleData(slug, hash, bytes)
          useDocStore.getState().replaceSampleAsset(ent.id, hash, ent.originalName, m.sampleRate, newPcm.length, newFrames)
        }
        setPcm(newPcm)
        setMeta({ ...m, frames: newFrames })
        setPcmVersion((v) => v + 1)
        setCursor((c) => (c === null ? null : Math.min(c, newFrames)))
        setSel((s) => (s && s.start < newFrames ? { start: s.start, end: Math.min(s.end, newFrames) } : null))
        setScroll((sc) => clampScroll(sc, newFrames))
      } catch (err) {
        setLoadError('Save failed — ' + String(err))
      } finally {
        setBusy(false)
      }
    },
    [slug, clampScroll],
  )

  const doCopy = useCallback(() => {
    const s = selRef.current
    const data = pcmRef.current
    const m = metaRef.current
    if (!s || !data || !m) return
    const copied = copyRange(data, s.start, s.end)
    useSampleClipboard.getState().setClipboard({
      data: copied,
      sampleRate: m.sampleRate,
      channels: data.length,
      frames: framesOf(copied),
    })
  }, [])

  const doCut = useCallback(() => {
    const s = selRef.current
    const data = pcmRef.current
    const m = metaRef.current
    if (!s || !data || !m) return
    const { data: rest, removed } = cutRange(data, s.start, s.end)
    useSampleClipboard.getState().setClipboard({
      data: removed,
      sampleRate: m.sampleRate,
      channels: data.length,
      frames: framesOf(removed),
    })
    setSel(null)
    setCursor(s.start)
    void commit(rest)
  }, [commit])

  const doPaste = useCallback(() => {
    const clip = useSampleClipboard.getState().pb
    const data = pcmRef.current
    if (!clip || !data) return
    const at = cursorRef.current ?? 0
    const out = pasteAt(data, at, clip.data)
    setCursor(at)
    setSel({ start: at, end: Math.min(framesOf(out), at + clip.frames) })
    void commit(out)
  }, [commit])

  const doInsert = useCallback(() => {
    const clip = useSampleClipboard.getState().pb
    const data = pcmRef.current
    if (!clip || !data) return
    const at = cursorRef.current ?? 0
    const out = insertAt(data, at, clip.data)
    setCursor(at)
    setSel({ start: at, end: Math.min(framesOf(out), at + clip.frames) })
    void commit(out)
  }, [commit])

  const doReplace = useCallback(() => {
    const s = selRef.current
    const clip = useSampleClipboard.getState().pb
    const data = pcmRef.current
    if (!s || !clip || !data) return
    const out = replaceRange(data, s.start, s.end, clip.data)
    setCursor(s.start)
    setSel({ start: s.start, end: Math.min(framesOf(out), s.start + clip.frames) })
    void commit(out)
  }, [commit])

  const doReverse = useCallback(() => {
    const s = selRef.current
    const data = pcmRef.current
    if (!s || !data) return
    void commit(reverseRange(data, s.start, s.end))
  }, [commit])

  const applyVolume = useCallback(
    (pct: number) => {
      const s = selRef.current
      const data = pcmRef.current
      if (!s || !data) return
      void commit(gainRange(data, s.start, s.end, pct / 100))
    },
    [commit],
  )

  const applyFade = useCallback(
    (from: number, to: number) => {
      const s = selRef.current
      const data = pcmRef.current
      if (!s || !data) return
      void commit(fadeRange(data, s.start, s.end, from / 100, to / 100))
    },
    [commit],
  )

  // ── Export / Save As ─────────────────────────────────────────────────────
  const doExport = useCallback(async () => {
    const ent = entityRef.current
    if (!ent) return
    const raw = await readSampleAsset(slug, ent.hash).catch(() => null)
    if (!raw) return
    // Unedited samples export as the original bytes/format; edits are stored
    // as WAV, so use a .wav name when the stored file is ours (RIFF magic).
    const bytes = new Uint8Array(raw)
    const isWav =
      bytes.length >= 4 &&
      String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF'
    downloadBytes(raw, isWav ? `${ent.name}.wav` : ent.originalName)
  }, [slug])

  const doSaveAs = useCallback(
    async (name: string) => {
      const m = metaRef.current
      const data = pcmRef.current
      if (!m || !data) return
      setBusy(true)
      try {
        const bytes = encodeWav(data, m.sampleRate)
        const hash = await computeHash(bytes)
        await writeSampleData(slug, hash, bytes)
        const sample = newSampleEntity(name, hash, `${name}.wav`, m.sampleRate, data.length, framesOf(data))
        useDocStore.getState().addSampleEntity(sample)
        useAppStore.getState().setSelectedSampleId(sample.id)
        onSwitchSample(sample.id)
      } catch (err) {
        setLoadError('Save as failed — ' + String(err))
      } finally {
        setBusy(false)
      }
    },
    [slug, onSwitchSample],
  )

  // ── Keyboard: capture phase so Space/Cmd+C/V/X beat App's global handlers
  //    regardless of listener registration order (this component mounts later).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (dialogOpenRef.current || isEditableTarget(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      if (e.code === 'Space' && !mod && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        void play()
        return
      }
      if (mod && !e.altKey && e.shiftKey === false) {
        if (e.code === 'KeyC') {
          e.preventDefault()
          e.stopPropagation()
          doCopy()
        } else if (e.code === 'KeyX') {
          e.preventDefault()
          e.stopPropagation()
          doCut()
        } else if (e.code === 'KeyV') {
          e.preventDefault()
          e.stopPropagation()
          doPaste()
        }
      }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [play, doCopy, doCut, doPaste])

  const missing = !entity || loadError !== null || (!pcm && !busy)
  const hasSel = sel !== null
  const tooLongForWave = meta !== null && meta.frames / meta.sampleRate > WAVEFORM_MAX_LENGTH_SECONDS
  const thumbW = Math.max(24, (wrapW || 1) * thumbRatio)
  const thumbLeft = maxScroll > 0 ? (((wrapW || 1) - thumbW) * scroll) / maxScroll : 0

  return (
    <div className="sample-editor">
      <div className="se-toolbar">
        <button className="octbtn" disabled={missing || busy} onClick={() => void play()} title="Play from cursor/selection (Space)">
          ▶ Play
        </button>
        <span className="spacer" />
        <button className="octbtn" disabled={!hasSel} onClick={doCopy} title="Copy selection to paste buffer (⌘C)">
          Copy
        </button>
        <button className="octbtn" disabled={!hasSel} onClick={doCut} title="Cut selection to paste buffer (⌘X)">
          Cut
        </button>
        <button className="octbtn" disabled={!pb} onClick={doPaste} title="Paste at cursor, overwriting (⌘V)">
          Paste
        </button>
        <button className="octbtn" disabled={!pb} onClick={doInsert} title="Insert at cursor, shifting content">
          Insert
        </button>
        <button className="octbtn" disabled={!hasSel || !pb} onClick={doReplace} title="Replace selection with paste buffer">
          Replace
        </button>
        <button className="octbtn" disabled={!hasSel} onClick={doReverse} title="Reverse selection (sounds backwards)">
          Reverse
        </button>
        <button className="octbtn" disabled={!hasSel} onClick={() => setDialog('volume')} title="Change volume of selection">
          Volume…
        </button>
        <button className="octbtn" disabled={!hasSel} onClick={() => setDialog('fadeIn')} title="Fade selection in (0→100%)">
          Fade In…
        </button>
        <button className="octbtn" disabled={!hasSel} onClick={() => setDialog('fadeOut')} title="Fade selection out (100→0%)">
          Fade Out…
        </button>
        <span className="spacer" />
        <button
          className="octbtn"
          disabled={missing || busy}
          onClick={() => setSaveAsOpen(true)}
          title="Save the edited sample as a new sample in the list"
        >
          Save As…
        </button>
        <button
          className="octbtn"
          disabled={missing || busy}
          onClick={() => void doExport()}
          title="Export sample to file"
        >
          Export
        </button>
        <span className="spacer" />
        <button className="octbtn" onClick={() => setPxPerFrame((p) => Math.max(MIN_PX, p / 2))} title="Zoom out">
          zoom −
        </button>
        <button className="octbtn" onClick={() => setPxPerFrame((p) => Math.min(MAX_PX, p * 2))} title="Zoom in">
          zoom +
        </button>
        <button
          className="octbtn"
          onClick={() => {
            if (frames > 0 && wrapW > 0) {
              setPxPerFrame(Math.max(MIN_PX, Math.min(MAX_PX, wrapW / frames)))
              setScroll(0)
            }
          }}
          title="Fit whole sample"
        >
          zoom fit
        </button>
        <button className="octbtn" onClick={onClose} title="Close editor">
          Close ×
        </button>
      </div>

      {meta && entity && (
        <div className="se-info">
          <span>
            {entity.name} · {meta.sampleRate.toLocaleString()} Hz · {meta.channels === 2 ? 'stereo' : 'mono'} · {formatDuration(meta.sampleRate, meta.frames)}
          </span>
          {tooLongForWave && <span className="se-hint-warn">&gt; {WAVEFORM_MAX_LENGTH_SECONDS}s — hidden from wave module pickers</span>}
        </div>
      )}

      <div className="se-wave-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="se-wave-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
        {missing && (
          <div className="se-overlay">
            <p className="muted">{entity ? loadError ?? 'Loading…' : 'Sample deleted'}</p>
          </div>
        )}
      </div>

      <div
        className={'se-scrollbar' + (maxScroll <= 0 ? ' disabled' : '')}
        ref={scrollbarRef}
        onPointerDown={onScrollbarDown}
        onPointerMove={onScrollbarMove}
        onPointerUp={onScrollbarUp}
      >
        {maxScroll > 0 && (
          <div
            className="se-scroll-thumb"
            ref={thumbRef}
            style={{ width: thumbW, left: thumbLeft }}
          />
        )}
      </div>

      {dialog !== null && sel && (
        <EditDialog
          kind={dialog}
          onClose={() => setDialog(null)}
          onApplyVolume={applyVolume}
          onApplyFade={applyFade}
        />
      )}

      {saveAsOpen && entity && (
        <SaveAsDialog
          defaultName={`${entity.name} copy`}
          busy={busy}
          onClose={() => setSaveAsOpen(false)}
          onSave={(name) => void doSaveAs(name)}
        />
      )}
    </div>
  )
}

