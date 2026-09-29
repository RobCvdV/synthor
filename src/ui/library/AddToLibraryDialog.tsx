import { useState } from 'react'
import { Button } from '../components/Button'
import { Dialog } from '../Dialog'
import s from './Library.module.css'

export interface AddToLibraryChoice {
  key: string
  name: string
  fileName: string
  /** An instrument with this name is already in the library; unchecked by default. */
  inLibrary: boolean
}

/** Asks which just-imported instruments to also keep in the library. */
export function AddToLibraryDialog({ choices, onConfirm, onCancel }: {
  choices: AddToLibraryChoice[]
  onConfirm: (keys: string[]) => void
  onCancel: () => void
}) {
  const [checked, setChecked] = useState(() => choices.filter((c) => !c.inLibrary).map((c) => c.key))
  const all = checked.length === choices.length
  const toggle = (key: string) => setChecked((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]))

  return (
    <Dialog title="Add to Library?" onClose={onCancel} className={s.narrowDialog}
      actions={<>
        <Button onClick={onCancel}>Not now</Button>
        <Button active disabled={checked.length === 0} onClick={() => onConfirm(choices.filter((c) => checked.includes(c.key)).map((c) => c.key))}>
          {checked.length ? `Add ${checked.length} to library` : 'Add to library'}
        </Button>
      </>}>
      <p>{choices.length === 1 ? 'The instrument was added to the song.' : `${choices.length} instruments were added to the song.`} Keep them in your library too?</p>
      {choices.length > 1 && (
        <div className={s.listHead}>
          <Button size="xs" onClick={() => setChecked(all ? [] : choices.map((c) => c.key))}>{all ? 'Select none' : 'Select all'}</Button>
          <span className="muted">{checked.length} selected</span>
        </div>
      )}
      <ul className={s.checklist}>
        {choices.map((c) => (
          <li key={c.key}>
            <label>
              <input type="checkbox" checked={checked.includes(c.key)} onChange={() => toggle(c.key)} />
              <span className={s.name}>{c.name}</span>
              <span className="muted">{c.inLibrary ? 'already in library' : c.fileName}</span>
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
