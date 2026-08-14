import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocStore } from '../state/docStore'
import { useProjectStore } from '../state/projectStore'
import { useAppStore } from '../state/appStore'
import { loadAudioFile } from '../audio/sampleLoader'
import { readSampleAsset, writeSampleAsset, deleteSampleAsset } from '../persist/sampleStorage'
import { newSampleEntity } from '../domain/factory'
import { samplePlaybackRate } from '../domain/notes'
import { codeToSemitone, isEditableTarget } from './keymap'
import type { AudioHost } from '../audio/host'
import type { SampleEntity } from '../domain/types'

interface Props {
  host: AudioHost
}

/**
 * Full-screen sample library — browse, rename, import, delete, and relink
 * missing samples. Rows have a one-shot play button (natural rate); note
 * keys play the selected row pitched to the keyboard, with C-4 = natural
 * rate (same convention as the sample module). Preview goes straight
 * through Web Audio — no Elementary graph involved.
 */
export function SampleLibraryView({ host }: Props) {
  const sampleMap = useDocStore((s) => s.doc.entities.samples)
  const samples = Object.values(sampleMap)
  const addSampleEntity = useDocStore((s) => s.addSampleEntity)
  const removeSampleEntity = useDocStore((s) => s.removeSampleEntity)
  const replaceSampleAsset = useDocStore((s) => s.replaceSampleAsset)
  const renameSample = useDocStore((s) => s.renameSample)
  const vfsLoadedHashes = useDocStore((s) => s.vfsLoadedHashes)
  const slug = useProjectStore((s) => s.slug)
  const selectedSampleId = useAppStore((s) => s.selectedSampleId)
  const setSelectedSampleId = useAppStore((s) => s.setSelectedSampleId)
  const fileRef = useRef<HTMLInputElement>(null)
  const relinkRef = useRef<{ id: string; oldHash: string } | null>(null)

  const [octave, setOctave] = useState(5)
  const octaveRef = useRef(octave)
  octaveRef.current = octave

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
        // The next render cycle will pick up the new sample via vfsKeys change.
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

  const doRelink = useCallback(async () => {
    const relinkInfo = relinkRef.current
    if (!relinkInfo || !slug) return
    const file = fileRef.current?.files?.[0]
    if (!file) return

    try {
      const loaded = await loadAudioFile(file)
      // Write new binary to OPFS.
      await writeSampleAsset(slug, loaded.hash, file)
      // Remove old OPFS file if hash changed (content-address means new file).
      if (loaded.hash !== relinkInfo.oldHash) {
        await deleteSampleAsset(slug, relinkInfo.oldHash).catch(() => {})
      }
      // Update the entity with new metadata.
      replaceSampleAsset(
        relinkInfo.id,
        loaded.hash,
        file.name,
        loaded.sampleRate,
        loaded.channels,
        loaded.frames,
      )
      // Load into VFS.
      const ctx = new AudioContext()
      const buffer = await ctx.decodeAudioData((await file.arrayBuffer()).slice(0))
      const vfs: Record<string, Float32Array | Float32Array[]> = {}
      if (buffer.numberOfChannels === 1) {
        vfs[loaded.hash] = new Float32Array(buffer.getChannelData(0))
      } else {
        const chData: Float32Array[] = []
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          chData.push(new Float32Array(buffer.getChannelData(ch)))
        }
        vfs[loaded.hash] = chData
      }
      await host.updateVfs(vfs)
      await ctx.close()
      // Mark as loaded.
      const curLoaded = new Set(useDocStore.getState().vfsLoadedHashes ?? [])
      curLoaded.add(loaded.hash)
      useDocStore.getState().setVfsLoaded(curLoaded)
    } catch (err) {
      console.error('Failed to relink sample:', err)
    }
    relinkRef.current = null
    if (fileRef.current) fileRef.current.value = ''
  }, [slug, host, replaceSampleAsset])

  /** One-shot preview via plain Web Audio (host.ctx → destination). */
  const playSample = useCallback(
    async (sample: SampleEntity, rate = 1) => {
      const raw = await readSampleAsset(slug, sample.hash).catch(() => null)
      if (!raw) return
      void host.playSamplePreview(sample.hash, raw, rate)
    },
    [slug, host],
  )

  // Keep the keyboard target valid as samples come and go.
  useEffect(() => {
    const map = useDocStore.getState().doc.entities.samples
    if (selectedSampleId && map[selectedSampleId]) return
    setSelectedSampleId(Object.keys(map)[0] ?? null)
  }, [sampleMap, selectedSampleId, setSelectedSampleId])

  // Note keys play the selected row; one-shot, no key-up handling.
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.code === 'Escape') {
        e.preventDefault()
        host.stopSamplePreviews()
        return
      }
      if (e.code === 'Minus') { e.preventDefault(); setOctave((o) => Math.max(0, o - 1)); return }
      if (e.code === 'Equal') { e.preventDefault(); setOctave((o) => Math.min(9, o + 1)); return }

      if (e.repeat) return // one attack per physical press
      const semi = codeToSemitone(e.code)
      if (semi === undefined) return
      const sample = selectedSampleId
        ? useDocStore.getState().doc.entities.samples[selectedSampleId]
        : undefined
      if (!sample) return
      e.preventDefault()
      const note = octaveRef.current * 12 + semi
      void playSample(sample, samplePlaybackRate(note))
    },
    [host, selectedSampleId, playSample],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  // Cut any ringing preview when leaving the view.
  useEffect(() => () => host.stopSamplePreviews(), [host])

  /** Is a sample missing from VFS? */
  const isMissing = useCallback(
    (hash: string) => vfsLoadedHashes !== null && !vfsLoadedHashes.has(hash),
    [vfsLoadedHashes],
  )

  const formatDuration = (sr: number, frames: number) => {
    const secs = frames / sr
    if (secs < 1) return `${Math.round(secs * 1000)}ms`
    return `${secs.toFixed(1)}s`
  }

  const formatSize = (frames: number, channels: number) => {
    const bytes = frames * channels * 4
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="sample-library-view">
      <div className="slv-toolbar">
        <button onClick={() => fileRef.current?.click()}>Import Samples</button>
        <span className="muted">{samples.length} sample{samples.length === 1 ? '' : 's'}</span>
        <span className="spacer" />
        <span className="muted">Play keys to preview (C-4 = original pitch)</span>
        <span className="preview-oct">
          <button onClick={() => setOctave((o) => Math.max(0, o - 1))}>oct −</button>
          <span className="preview-oct-val">oct {octave}</span>
          <button onClick={() => setOctave((o) => Math.min(9, o + 1))}>oct +</button>
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={() => {
            // If relink is pending, handle that; otherwise import.
            if (relinkRef.current) doRelink()
            else doImport()
          }}
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
                <th>Ch</th>
                <th>Info</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {samples.map((s) => {
                const missing = isMissing(s.hash)
                const selected = s.id === selectedSampleId
                return (
                  <tr
                    key={s.id}
                    className={(missing ? 'slv-missing' : '') + (selected ? ' slv-selected' : '')}
                    onClick={() => setSelectedSampleId(s.id)}
                  >
                    <td>
                      <input
                        className="slv-name-input"
                        value={s.name}
                        onChange={(e) => renameSample(s.id, e.target.value)}
                        title="Rename sample — this is how it appears in drumkit and module pickers"
                      />
                    </td>
                    <td className={'slv-original' + (missing ? ' slv-missing-file' : '')}>
                      <span
                        title={'Click to replace' + (missing ? ' (binary missing)' : '')}
                        className="relink-target"
                        onClick={() => {
                          relinkRef.current = { id: s.id, oldHash: s.hash }
                          fileRef.current?.click()
                        }}
                      >
                        {s.originalName}
                      </span>
                      {missing && <span className="missing-badge">missing</span>}
                    </td>
                    <td>
                      <span className={'slv-ch-badge' + (s.channels === 2 ? ' stereo' : '')}>
                        {s.channels === 2 ? 'stereo' : 'mono'}
                      </span>
                    </td>
                    <td className="muted">
                      {s.sampleRate.toLocaleString()} Hz · {formatDuration(s.sampleRate, s.frames)}
                    </td>
                    <td className="muted">{formatSize(s.frames, s.channels)}</td>
                    <td className="slv-actions">
                      <button
                        className="slv-play"
                        title={missing ? 'Sample binary missing — cannot play' : 'Play sample'}
                        disabled={missing}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedSampleId(s.id)
                          void playSample(s)
                        }}
                      >
                        ▶
                      </button>
                      <button
                        className="slv-delete"
                        title="Delete sample"
                        onClick={(e) => {
                          e.stopPropagation()
                          void doDelete(s.id, s.hash)
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
