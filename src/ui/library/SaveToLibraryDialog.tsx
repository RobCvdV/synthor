import { useId, useMemo, useRef, useState } from 'react'
import { libraryCategories, libraryTags, type LibraryItem } from '../../domain/library'
import { Button } from '../components/Button'
import { Dialog } from '../Dialog'
import { TagEditor } from './TagEditor'
import { useLibraryItems } from './useLibraryItems'
import type { LibrarySource } from './librarySource'
import s from './Library.module.css'

export interface SaveToLibraryValues {
  name: string
  category: string
  tags: string[]
  /** Set when the user chose to replace the library item with the same name. */
  replaceId?: string
}

/** Name, category and tags for saving to a library; a name clash offers replace or keep both. */
export function SaveToLibraryDialog({ source, defaultName, onSave, onCancel }: {
  source: Pick<LibrarySource, 'list'>
  defaultName: string
  onSave: (values: SaveToLibraryValues) => void
  onCancel: () => void
}) {
  const { items } = useLibraryItems(source.list)
  const [name, setName] = useState(defaultName)
  const [category, setCategory] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const nameRef = useRef<HTMLInputElement>(null)
  const categoryList = useId()

  const categories = useMemo(() => libraryCategories(items ?? []), [items])
  const tagSuggestions = useMemo(() => libraryTags(items ?? []), [items])
  const clash: LibraryItem | undefined = items?.find((i) => i.name.toLowerCase() === name.trim().toLowerCase())
  const values = { name: name.trim(), category, tags }
  const valid = values.name !== '' && items !== null

  const actions = clash ? (
    <>
      <Button onClick={onCancel}>Cancel</Button>
      <Button disabled={!valid} onClick={() => onSave(values)}>Keep both</Button>
      <Button active tone="warn" disabled={!valid} onClick={() => onSave({ ...values, replaceId: clash.id })}>Replace</Button>
    </>
  ) : (
    <>
      <Button onClick={onCancel}>Cancel</Button>
      <Button active disabled={!valid} onClick={() => onSave(values)}>Save</Button>
    </>
  )

  return (
    <Dialog title="Save to Library" onClose={onCancel} className={s.narrowDialog} initialFocusRef={nameRef} actions={actions}
      err={clash ? `“${clash.name}” is already in the library.` : null}>
      <div className={s.fields}>
        <label className={s.field}>
          <span>Name</span>
          <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && valid && !clash) onSave(values) }} />
        </label>
        <label className={s.field}>
          <span>Category</span>
          <input value={category} list={categoryList} placeholder="e.g. Bass, Pads, Drums" onChange={(e) => setCategory(e.target.value)} />
          <datalist id={categoryList}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <div className={s.field}>
          <span>Tags</span>
          <TagEditor tags={tags} suggestions={tagSuggestions} onChange={setTags} />
        </div>
      </div>
    </Dialog>
  )
}
