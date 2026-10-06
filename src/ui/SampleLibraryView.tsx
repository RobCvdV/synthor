import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocStore } from '../state/docStore'
import { useSampleAudition } from '../state/sampleAudition'
import { useProjectStore } from '../state/projectStore'
import { useAppStore } from '../state/appStore'
import { loadAudioFile } from '../audio/sampleLoader'
import { hasStorage } from '../persist/storage'
import { readSampleAsset, writeSampleAsset, deleteSampleAsset } from '../persist/sampleStorage'
import { samplePreviewPlan } from '../domain/sampleChoices'
import { codeToSemitone, isEditableTarget } from './keymap'
import { formatDuration, formatSize } from './format'
import { pickFiles } from './pickFiles'
import { SampleToolbar } from './SampleToolbar'
import { saveSongSampleToLibrary } from './sampleActions'
import { SaveToLibraryDialog, type SaveToLibraryValues } from './library/SaveToLibraryDialog'
import { sampleLibrary } from './library/librarySource'
import { TagEditor } from './library/TagEditor'
import { NameInput } from './components/NameInput'
import { SampleEditor } from './sampleEditor/SampleEditor'
import { CreateSampleDialog } from './CreateSampleDialog'
import { sampleDialogOpenRef } from './sampleDialogRef'
import type { AudioHost } from '../audio/host'
import type { SampleEntity } from '../domain/types'

interface Props {
  host: AudioHost
}

/** For the Save to Library name check; previews happen in the toolbar's library. */
const sampleLibrarySource = sampleLibrary()

/**
 * Full-screen sample library — browse, rename, import, delete, and relink
 * missing samples. Rows have a one-shot play button (natural rate); note
 * keys play the selected row pitched to the keyboard, with C-4 = natural
 * rate (same convention as the sample module). Preview goes straight
 * through Web Audio — no Elementary graph involved.
 */
/** The tuned audio of `sampleId`, while it is being edited. */
const auditionOf = (sampleId: string) => {
  const a = useSampleAudition.getState().audition
  return a?.sampleId === sampleId ? a : null
}

export function SampleLibraryView({ host }: Props) {
  const sampleMap = useDocStore((s) => s.doc.entities.samples)
  const samples = Object.values(sampleMap)
  const removeSampleEntity = useDocStore((s) => s.removeSampleEntity)
  const replaceSampleAsset = useDocStore((s) => s.replaceSampleAsset)
  const renameSample = useDocStore((s) => s.renameSample)
  const setSampleLibraryInfo = useDocStore((s) => s.setSampleLibraryInfo)
  const vfsLoadedHashes = useDocStore((s) => s.vfsLoadedHashes)
  const slug = useProjectStore((s) => s.slug)
  const selectedSampleId = useAppStore((s) => s.selectedSampleId)
  const setSelectedSampleId = useAppStore((s) => s.setSelectedSampleId)


  /** Sample loaded in the editor below the list (null = editor closed). */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [createDialog, setCreateDialog] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const storage = hasStorage()

  const saveToLibrary = async (values: SaveToLibraryValues) => {
    if (!savingId) return
    setSavingId(null)
    try {
      await saveSongSampleToLibrary(savingId, values)
    } catch (err) {
      alert(`Could not save to the library: ${(err as Error).message}`)
    }
  }

  const doDelete = useCallback(
    async (id: string, hash: string) => {
      removeSampleEntity(id)
      if (slug) await deleteSampleAsset(slug, hash).catch(() => {})
    },
    [slug, removeSampleEntity],
  )

  /** Replaces a sample's audio file, e.g. when its binary went missing. */
  const doRelink = useCallback(async (relinkInfo: { id: string; oldHash: string }) => {
    if (!slug) return
    const [file] = await pickFiles({ accept: 'audio/*' })
    if (!file) return

    try {
      const loaded = await loadAudioFile(file)
      // Write the new binary.
      await writeSampleAsset(slug, loaded.hash, file)
      // Remove the old file if the hash changed (content-address means new file).
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
  }, [slug, host, replaceSampleAsset])

  /** One-shot preview via plain Web Audio (host.ctx → destination); a sample being tuned plays tuned. */
  const playSample = useCallback(
    async (sample: SampleEntity, rate = 1, loopKey?: string) => {
      const audition = auditionOf(sample.id)
      if (audition) return host.playPcmNote(audition.data, audition.sampleRate, rate, loopKey)
      const raw = await readSampleAsset(slug, sample.hash).catch(() => null)
      if (!raw) return
      await host.playSamplePreview(sample.hash, raw, rate, loopKey)
    },
    [slug, host],
  )

  // Keep the keyboard target valid as samples come and go.
  useEffect(() => {
    const map = useDocStore.getState().doc.entities.samples
    if (selectedSampleId && map[selectedSampleId]) return
    setSelectedSampleId(Object.keys(map)[0] ?? null)
  }, [sampleMap, selectedSampleId, setSelectedSampleId])

  // Note keys play the sample being edited, else the selected row. Single cycles loop until key-up.
  const heldKeys = useRef(new Set<string>())
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.code === 'Escape') {
        e.preventDefault()
        host.stopSamplePreviews()
        return
      }
      if (sampleDialogOpenRef.current) return

      if (e.repeat) return // one attack per physical press
      const semi = codeToSemitone(e.code)
      if (semi === undefined) return
      const targetId = editingId ?? selectedSampleId
      const sample = targetId ? useDocStore.getState().doc.entities.samples[targetId] : undefined
      if (!sample) return
      e.preventDefault()
      // Tuning never turns a one-shot into a cycle or back: the stored sample decides; a tuned cycle keeps its pitch.
      const plan = samplePreviewPlan(sample, useAppStore.getState().octave * 12 + semi)
      const tunedFrames = auditionOf(sample.id)?.data[0].length
      if (tunedFrames && plan.loop) plan.rate *= tunedFrames / sample.frames
      if (!plan.loop) return void playSample(sample, plan.rate)
      const code = e.code
      heldKeys.current.add(code)
      void playSample(sample, plan.rate, code).then(() => {
        // Released while the sample was still loading.
        if (!heldKeys.current.has(code)) host.stopSamplePreview(code)
      })
    },
    [host, selectedSampleId, editingId, playSample],
  )

  useEffect(() => {
    const release = (code: string) => {
      heldKeys.current.delete(code)
      host.stopSamplePreview(code)
    }
    const onKeyUp = (e: KeyboardEvent) => release(e.code)
    const onBlur = () => [...heldKeys.current].forEach(release)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [onKeyDown, host])

  // Held notes follow the tuning, and fall back to the stored sample on Cancel.
  useEffect(() => useSampleAudition.subscribe(({ audition }, prev) => {
    const a = audition ?? prev.audition
    if (!a || audition === prev.audition) return
    const cancelled = !audition && useDocStore.getState().doc.entities.samples[a.sampleId]?.hash === a.hash
    host.replaceHeldPreviews(cancelled ? a.original : a.data, a.sampleRate)
  }), [host])

  // Cut any ringing preview when leaving the view.
  useEffect(() => () => host.stopSamplePreviews(), [host])

  /** Is a sample missing from VFS? */
  const isMissing = useCallback(
    (hash: string) => vfsLoadedHashes !== null && !vfsLoadedHashes.has(hash),
    [vfsLoadedHashes],
  )

  return (
    <div className={'sample-library-view' + (editingId ? ' has-editor' : '')}>
      <SampleToolbar host={host} count={samples.length} onSelect={setSelectedSampleId} onCreate={() => setCreateDialog(true)} />
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
                <th>Category</th>
                <th>Tags</th>
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
                      <NameInput
                        className="slv-name-input"
                        value={s.name}
                        onCommit={(name) => renameSample(s.id, name)}
                        title="Rename sample — this is how it appears in drumkit and module pickers"
                      />
                    </td>
                    <td>
                      <SampleCategoryInput key={`${s.id}:${s.library?.category ?? ''}`} sampleId={s.id} category={s.library?.category ?? ''} />
                    </td>
                    <td className="slv-tags">
                      <TagEditor tags={s.library?.tags ?? []} onChange={(tags) => setSampleLibraryInfo(s.id, { tags })} />
                    </td>
                    <td className={'slv-original' + (missing ? ' slv-missing-file' : '')}>
                      <span
                        title={'Click to replace' + (missing ? ' (binary missing)' : '')}
                        className="relink-target"
                        onClick={() => void doRelink({ id: s.id, oldHash: s.hash })}
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
                      {s.sampleRate.toLocaleString()} Hz · {formatDuration(s.sampleRate, s.frames, 1)}
                    </td>
                    <td className="muted">{formatSize(s.frames, s.channels)}</td>
                    <td className="slv-actions">
                      <button
                        className="slv-edit"
                        title="Edit sample"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedSampleId(s.id)
                          setEditingId(s.id)
                        }}
                      >
                        Edit
                      </button>
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
                      {storage && (
                        <button
                          className="slv-save"
                          title={missing ? 'Sample binary missing — cannot save' : 'Save to library…'}
                          disabled={missing}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSavingId(s.id)
                          }}
                        >
                          + Lib
                        </button>
                      )}
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

      {editingId && (
        <SampleEditor
          key={editingId}
          host={host}
          slug={slug}
          sampleId={editingId}
          onClose={() => setEditingId(null)}
          onSwitchSample={(id) => setEditingId(id)}
        />
      )}

      {savingId && sampleMap[savingId] && (
        <SaveToLibraryDialog source={sampleLibrarySource} defaultName={sampleMap[savingId].name}
          initialCategory={sampleMap[savingId].library?.category} initialTags={sampleMap[savingId].library?.tags}
          linkedId={sampleMap[savingId].library?.id}
          onSave={(values) => void saveToLibrary(values)} onCancel={() => setSavingId(null)} />
      )}

      {createDialog && (
        <CreateSampleDialog
          onClose={() => setCreateDialog(false)}
          onCreated={(id) => setEditingId(id)}
        />
      )}
    </div>
  )
}

/** The category a sample keeps in the song; committed on blur or Enter. */
function SampleCategoryInput({ sampleId, category }: { sampleId: string; category: string }) {
  const setInfo = useDocStore((st) => st.setSampleLibraryInfo)
  const [value, setValue] = useState(category)
  const commit = () => { if (value.trim() !== category) setInfo(sampleId, { category: value }) }
  return (
    <input className="slv-name-input slv-category-input" value={value} placeholder="—" aria-label="Category"
      onChange={(e) => setValue(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit() }} />
  )
}
