import { useId, useState } from 'react'
import { normalizeTags, parseTags } from '../../domain/library'
import s from './Library.module.css'

/** Tag chips with an input: Enter, comma or leaving the field adds (words become separate tags); × or Backspace on an empty input removes. */
export function TagEditor({ tags, suggestions = [], onChange }: {
  tags: string[]
  suggestions?: string[]
  onChange: (tags: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const listId = useId()
  const commit = () => {
    const added = parseTags(draft)
    setDraft('')
    if (added.length) onChange(normalizeTags([...tags, ...added]))
  }

  return (
    <div className={s.tags}>
      {tags.map((tag) => (
        <span key={tag} className={s.tag}>
          {tag}
          <button type="button" className={s.tagRemove} title={`Remove tag "${tag}"`} aria-label={`Remove tag ${tag}`}
            onClick={() => onChange(tags.filter((t) => t !== tag))}>×</button>
        </span>
      ))}
      <input className={s.tagInput} value={draft} placeholder={tags.length ? '' : 'Add tags…'} aria-label="Add tag" list={listId}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            onChange(tags.slice(0, -1))
          }
        }}
        onBlur={commit} />
      <datalist id={listId}>
        {suggestions.filter((t) => !tags.includes(t)).map((t) => <option key={t} value={t} />)}
      </datalist>
    </div>
  )
}
