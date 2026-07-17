import { useCallback, useMemo, useRef } from 'react'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { loadAudioFile } from '../audio/sampleLoader'
import { writeSampleAsset, deleteSampleAsset } from '../persist/sampleStorage'
import { newSampleEntity } from '../domain/factory'

/** Import and manage audio samples. File picker + list with delete. */
export function SampleLibrary() {
  const sampleEntities = useDocStore((s) => s.doc.entities.samples)
  const samples = useMemo(() => Object.values(sampleEntities), [sampleEntities])
  const removeSampleEntity = useDocStore((s) => s.removeSampleEntity)
  const addSampleEntity = useDocStore((s) => s.addSampleEntity)
  const slug = useProjectStore((s) => s.slug)
  const fileRef = useRef<HTMLInputElement>(null)

  const doImport = useCallback(async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    try {
      const loaded = await loadAudioFile(file)
      const entity = newSampleEntity(
        file.name.replace(/\.[^.]+$/, ''),
        loaded.hash,
        file.name,
        loaded.sampleRate,
        loaded.channels,
        loaded.frames,
      )
      // Store binary in OPFS.
      if (slug) await writeSampleAsset(slug, loaded.hash, file)
      addSampleEntity(entity)
    } catch (err) {
      console.error('Failed to import sample:', err)
    }
    // Reset so the same file can be re-imported.
    if (fileRef.current) fileRef.current.value = ''
  }, [slug, addSampleEntity])

  const doDelete = useCallback(
    async (id: string, hash: string) => {
      removeSampleEntity(id)
      if (slug) await deleteSampleAsset(slug, hash).catch(() => {})
    },
    [slug, removeSampleEntity],
  )

  const duration = (sr: number, frames: number) => {
    const secs = frames / sr
    if (secs < 1) return `${Math.round(secs * 1000)}ms`
    return `${secs.toFixed(1)}s`
  }

  return (
    <div className="sample-library">
      <div className="sample-import">
        <input ref={fileRef} type="file" accept="audio/*" onChange={doImport} />
      </div>
      {samples.length === 0 && (
        <div className="muted" style={{ padding: '8px 12px', fontSize: 11 }}>
          Import a WAV/MP3 to use in sample modules and drum kits.
        </div>
      )}
      <ul className="sample-list">
        {samples.map((s) => (
          <li key={s.id} className="sample-item">
            <span className="sample-name">{s.name}</span>
            <span className="sample-meta">
              {s.channels === 2 ? 'stereo' : 'mono'} · {duration(s.sampleRate, s.frames)}
            </span>
            <button
              className="sample-del"
              title="Delete sample"
              onClick={() => doDelete(s.id, s.hash)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
