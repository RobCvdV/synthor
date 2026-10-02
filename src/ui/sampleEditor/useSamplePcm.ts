import { useCallback, useEffect, useRef, useState } from 'react'
import { computeHash } from '../../audio/sampleLoader'
import { framesOf, type PcmData } from '../../audio/sampleEdit'
import { encodeWav } from '../../audio/wav'
import { newSampleEntity } from '../../domain/factory'
import type { SampleEntity } from '../../domain/types'
import { readSampleAsset, writeSampleData } from '../../persist/sampleStorage'
import { useDocStore } from '../../state/docStore'
import { downloadBytes } from '../download'

export interface PcmMeta {
  sampleRate: number
  channels: number
  frames: number
}

let decodeCtx: AudioContext | null = null
const editorDecodeCtx = () => (decodeCtx ??= new AudioContext())

/**
 * The editable audio of one sample. It (re)loads whenever the entity's content hash changes,
 * so undo, redo and relinking land here too. A commit stores the edit as a WAV under its new
 * hash and points the entity at it, which keeps edits undoable.
 */
export function useSamplePcm(slug: string, entity: SampleEntity | undefined) {
  const [pcm, setPcm] = useState<PcmData | null>(null)
  const [meta, setMeta] = useState<PcmMeta | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Counts completed loads, so the view can fit a freshly loaded sample. */
  const [loads, setLoads] = useState(0)
  const loadSeq = useRef(0)
  const live = useRef({ meta, entity })
  live.current = { meta, entity }

  useEffect(() => {
    const seq = ++loadSeq.current
    const current = () => seq === loadSeq.current
    setError(null)
    if (!entity) {
      setPcm(null)
      setMeta(null)
      setBusy(false)
      return
    }
    setBusy(true)
    void (async () => {
      try {
        const raw = await readSampleAsset(slug, entity.hash)
        if (!current()) return
        if (!raw) {
          setPcm(null)
          setMeta(null)
          setError('Binary missing — re-import to edit')
          return
        }
        const buf = await editorDecodeCtx().decodeAudioData(raw.slice(0))
        if (!current()) return
        const channels = buf.numberOfChannels === 1 ? [0] : [0, 1]
        setPcm(channels.map((ch) => new Float32Array(buf.getChannelData(ch))))
        setMeta({ sampleRate: buf.sampleRate, channels: buf.numberOfChannels, frames: buf.length })
        setLoads((n) => n + 1)
      } catch {
        if (!current()) return
        setPcm(null)
        setMeta(null)
        setError('Failed to decode sample binary')
      } finally {
        if (current()) setBusy(false)
      }
    })()
    // Reload on content changes only, not on renames.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity?.hash, slug])

  const commit = useCallback(async (next: PcmData) => {
    const { meta: m, entity: ent } = live.current
    if (!m || !ent) return
    setBusy(true)
    try {
      const bytes = encodeWav(next, m.sampleRate)
      const hash = await computeHash(bytes)
      const frames = framesOf(next)
      if (hash !== ent.hash || frames !== m.frames) {
        await writeSampleData(slug, hash, bytes)
        useDocStore.getState().replaceSampleAsset(ent.id, hash, ent.originalName, m.sampleRate, next.length, frames)
      }
      setPcm(next)
      setMeta({ ...m, frames })
    } catch (err) {
      setError('Save failed — ' + String(err))
    } finally {
      setBusy(false)
    }
  }, [slug])

  /** Stores the current audio, or `data`, as a new sample; resolves with it, or null on failure. */
  const saveAs = useCallback(async (name: string, data?: PcmData): Promise<SampleEntity | null> => {
    const m = live.current.meta
    const audio = data ?? pcm
    if (!m || !audio) return null
    setBusy(true)
    try {
      const bytes = encodeWav(audio, m.sampleRate)
      const hash = await computeHash(bytes)
      await writeSampleData(slug, hash, bytes)
      const sample = newSampleEntity(name, hash, `${name}.wav`, m.sampleRate, audio.length, framesOf(audio))
      useDocStore.getState().addSampleEntity(sample)
      return sample
    } catch (err) {
      setError('Save as failed — ' + String(err))
      return null
    } finally {
      setBusy(false)
    }
  }, [slug, pcm])

  /** Downloads the stored file: the original bytes when unedited, else the WAV the edits produced. */
  const exportFile = useCallback(async () => {
    const ent = live.current.entity
    if (!ent) return
    const raw = await readSampleAsset(slug, ent.hash).catch(() => null)
    if (!raw) return
    const b = new Uint8Array(raw)
    const isWav = b.length >= 4 && String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF'
    downloadBytes(raw, isWav ? `${ent.name}.wav` : ent.originalName)
  }, [slug])

  return { pcm, meta, busy, error, loads, commit, saveAs, exportFile }
}
