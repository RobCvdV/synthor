import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { createDefaultDoc } from '../domain/factory'
import { deleteSong, isOpfsSupported, listSongs, readSong, saveRecent } from '../persist/opfsStore'
import { currentSongFile, saveCurrentSong } from '../persist/saveCurrent'
import { serializeSong, type SongFile } from '../persist/serialize'
import { exportSongZip, importSongZip } from '../persist/songExport'
import { Legend } from './Legend'
import type { Doc, Id } from '../domain/types'

type TabId = 'arrange' | 'store' | 'legend'

interface Props {
  doc: Doc
  /** Current OPFS slug for save/export. */
  slug: string
}

type Entry = { slug: string; meta: SongFile['meta'] }

/** Right-side pane for the tracker view with Arrange, Store, and Legend tabs. */
export function TrackerRightPane({ doc, slug }: Props) {
  const [tab, setTab] = useState<TabId>('arrange')

  return (
    <aside className="tracker-pane">
      <div className="tracker-pane-tabs">
        {(['arrange', 'store', 'legend'] as TabId[]).map((t) => (
          <button
            key={t}
            className={'tracker-pane-tab' + (tab === t ? ' active' : '')}
            onClick={() => setTab(t)}
          >
            {t === 'arrange' ? 'Arrange' : t === 'store' ? 'Store' : 'Legend'}
          </button>
        ))}
      </div>
      <div className="tracker-pane-body">
        {tab === 'arrange' && <ArrangeTab doc={doc} />}
        {tab === 'store' && <StoreTab slug={slug} />}
        {tab === 'legend' && <Legend />}
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------ */
/*  Arrange tab — pattern palette, sections, drag-and-drop             */
/* ------------------------------------------------------------------ */

/** Where a drop indicator should appear. */
type DropLine = { idx: number; edge: 'above' | 'below' } | null
type PatDropLine = { secId: Id; idx: number; edge: 'above' | 'below' } | null

function ArrangeTab({ doc }: { doc: Doc }) {
  const addSection = useDocStore((s) => s.addSection)
  const removeSection = useDocStore((s) => s.removeSection)
  const renameSection = useDocStore((s) => s.renameSection)
  const addPattern = useDocStore((s) => s.addPattern)
  const removePattern = useDocStore((s) => s.removePattern)
  const duplicatePattern = useDocStore((s) => s.duplicatePattern)
  const addPatternToSection = useDocStore((s) => s.addPatternToSection)
  const removePatternFromSection = useDocStore((s) => s.removePatternFromSection)
  const setCurrentPattern = useDocStore((s) => s.setCurrentPattern)
  const renamePattern = useDocStore((s) => s.renamePattern)
  const reorderSections = useDocStore((s) => s.reorderSections)
  const reorderPatternsInSection = useDocStore((s) => s.reorderPatternsInSection)

  const [editingSection, setEditingSection] = useState<Id | null>(null)
  const [editingPattern, setEditingPattern] = useState<Id | null>(null)
  const [editingPalettePat, setEditingPalettePat] = useState<Id | null>(null)

  // Refs to section DOM elements for container-level hit testing
  const sectionEls = useRef<Map<Id, HTMLDivElement>>(new Map())

  // The pattern palette's scroll container, so the current pattern can be
  // scrolled into view when the selection changes.
  const paletteListRef = useRef<HTMLDivElement>(null)

  // Keep the current pattern visible in the palette (e.g. right after adding).
  useEffect(() => {
    const list = paletteListRef.current
    if (!list) return
    const item = list.querySelector<HTMLElement>('.arrange-palette-item.current')
    if (!item) return
    const listRect = list.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
      list.scrollTop += itemRect.top - listRect.top - (list.clientHeight - itemRect.height) / 2
    }
  }, [doc.patternId])

  // Drag state — persisted in refs for synchronous access during onDragOver
  const dragRef = useRef<{
    kind: 'pattern' | 'section' | null
    patId?: Id
    secId?: Id       // source section for pattern drag (undefined = from palette)
    patIdx?: number  // source index within source section
    secIdx?: number  // source section index for section drag
  }>({ kind: null })

  const [secLine, setSecLine] = useState<DropLine>(null)
  const [patLine, setPatLine] = useState<PatDropLine>(null)

  const allPatterns = useMemo(
    () => Object.values(doc.entities.patterns).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [doc.entities.patterns],
  )

  /* ---- compute section drop position from cursor Y ---- */

  const secDropFromY = useCallback((clientY: number): DropLine => {
    const n = doc.sectionIds.length
    if (n === 0) return null
    // Check each section rect
    for (let i = 0; i < n; i++) {
      const el = sectionEls.current.get(doc.sectionIds[i])
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (clientY >= r.top && clientY <= r.bottom) {
        return { idx: i, edge: clientY < r.top + r.height / 2 ? 'above' : 'below' }
      }
    }
    // Cursor outside all sections — snap to nearest edge
    const first = sectionEls.current.get(doc.sectionIds[0])?.getBoundingClientRect()
    if (first && clientY < first.top) return { idx: 0, edge: 'above' }
    const last = sectionEls.current.get(doc.sectionIds[n - 1])?.getBoundingClientRect()
    if (last && clientY > last.bottom) return { idx: n - 1, edge: 'below' }
    // Between sections — find nearest gap
    for (let i = 0; i < n - 1; i++) {
      const curEl = sectionEls.current.get(doc.sectionIds[i])
      const nextEl = sectionEls.current.get(doc.sectionIds[i + 1])
      if (!curEl || !nextEl) continue
      const curBot = curEl.getBoundingClientRect().bottom
      const nextTop = nextEl.getBoundingClientRect().top
      if (clientY >= curBot && clientY <= nextTop) {
        return clientY < (curBot + nextTop) / 2
          ? { idx: i, edge: 'below' }
          : { idx: i + 1, edge: 'above' }
      }
    }
    return null
  }, [doc.sectionIds])

  /* ---- compute pattern drop position from cursor Y within a section ---- */

  const patDropFromY = useCallback((secId: Id, clientY: number): { idx: number; edge: 'above' | 'below' } | null => {
    const secEl = sectionEls.current.get(secId)
    if (!secEl) return null
    const items = secEl.querySelectorAll<HTMLElement>('[data-pat-id]')
    // Empty section: check if cursor is within the section's pattern list area
    if (items.length === 0) {
      const ul = secEl.querySelector<HTMLElement>('.arrange-pattern-list')
      if (ul) {
        const r = ul.getBoundingClientRect()
        if (clientY >= r.top && clientY <= r.bottom) return { idx: 0, edge: 'below' }
      }
      return null
    }
    // Check each item rect
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect()
      if (clientY >= r.top && clientY <= r.bottom) {
        return { idx: i, edge: clientY < r.top + r.height / 2 ? 'above' : 'below' }
      }
    }
    // Below all items → append at end
    const lastR = items[items.length - 1]?.getBoundingClientRect()
    if (lastR && clientY > lastR.bottom) return { idx: items.length - 1, edge: 'below' }
    // Above all items → prepend
    const firstR = items[0]?.getBoundingClientRect()
    if (firstR && clientY < firstR.top) return { idx: 0, edge: 'above' }
    return null
  }, [])

  /* ---- unified container drag-over (section + pattern) ---- */

  const onContainerDragOver = useCallback((e: React.DragEvent) => {
    const k = dragRef.current.kind
    if (k === 'section') {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setSecLine(secDropFromY(e.clientY))
      setPatLine(null)
    } else if (k === 'pattern') {
      // Only handle if the event wasn't already stopped by a child handler
      if (e.isPropagationStopped()) return
      e.preventDefault()
      e.dataTransfer.dropEffect = dragRef.current.secId ? 'move' : 'copy'
      setSecLine(null)
      // Find which section the cursor is over and show pattern drop indicator
      for (const secId of doc.sectionIds) {
        const secEl = sectionEls.current.get(secId)
        if (!secEl) continue
        const r = secEl.getBoundingClientRect()
        if (e.clientY >= r.top && e.clientY <= r.bottom && e.clientY <= r.top + 26) {
          // Cursor is over the section header — don't show pattern indicator here
          setPatLine(null)
          return
        }
        if (e.clientY >= r.top && e.clientY <= r.bottom) {
          const pos = patDropFromY(secId, e.clientY)
          setPatLine(pos ? { secId, ...pos } : null)
          return
        }
      }
    }
  }, [secDropFromY, doc.sectionIds, patDropFromY])

  const onContainerDrop = useCallback((e: React.DragEvent) => {
    const d = dragRef.current
    if (d.kind === 'section' && d.secIdx !== undefined) {
      e.preventDefault()
      const pos = secDropFromY(e.clientY)
      setSecLine(null)
      dragRef.current = { kind: null }
      if (!pos) return
      const fromIdx = d.secIdx
      const toIdx = pos.edge === 'above' ? pos.idx : pos.idx + 1
      if (fromIdx === toIdx || fromIdx + 1 === toIdx) return
      reorderSections(fromIdx, toIdx > fromIdx ? toIdx - 1 : toIdx)
    } else if (d.kind === 'pattern' && d.patId) {
      e.preventDefault()
      setPatLine(null)
      dragRef.current = { kind: null }

      // Find which section the cursor is over via DOM hit-testing
      let targetSecId: Id | null = null
      for (const secId of doc.sectionIds) {
        const el = sectionEls.current.get(secId)
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (e.clientY >= r.top && e.clientY <= r.bottom) {
          targetSecId = secId
          break
        }
      }
      if (!targetSecId) return

      // Compute insertion position from cursor Y
      const pos = patDropFromY(targetSecId, e.clientY)
      const insertIdx = pos
        ? (pos.edge === 'above' ? pos.idx : pos.idx + 1)
        : (doc.entities.sections[targetSecId]?.patternIds.length ?? 0)

      if (d.secId === targetSecId) {
        // Intra-section reorder
        const fromIdx = d.patIdx ?? -1
        if (fromIdx < 0) return
        const adjusted = insertIdx > fromIdx ? insertIdx - 1 : insertIdx
        if (adjusted === fromIdx) return
        reorderPatternsInSection(targetSecId, fromIdx, adjusted)
      } else if (d.secId) {
        // Cross-section move: re-derive source index from current doc state
        const fromSection = doc.entities.sections[d.secId]
        const fromIdx = fromSection?.patternIds.indexOf(d.patId) ?? -1
        if (fromIdx >= 0) {
          removePatternFromSection(d.secId, fromIdx)
          addPatternToSection(targetSecId, d.patId, insertIdx)
        }
      } else {
        // From palette — just add
        addPatternToSection(targetSecId, d.patId, insertIdx)
      }
    }
  }, [
    secDropFromY, reorderSections,
    patDropFromY,
    doc.sectionIds, doc.entities.sections,
    reorderPatternsInSection, removePatternFromSection, addPatternToSection,
  ])

  /* ---- pattern drag-start ---- */

  const onPalettePatDragStart = (e: React.DragEvent, patId: Id) => {
    e.stopPropagation()
    dragRef.current = { kind: 'pattern', patId }
    e.dataTransfer.setData('application/synthor-pattern', patId)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const onSecPatDragStart = (e: React.DragEvent, secId: Id, patId: Id, pi: number) => {
    e.stopPropagation()
    dragRef.current = { kind: 'pattern', patId, secId, patIdx: pi }
    e.dataTransfer.setData('application/synthor-pattern', patId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const onSecDragStart = (e: React.DragEvent, si: number) => {
    dragRef.current = { kind: 'section', secIdx: si }
    e.dataTransfer.setData('application/synthor-section', String(si))
    e.dataTransfer.effectAllowed = 'move'
  }

  /* ---- pattern drag-over (per-item, per-list) ---- */

  const onPatItemDragOver = useCallback((e: React.DragEvent, secId: Id, pi: number) => {
    if (dragRef.current.kind !== 'pattern') return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = dragRef.current.secId ? 'move' : 'copy'
    setSecLine(null)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const edge = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below'
    setPatLine({ secId, idx: pi, edge })
  }, [])

  const onPatListDragOver = useCallback((e: React.DragEvent, secId: Id) => {
    if (dragRef.current.kind !== 'pattern') return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = dragRef.current.secId ? 'move' : 'copy'
    setSecLine(null)
    const pos = patDropFromY(secId, e.clientY)
    setPatLine(pos ? { secId, ...pos } : { secId, idx: 0, edge: 'below' })
  }, [patDropFromY])

  /* ---- pattern drop ---- */

  const onPatDrop = useCallback((e: React.DragEvent, toSecId: Id) => {
    e.preventDefault()
    e.stopPropagation()
    const d = dragRef.current
    const line = patLine
    setPatLine(null)
    dragRef.current = { kind: null }

    if (d.kind !== 'pattern' || !d.patId) return

    // Compute insertion index
    let insertIdx: number
    if (line && line.secId === toSecId) {
      insertIdx = line.edge === 'above' ? line.idx : line.idx + 1
    } else {
      // Fallback: append
      insertIdx = doc.entities.sections[toSecId]?.patternIds.length ?? 0
    }

    if (d.secId === toSecId) {
      // Intra-section reorder
      const fromIdx = d.patIdx ?? -1
      if (fromIdx < 0) return
      const adjusted = insertIdx > fromIdx ? insertIdx - 1 : insertIdx
      if (adjusted === fromIdx) return
      reorderPatternsInSection(toSecId, fromIdx, adjusted)
    } else if (d.secId) {
      // Cross-section move
      const fromSection = doc.entities.sections[d.secId]
      const fromIdx = fromSection?.patternIds.indexOf(d.patId) ?? -1
      if (fromIdx >= 0) {
        removePatternFromSection(d.secId, fromIdx)
        addPatternToSection(toSecId, d.patId, insertIdx)
      }
    } else {
      // From palette — just add
      addPatternToSection(toSecId, d.patId, insertIdx)
    }
  }, [patLine, doc.entities.sections, reorderPatternsInSection, removePatternFromSection, addPatternToSection])

  /* ---- cleanup ---- */

  const clearAll = () => {
    setSecLine(null)
    setPatLine(null)
    dragRef.current = { kind: null }
  }

  /* ---- new section drop zone ---- */

  const [newSecHover, setNewSecHover] = useState(false)

  /* ---- render ---- */

  return (
    <div className="arrange-tab" onDragOver={onContainerDragOver} onDrop={onContainerDrop}>
      {/* --- pattern palette --- */}
      <div className="arrange-palette">
        <div className="arrange-palette-head">
          <span className="arrange-palette-title">Patterns</span>
          <button className="octbtn" onClick={() => addPattern()}>+ New</button>
        </div>
        <div className="arrange-palette-list" ref={paletteListRef}>
          {allPatterns.map((p) => {
            const isPalEditing = editingPalettePat === p.id
            return (
            <div
              key={p.id}
              className={'arrange-palette-item' + (p.id === doc.patternId ? ' current' : '')}
              draggable
              onDragStart={(e) => onPalettePatDragStart(e, p.id)}
              onDragEnd={clearAll}
              onClick={() => setCurrentPattern(p.id)}
            >
              {isPalEditing ? (
                <input
                  className="arrange-name-input"
                  defaultValue={p.name}
                  autoFocus
                  onBlur={() => setEditingPalettePat(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { renamePattern(p.id, (e.target as HTMLInputElement).value); setEditingPalettePat(null) }
                    if (e.key === 'Escape') setEditingPalettePat(null)
                  }}
                />
              ) : (
                <span
                  className="arrange-palette-name"
                  title="Double-click to rename"
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingPalettePat(p.id) }}
                >{p.name}</span>
              )}
              <span className="arrange-palette-meta">{p.length}r</span>
              <span className="arrange-palette-actions">
                <button
                  className="arrange-palette-action-btn"
                  title="Duplicate pattern"
                  onClick={(e) => { e.stopPropagation(); duplicatePattern(p.id) }}
                >⧉</button>
                <button
                  className="arrange-palette-action-btn"
                  title="Delete pattern"
                  onClick={(e) => { e.stopPropagation(); removePattern(p.id) }}
                >×</button>
              </span>
            </div>
            )
          })}
          {allPatterns.length === 0 && <span className="muted arrange-palette-empty">No patterns yet</span>}
        </div>
      </div>

      {/* --- section list --- */}
      {doc.sectionIds.length === 0 && (
        <div className="arrange-no-sections muted">No sections — create one or drag a pattern here.</div>
      )}

      {doc.sectionIds.map((secId, si) => {
        const section = doc.entities.sections[secId]
        if (!section) return null
        const isEditing = editingSection === secId
        const above = secLine?.idx === si && secLine?.edge === 'above'
        const below = secLine?.idx === si && secLine?.edge === 'below'
        // Selected = contains the current pattern (same rule as the pattern highlight).
        const isSelected = section.patternIds.includes(doc.patternId)

        return (
          <div key={secId}>
            {above && <div className="arrange-drop-line" />}

            <div
              className={'arrange-section' + (isSelected ? ' selected' : '')}
              ref={(el) => { if (el) sectionEls.current.set(secId, el); else sectionEls.current.delete(secId) }}
            >
              <div
                className="arrange-section-head"
                draggable
                onDragStart={(e) => onSecDragStart(e, si)}
                onDragEnd={clearAll}
              >
                <span className="arrange-section-arrows">
                  {si > 0 && (
                    <button className="arrange-arrow-btn" title="Move section up" onClick={() => reorderSections(si, si - 1)}>▲</button>
                  )}
                  {si < doc.sectionIds.length - 1 && (
                    <button className="arrange-arrow-btn" title="Move section down" onClick={() => reorderSections(si, si + 1)}>▼</button>
                  )}
                </span>
                {isEditing ? (
                  <input
                    className="arrange-name-input"
                    defaultValue={section.name}
                    autoFocus
                    onBlur={() => setEditingSection(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { renameSection(secId, (e.target as HTMLInputElement).value); setEditingSection(null) }
                      if (e.key === 'Escape') setEditingSection(null)
                    }}
                  />
                ) : (
                  <span className="arrange-section-name" title="Double-click to rename" onDoubleClick={() => setEditingSection(secId)}>
                    {section.name}
                  </span>
                )}
                <button className="arrange-del-btn" title="Remove section" onClick={() => removeSection(secId)}>×</button>
              </div>
              <ul
                className="arrange-pattern-list"
                onDragOver={(e) => onPatListDragOver(e, secId)}
                onDrop={(e) => onPatDrop(e, secId)}
              >
                {section.patternIds.map((patId, pi) => {
                  const pat = doc.entities.patterns[patId]
                  // console.log('[render] section',secId,', patId', patId, 'pi', pi, 'pat', pat)

                  if (!pat) return null
                  const isCurrent = patId === doc.patternId
                  const isPatEditing = editingPattern === patId
                  const lineAbove = patLine?.secId === secId && patLine?.idx === pi && patLine?.edge === 'above'
                  const lineBelow = patLine?.secId === secId && patLine?.idx === pi && patLine?.edge === 'below'

                  return (
                    <li key={`${secId}-${patId}-${pi}`}>
                      {lineAbove && <div className="arrange-drop-line" />}
                      <div
                        className={'arrange-pattern-item' + (isCurrent ? ' current' : '')}
                        data-pat-id={patId}
                        draggable
                        onDragStart={(e) => onSecPatDragStart(e, secId, patId, pi)}
                        onDragEnd={clearAll}
                        onDragOver={(e) => onPatItemDragOver(e, secId, pi)}
                        onDrop={(e) => onPatDrop(e, secId)}
                        onClick={() => setCurrentPattern(patId)}
                      >
                        <span className="arrange-pattern-num">{pi + 1}</span>
                        {isPatEditing ? (
                          <input
                            className="arrange-name-input"
                            defaultValue={pat.name}
                            autoFocus
                            onBlur={() => setEditingPattern(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { renamePattern(patId, (e.target as HTMLInputElement).value); setEditingPattern(null) }
                              if (e.key === 'Escape') setEditingPattern(null)
                            }}
                          />
                        ) : (
                          <span className="arrange-pattern-name" title="Double-click to rename" onDoubleClick={(e) => { e.stopPropagation(); setEditingPattern(patId) }}>
                            {pat.name}
                          </span>
                        )}
                        <button className="arrange-del-btn" title="Remove pattern from section" onClick={(e) => { e.stopPropagation(); removePatternFromSection(secId, pi) }}>×</button>
                      </div>
                      {lineBelow && <div className="arrange-drop-line" />}
                    </li>
                  )
                })}
                <li className="arrange-pattern-item arrange-add-item">
                  <select
                    className="arrange-add-select"
                    value=""
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                      if (e.target.value) { addPatternToSection(secId, e.target.value); e.target.value = '' }
                    }}
                  >
                    <option value="">+ add pattern</option>
                    {allPatterns.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </li>
              </ul>
            </div>

            {below && <div className="arrange-drop-line" />}
          </div>
        )
      })}

      {/* --- new section drop zone --- */}
      <div
        className={'arrange-drop-zone' + (newSecHover ? ' hover' : '')}
        onDragOver={(e) => {
          if (dragRef.current.kind === 'pattern') {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setNewSecHover(true)
          }
        }}
        onDragLeave={() => setNewSecHover(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setNewSecHover(false)
          const d = dragRef.current
          dragRef.current = { kind: null }
          if (d.kind === 'pattern' && d.patId) {
            const sid = addSection()
            addPatternToSection(sid, d.patId)
          }
        }}
      >
        <span className="arrange-drop-zone-label">Drop pattern here to create new section</span>
      </div>

      <div className="arrange-actions">
        <button className="octbtn" onClick={() => addSection()}>+ Section</button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Store tab — new, open, save, import, export                        */
/* ------------------------------------------------------------------ */

function StoreTab({ slug }: { slug: string }) {
  const name = useProjectStore((s) => s.name)
  const status = useProjectStore((s) => s.status)
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt)
  const reset = useProjectStore((s) => s.reset)
  const loadDoc = useDocStore((s) => s.loadDoc)

  const [songs, setSongs] = useState<Entry[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const opfs = isOpfsSupported()

  const refreshList = useCallback(() => {
    if (opfs) void listSongs().then(setSongs)
  }, [opfs])
  useEffect(refreshList, [refreshList])

  const loadFile = useCallback(
    (file: SongFile, s?: string) => {
      loadDoc(file.doc)
      reset(file.meta.name, file.meta.createdAt, s)
    },
    [loadDoc, reset],
  )

  const newSong = () => {
    if (status === 'dirty' && !confirm('Discard unsaved changes and start a new song?')) return
    loadDoc(createDefaultDoc())
    reset('Untitled', new Date().toISOString())
  }

  const openSong = async (s: string) => {
    if (!s) return
    const file = await readSong(s)
    if (file) {
      loadFile(file, s)
      await saveRecent(s)
    }
  }

  const removeSong = async (s: string) => {
    if (!confirm(`Delete "${s}"? This cannot be undone.`)) return
    await deleteSong(s)
    refreshList()
  }

  const saveSong = async () => {
    try {
      await saveCurrentSong()
      refreshList()
    } catch { /* ignore */ }
  }

  const exportZip = async () => {
    try {
      const file = currentSongFile()
      const blob = await exportSongZip(file, slug)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name || 'song'}.synthor`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
      alert(`Export failed: ${(err as Error).message}`)
    }
  }

  const exportJson = () => {
    const file = currentSongFile()
    const blob = new Blob([serializeSong(file)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name || 'song'}.synthor.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importSong = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const data = await f.arrayBuffer()
      const result = await importSongZip(data, slug)
      loadFile(result.file, slug)
    } catch (err) {
      console.error('Import failed:', err)
      alert(`Could not import song: ${(err as Error).message}`)
    }
  }

  const saveLabel =
    status === 'saving'
      ? 'Saving…'
      : status === 'error'
        ? '⚠ Save failed'
        : status === 'dirty'
          ? 'Unsaved'
          : lastSavedAt
            ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
            : 'Not saved yet'

  return (
    <div className="store-tab">
      <div className="store-status">
        <span className={'store-status-label' + (status === 'error' ? ' error' : '') + (status === 'dirty' ? ' dirty' : '')}>
          {saveLabel}
        </span>
      </div>

      <div className="store-actions">
        <button className="octbtn" onClick={newSong} title="Create a new empty song">New</button>
        {opfs && (
          <button className="octbtn" onClick={() => void saveSong()} title="Save current song">Save</button>
        )}
        <button className="octbtn" onClick={exportZip} title="Export as .synthor (includes samples)">Export</button>
        <button className="octbtn" onClick={exportJson} title="JSON only, no sample data">Export JSON</button>
        <button className="octbtn" onClick={() => fileInput.current?.click()} title="Import .synthor or .json">Import</button>
        <input
          ref={fileInput}
          type="file"
          accept=".synthor,.json,application/json,application/zip"
          hidden
          onChange={(e) => void importSong(e)}
        />
      </div>

      {opfs && (
        <div className="store-list">
          <h4 className="store-list-title">Saved Songs</h4>
          {songs.length === 0 && <p className="muted">No saved songs yet.</p>}
          <ul className="store-song-list">
            {songs.map((s) => (
              <li key={s.slug} className="store-song-item">
                <span
                  className="store-song-name"
                  title="Click to open"
                  onClick={() => void openSong(s.slug)}
                >
                  {s.meta.name}
                </span>
                <span className="muted store-song-date">
                  {new Date(s.meta.createdAt).toLocaleDateString()}
                </span>
                <button
                  className="arrange-del-btn"
                  title="Delete song permanently"
                  onClick={() => void removeSong(s.slug)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
