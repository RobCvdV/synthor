import { useState } from 'react'
import type { Id, Instrument } from '../domain/types'
import { listLibraryInstruments } from '../persist/instrumentLibrary'
import { INSTRUMENT_FILE_EXT } from '../persist/instrumentFile'
import { hasStorage } from '../persist/storage'
import { askText } from '../state/dialogStore'
import { useDocStore } from '../state/docStore'
import { Button } from './components/Button'
import { Select } from './components/Select'
import { addImportedToLibrary, addLibraryInstrumentsToSong, importInstrumentFiles, type ImportedInstrument } from './instrumentActions'
import { AddToLibraryDialog } from './library/AddToLibraryDialog'
import { LibraryDialog } from './library/LibraryDialog'
import { pickFiles } from './pickFiles'

type AddChoice = 'library' | 'import' | 'synth' | 'drumkit'

const ADD_CHOICES: { value: AddChoice; label: string; needsStorage?: boolean }[] = [
  { value: 'library', label: 'From library…', needsStorage: true },
  { value: 'import', label: 'Import…' },
  { value: 'synth', label: 'New Synth…' },
  { value: 'drumkit', label: 'New Drum Kit…' },
]

/** The instrument list plus the ways to add instruments and open the library. */
export function InstrumentRail({ instruments, selectedId, usage, onSelect }: {
  instruments: Instrument[]
  selectedId: Id | null
  usage: (id: Id) => number
  onSelect: (id: Id) => void
}) {
  const addEmptyInstrument = useDocStore((s) => s.addEmptyInstrument)
  const [libraryMode, setLibraryMode] = useState<'pick' | 'manage' | null>(null)
  const [imported, setImported] = useState<{ items: ImportedInstrument[]; inLibrary: Set<string> } | null>(null)
  const storage = hasStorage()

  const createNew = async (kind: Instrument['kind']) => {
    const label = kind === 'drumkit' ? 'Drum Kit' : 'Synth'
    const name = await askText({
      message: `Name for the new ${label.toLowerCase()}`,
      defaultValue: label,
      confirmLabel: 'Create',
      validate: (v) => (v.trim() ? null : 'Enter a name'),
    })
    if (name) onSelect(addEmptyInstrument(kind, name))
  }

  const importFiles = async () => {
    const files = await pickFiles({ accept: `${INSTRUMENT_FILE_EXT},.json,application/json,application/zip`, multiple: true })
    if (!files.length) return
    const { imported: items, failed } = await importInstrumentFiles(files)
    if (failed.length) alert(`Could not import:\n${failed.map((f) => `${f.fileName}: ${f.error}`).join('\n')}`)
    if (!items.length) return
    onSelect(items[items.length - 1].instrumentId)
    if (!storage) return
    const names = new Set((await listLibraryInstruments()).map((i) => i.name.toLowerCase()))
    setImported({ items, inLibrary: new Set(items.filter((i) => names.has(i.name.toLowerCase())).map((i) => i.instrumentId)) })
  }

  const onAddChoice = (choice: AddChoice) => {
    if (choice === 'library') setLibraryMode('pick')
    else if (choice === 'import') void importFiles()
    else void createNew(choice === 'synth' ? 'modular' : 'drumkit')
  }

  const addFromLibrary = async (ids: string[]) => {
    setLibraryMode(null)
    try {
      const added = await addLibraryInstrumentsToSong(ids)
      if (added.length) onSelect(added[added.length - 1])
    } catch (err) {
      alert(`Could not add from the library: ${(err as Error).message}`)
    }
  }

  const keepInLibrary = async (keys: string[]) => {
    const items = imported?.items.filter((i) => keys.includes(i.instrumentId)) ?? []
    setImported(null)
    try {
      await addImportedToLibrary(items)
    } catch (err) {
      alert(`Could not add to the library: ${(err as Error).message}`)
    }
  }

  return (
    <aside className="inst-rail">
      <div className="inst-rail-actions">
        <Select value="" aria-label="Add instrument" className="inst-add"
          onChange={(e) => { if (e.target.value) onAddChoice(e.target.value as AddChoice) }}>
          <option value="">Add Instrument +</option>
          {ADD_CHOICES.filter((c) => storage || !c.needsStorage).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
        {storage && <Button size="sm" title="Manage the instrument library" onClick={() => setLibraryMode('manage')}>Library</Button>}
      </div>
      <ul className="inst-list">
        {instruments.map((inst) => {
          const uses = usage(inst.id)
          return (
            <li key={inst.id} className={'inst-item' + (inst.id === selectedId ? ' selected' : '')} onClick={() => onSelect(inst.id)}>
              <span className="inst-kind">{inst.kind === 'modular' ? '▦' : '◆'}</span>
              <span className="inst-name" title={inst.name}>{inst.name}</span>
              <span className="inst-uses" title={`${uses} track(s) use this`}>{uses}</span>
            </li>
          )
        })}
      </ul>

      {libraryMode === 'pick' && <LibraryDialog mode="pick" onAdd={(ids) => void addFromLibrary(ids)} onClose={() => setLibraryMode(null)} />}
      {libraryMode === 'manage' && <LibraryDialog mode="manage" onClose={() => setLibraryMode(null)} />}
      {imported && (
        <AddToLibraryDialog
          choices={imported.items.map((i) => ({ key: i.instrumentId, name: i.name, fileName: i.fileName, inLibrary: imported.inLibrary.has(i.instrumentId) }))}
          onConfirm={(keys) => void keepInLibrary(keys)}
          onCancel={() => setImported(null)} />
      )}
    </aside>
  )
}
