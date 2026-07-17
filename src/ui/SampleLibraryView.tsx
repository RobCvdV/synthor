import { useCallback, useRef } from 'react'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { loadAudioFile } from '../audio/sampleLoader'
import { writeSampleAsset, deleteSampleAsset } from '../persist/sampleStorage'
import { newSampleEntity } from '../domain/factory'

/** Full-screen sample library — browse, rename, import, and delete samples. */
export function SampleLibraryView() {
  const samples = useDocStore((s) => Object.values(s.doc.entities.samples))
  const addSampleEntity = useDocStore((s) => s.addSampleEntity)
  const removeSampleEntity = useDocStore((s) => s.removeSampleEntity)
  const renameSample = useDocStore((s) => s.renameSample)
  const slug = useProjectStore((s) => s.slug)
  const fileRef = useRef<HTMLInputElement>(null)

  const doImport = useCallback(async () => {
    const files = fileRef.current?.files
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
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
        if (slug) await writeSampleAsset(slug, loaded.hash, file)
        addSampleEntity(entity)
      } catch (err) {
        console.error('Failed to import sample:', file.name, err)
      }
    }
    if (fileRef.current) fileRef.current.value = ''
  }, [slug, addSampleEntity])

  const doDelete = useCallback(
    async (id: string, hash: string) => {
      removeSampleEntity(id)
      if (slug) await deleteSampleAsset(slug, hash).catch(() => {})
    },
    [slug, removeSampleEntity],
  )

  const formatDuration = (sr: number, frames: number) => {
    const secs = frames / sr
    if (secs < 1) return `${Math.round(secs * 1000)}ms`
    return `${secs.toFixed(1)}s`
  }

  const formatSize = (frames: number, channels: number) => {
    const bytes = frames * channels * 4 // Float32 = 4 bytes
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="sample-library-view">
      <div className="slv-toolbar">
        <button onClick={() => fileRef.current?.click()}>Import Samples</button>
        <span className="muted">{samples.length} sample{samples.length === 1 ? '' : 's'}</span>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={doImport}
        />
      </div>
      {samples.length === 0 ? (
        <div className="slv-empty">
          <p>No samples yet.</p>
          <p className="muted">
            Import WAV, MP3, OGG, or FLAC files to use in drum kits and sample modules.
          </p>
        </div>
      ) : (
        <div className="slv-table-wrap">
          <table className="slv-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Original</th>
                <th>Info</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {samples.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input
                      className="slv-name-input"
                      value={s.name}
                      onChange={(e) => renameSample(s.id, e.target.value)}
                      title="Rename sample — this is how it appears in drumkit and module pickers"
                    />
                  </td>
                  <td className="muted slv-original">{s.originalName}</td>
                  <td className="muted">
                    {s.sampleRate.toLocaleString()} Hz · {s.channels === 2 ? 'stereo' : 'mono'} · {formatDuration(s.sampleRate, s.frames)}
                  </td>
                  <td className="muted">{formatSize(s.frames, s.channels)}</td>
                  <td>
                    <button
                      className="slv-delete"
                      title="Delete sample"
                      onClick={() => doDelete(s.id, s.hash)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
