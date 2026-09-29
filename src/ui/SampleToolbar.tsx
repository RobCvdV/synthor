import { useMemo, useState } from 'react'
import type { AudioHost } from '../audio/host'
import type { Id } from '../domain/types'
import { listLibrarySamples } from '../persist/sampleLibrary'
import { hasStorage } from '../persist/storage'
import { Button } from './components/Button'
import { Select } from './components/Select'
import { AddToLibraryDialog } from './library/AddToLibraryDialog'
import { LibraryDialog } from './library/LibraryDialog'
import { sampleLibrary } from './library/librarySource'
import { pickFiles } from './pickFiles'
import { addImportedSamplesToLibrary, addLibrarySamplesToSong, importSampleFiles, type ImportedSample } from './sampleActions'

type AddChoice = 'library' | 'import' | 'create'

const ADD_CHOICES: { value: AddChoice; label: string; needsStorage?: boolean }[] = [
  { value: 'library', label: 'From library…', needsStorage: true },
  { value: 'import', label: 'Import…' },
  { value: 'create', label: 'Create…' },
]

/** The Samples page toolbar: the ways to add samples, and the sample library. */
export function SampleToolbar({ host, count, onSelect, onCreate }: {
  host: AudioHost
  count: number
  onSelect: (id: Id) => void
  onCreate: () => void
}) {
  const [libraryMode, setLibraryMode] = useState<'pick' | 'manage' | null>(null)
  const [imported, setImported] = useState<{ items: ImportedSample[]; inLibrary: Set<string> } | null>(null)
  const source = useMemo(() => sampleLibrary((hash, bytes) => void host.playSamplePreview(hash, bytes)), [host])
  const storage = hasStorage()

  const importFiles = async () => {
    const files = await pickFiles({ accept: 'audio/*', multiple: true })
    if (!files.length) return
    const { imported: items, failed } = await importSampleFiles(files)
    if (failed.length) alert(`Could not import:\n${failed.map((f) => `${f.fileName}: ${f.error}`).join('\n')}`)
    if (!items.length) return
    onSelect(items[items.length - 1].sample.id)
    if (!storage) return
    const hashes = new Set((await listLibrarySamples()).map((i) => i.sample.hash))
    setImported({ items, inLibrary: new Set(items.filter((i) => hashes.has(i.sample.hash)).map((i) => i.sample.id)) })
  }

  const onAddChoice = (choice: AddChoice) => {
    if (choice === 'library') setLibraryMode('pick')
    else if (choice === 'import') void importFiles()
    else onCreate()
  }

  const addFromLibrary = async (ids: string[]) => {
    setLibraryMode(null)
    try {
      const added = await addLibrarySamplesToSong(ids)
      if (added.length) onSelect(added[added.length - 1])
    } catch (err) {
      alert(`Could not add from the library: ${(err as Error).message}`)
    }
  }

  const keepInLibrary = async (keys: string[]) => {
    const items = imported?.items.filter((i) => keys.includes(i.sample.id)) ?? []
    setImported(null)
    try {
      await addImportedSamplesToLibrary(items)
    } catch (err) {
      alert(`Could not add to the library: ${(err as Error).message}`)
    }
  }

  return (
    <div className="slv-toolbar">
      <Select value="" aria-label="Add sample" className="slv-add"
        onChange={(e) => { if (e.target.value) onAddChoice(e.target.value as AddChoice) }}>
        <option value="">Add Sample +</option>
        {ADD_CHOICES.filter((c) => storage || !c.needsStorage).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </Select>
      {storage && <Button size="sm" title="Manage the sample library" onClick={() => setLibraryMode('manage')}>Library</Button>}
      <span className="muted">{count} sample{count === 1 ? '' : 's'} in this song</span>
      <span className="spacer" />
      <span className="muted">Play keys to preview (C-4 = original pitch)</span>

      {libraryMode === 'pick' && (
        <LibraryDialog source={source} mode="pick" onAdd={(ids) => void addFromLibrary(ids)} onClose={() => setLibraryMode(null)} />
      )}
      {libraryMode === 'manage' && <LibraryDialog source={source} mode="manage" onClose={() => setLibraryMode(null)} />}
      {imported && (
        <AddToLibraryDialog noun="sample"
          choices={imported.items.map((i) => ({ key: i.sample.id, name: i.sample.name, fileName: i.fileName, inLibrary: imported.inLibrary.has(i.sample.id) }))}
          onConfirm={(keys) => void keepInLibrary(keys)}
          onCancel={() => setImported(null)} />
      )}
    </div>
  )
}
