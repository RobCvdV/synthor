import { useId, useMemo, useState } from 'react'
import {
  filterLibrary, libraryCategories, libraryTags, LIBRARY_SORTS, sortLibrary, type LibraryItem, type LibrarySortKey,
} from '../../domain/library'
import { askConfirm } from '../../state/dialogStore'
import { Button } from '../components/Button'
import { Select } from '../components/Select'
import { Dialog } from '../Dialog'
import { downloadBlob } from '../download'
import { pickFiles } from '../pickFiles'
import type { LibraryPatch, LibrarySource } from './librarySource'
import { TagEditor } from './TagEditor'
import { useLibraryItems } from './useLibraryItems'
import s from './Library.module.css'

export type LibraryDialogProps<T extends LibraryItem> = { source: LibrarySource<T>; onClose: () => void } & (
  | { mode: 'pick'; onAdd: (libraryIds: string[]) => void }
  | { mode: 'manage' }
)

/** Browse, filter, sort and edit a library; `pick` mode adds the checked items to the song. */
export function LibraryDialog<T extends LibraryItem>(props: LibraryDialogProps<T>) {
  const { mode, onClose, source } = props
  const { items, error, reload, replaceItem, removeItem } = useLibraryItems(source.list)
  const [text, setText] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<LibrarySortKey>('name')
  const [descending, setDescending] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const categories = useMemo(() => libraryCategories(items ?? []), [items])
  const tags = useMemo(() => libraryTags(items ?? []), [items])
  const visible = useMemo(
    () => sortLibrary(filterLibrary(items ?? [], { text, category }), sortKey, descending),
    [items, text, category, sortKey, descending],
  )
  const active = items?.find((i) => i.id === activeId) ?? null
  const allVisiblePicked = visible.length > 0 && visible.every((i) => picked.includes(i.id))

  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const toggleAllVisible = () => setPicked((p) => (allVisiblePicked
    ? p.filter((id) => !visible.some((i) => i.id === id))
    : [...new Set([...p, ...visible.map((i) => i.id)])]))
  const add = (ids: string[]) => {
    if (props.mode === 'pick' && ids.length) props.onAdd(visible.filter((i) => ids.includes(i.id)).map((i) => i.id))
  }

  const update = async (id: string, patch: LibraryPatch) => {
    try {
      replaceItem(await source.update(id, patch))
    } catch (err) {
      alert(`Could not update the library: ${(err as Error).message}`)
    }
  }
  const remove = async (item: T) => {
    if (!await askConfirm({ message: `Delete "${item.name}" from the library? Songs that use it keep their copy.`, confirmLabel: 'Delete', danger: true })) return
    await source.remove(item.id)
    removeItem(item.id)
    setPicked((p) => p.filter((x) => x !== item.id))
    setActiveId(null)
  }
  /** Imports into the library only; in pick mode the new items come pre-checked. */
  const importFiles = async () => {
    const files = await pickFiles({ accept: source.importAccept, multiple: true })
    if (!files.length) return
    setBusy('import')
    try {
      const { ids, failed } = await source.importFiles(files)
      if (failed.length) alert(`Could not import:\n${failed.map((f) => `${f.fileName}: ${f.error}`).join('\n')}`)
      await reload()
      if (ids.length) {
        setText('')
        setCategory(null)
        setActiveId(ids[ids.length - 1])
        if (mode === 'pick') setPicked((p) => [...new Set([...p, ...ids])])
      }
    } finally {
      setBusy(null)
    }
  }

  const exportItem = async (item: T) => {
    setBusy(item.id)
    try {
      const { blob, filename } = await source.exportFile(item.id)
      downloadBlob(blob, filename)
    } catch (err) {
      alert(`Export failed: ${(err as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const actions = mode === 'pick' ? (
    <>
      <Button onClick={onClose}>Cancel</Button>
      <Button active disabled={picked.length === 0} onClick={() => add(picked)}>
        {picked.length ? `Add ${picked.length} to song` : 'Add to song'}
      </Button>
    </>
  ) : <Button onClick={onClose}>Close</Button>

  return (
    <Dialog title={mode === 'pick' ? source.pickTitle : source.title} onClose={onClose} className={s.dialog}
      err={error} actions={actions}>
      <div className={s.toolbar}>
        <input className={s.search} type="search" placeholder="Search name, category, tags…" aria-label="Search library"
          value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <Select small aria-label="Category" value={category ?? ''} onChange={(e) => setCategory(e.target.value || null)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select small aria-label="Sort by" value={sortKey} onChange={(e) => setSortKey(e.target.value as LibrarySortKey)}>
          {LIBRARY_SORTS.map((sort) => <option key={sort.key} value={sort.key}>Sort: {sort.label}</option>)}
        </Select>
        <Button size="sm" title={descending ? 'Descending' : 'Ascending'} aria-label="Toggle sort direction"
          onClick={() => setDescending((d) => !d)}>{descending ? '↓' : '↑'}</Button>
        <Button size="sm" disabled={busy === 'import'} title={`Add ${source.noun} files to the library (not to the song)`}
          onClick={() => void importFiles()}>{busy === 'import' ? 'Importing…' : 'Import…'}</Button>
      </div>

      <div className={s.body}>
        <div className={s.listPane}>
          {mode === 'pick' && visible.length > 0 && (
            <div className={s.listHead}>
              <Button size="xs" onClick={toggleAllVisible}>{allVisiblePicked ? 'Select none' : 'Select all'}</Button>
              <span className="muted">{picked.length} selected</span>
            </div>
          )}
          {items === null && <p className="muted">Loading…</p>}
          {items?.length === 0 && (
            <p className={s.empty}>The library is empty. Use “Save to Library” on a {source.noun}, or Import… {source.noun} files here.</p>
          )}
          {items && items.length > 0 && visible.length === 0 && <p className={s.empty}>No {source.noun}s match.</p>}
          <ul className={s.list}>
            {visible.map((item) => (
              <li key={item.id} className={item.id === activeId ? `${s.row} ${s.active}` : s.row}
                onClick={() => setActiveId(item.id)} onDoubleClick={() => add([item.id])}>
                {mode === 'pick' && (
                  <input type="checkbox" aria-label={`Select ${item.name}`} checked={picked.includes(item.id)}
                    onClick={(e) => e.stopPropagation()} onChange={() => togglePick(item.id)} />
                )}
                <span className={s.kind} title={source.describe(item).label}>{source.describe(item).icon}</span>
                <span className={s.name}>{item.name}</span>
                {item.category && <span className={s.category}>{item.category}</span>}
                <span className={s.rowTags}>{item.tags.map((t) => <span key={t} className={s.tag}>{t}</span>)}</span>
                {source.preview && (
                  <button type="button" className={s.play} title="Play" aria-label={`Play ${item.name}`}
                    onClick={(e) => { e.stopPropagation(); source.preview?.(item) }}>▶</button>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className={s.detail}>
          {active ? (
            <LibraryItemDetails key={active.id} item={active} description={source.describe(active).label}
              categories={categories} tags={tags}
              onUpdate={(patch) => void update(active.id, patch)}
              onExport={mode === 'manage' ? () => void exportItem(active) : undefined}
              onDelete={mode === 'manage' ? () => void remove(active) : undefined}
              exporting={busy === active.id} />
          ) : (
            <p className="muted">{items?.length ? `Select a ${source.noun} to edit its name, category and tags.` : ''}</p>
          )}
        </div>
      </div>
    </Dialog>
  )
}

function LibraryItemDetails({ item, description, categories, tags, onUpdate, onExport, onDelete, exporting }: {
  item: LibraryItem
  description: string
  categories: string[]
  tags: string[]
  onUpdate: (patch: LibraryPatch) => void
  onExport?: () => void
  onDelete?: () => void
  exporting: boolean
}) {
  const [name, setName] = useState(item.name)
  const [category, setCategory] = useState(item.category)
  const categoryList = useId()
  const commitName = () => {
    if (name.trim() && name.trim() !== item.name) onUpdate({ name })
    else setName(item.name)
  }
  const commitCategory = () => {
    if (category.trim() !== item.category) onUpdate({ category })
  }
  const onEnter = (commit: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit()
  }

  return (
    <div className={s.fields}>
      <label className={s.field}>
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={onEnter(commitName)} />
      </label>
      <label className={s.field}>
        <span>Category</span>
        <input value={category} list={categoryList} placeholder="e.g. Bass, Pads, Drums"
          onChange={(e) => setCategory(e.target.value)} onBlur={commitCategory} onKeyDown={onEnter(commitCategory)} />
        <datalist id={categoryList}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      <div className={s.field}>
        <span>Tags</span>
        <TagEditor tags={item.tags} suggestions={tags} onChange={(next) => onUpdate({ tags: next })} />
      </div>
      <p className="muted">{description}</p>
      {(onExport || onDelete) && (
        <div className={s.detailActions}>
          {onExport && <Button size="sm" disabled={exporting} onClick={onExport}>{exporting ? 'Exporting…' : 'Export'}</Button>}
          {onDelete && <Button size="sm" onClick={onDelete}>Delete</Button>}
        </div>
      )}
    </div>
  )
}
