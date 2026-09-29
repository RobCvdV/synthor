/**
 * `.synthinst` instrument files: a zip of `instrument.json` (an InstrumentBundle stamped with the
 * song schema version) plus `samples/<hash>.bin`. Loading runs the bundle through the song
 * migrations, so instrument files age like songs do.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { InstrumentBundle } from '../domain/instrumentBundle'
import type { Id, Instrument } from '../domain/types'
import { CURRENT_SCHEMA_VERSION, migrate } from './serialize'

export const INSTRUMENT_FILE_EXT = '.synthinst'
const FORMAT = 'synthor-instrument'
const JSON_ENTRY = 'instrument.json'
/** Pre-bundle JSON exports (`{ schemaVersion: 1, instrument }`) predate song schema 13. */
const LEGACY_JSON_SCHEMA = 12

export interface InstrumentFileContents {
  bundle: InstrumentBundle
  /** Sample bytes by content hash. */
  sampleData: Record<string, Uint8Array>
}

export function serializeInstrumentBundle(bundle: InstrumentBundle): string {
  return JSON.stringify({ format: FORMAT, schemaVersion: CURRENT_SCHEMA_VERSION, bundle }, null, 2)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Brings bundle entities up to the current schema by migrating them inside an empty song. */
function migrateBundle(rootId: Id, instruments: unknown, samples: unknown, schemaVersion: number): InstrumentBundle {
  const file = migrate({
    schemaVersion,
    meta: { name: '', createdAt: '', modifiedAt: '' },
    doc: {
      patternId: '',
      sectionIds: [],
      entities: {
        instruments, samples: isRecord(samples) ? samples : {},
        tracks: {}, patterns: {}, sections: {}, mixChannels: {}, mixerInstrumentOrder: [],
      },
    },
  })
  const { entities } = file.doc
  if (!entities.instruments[rootId]) throw new Error('Not a valid instrument file: missing its instrument')
  return { rootId, instruments: entities.instruments, samples: entities.samples }
}

/** Parses `instrument.json`, or a legacy `.synthor.inst.json` export. */
export function parseInstrumentJson(text: string): InstrumentBundle {
  const raw: unknown = JSON.parse(text)
  if (!isRecord(raw)) throw new Error('Not a valid instrument file')
  if (raw.format === FORMAT && isRecord(raw.bundle) && typeof raw.schemaVersion === 'number') {
    const { rootId, instruments, samples } = raw.bundle
    if (typeof rootId !== 'string' || !isRecord(instruments)) throw new Error('Not a valid instrument file')
    return migrateBundle(rootId, instruments, samples, raw.schemaVersion)
  }
  if (isRecord(raw.instrument) && typeof raw.instrument.id === 'string') {
    const inst = raw.instrument as unknown as Instrument
    if (inst.kind !== 'modular' && inst.kind !== 'drumkit') throw new Error('Unknown instrument kind')
    return migrateBundle(inst.id, { [inst.id]: inst }, {}, LEGACY_JSON_SCHEMA)
  }
  throw new Error('Not a valid instrument file')
}

/** Zips a bundle with the bytes of each of its samples that `readSample` can find. */
export async function packInstrumentFile(
  bundle: InstrumentBundle,
  readSample: (hash: string) => Promise<ArrayBuffer | null>,
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = { [JSON_ENTRY]: strToU8(serializeInstrumentBundle(bundle)) }
  for (const smp of Object.values(bundle.samples)) {
    const data = await readSample(smp.hash)
    if (data) files[`samples/${smp.hash}.bin`] = new Uint8Array(data)
  }
  return zipSync(files, { level: 6 })
}

/** Reads a `.synthinst` zip or a plain instrument JSON. */
export function unpackInstrumentFile(data: ArrayBuffer | Uint8Array): InstrumentFileContents {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes[0] === 0x7b) return { bundle: parseInstrumentJson(strFromU8(bytes)), sampleData: {} }

  const entries = unzipSync(bytes)
  const json = entries[JSON_ENTRY]
  if (!json) throw new Error(`Not a valid instrument file: missing ${JSON_ENTRY}`)
  const sampleData: Record<string, Uint8Array> = {}
  for (const [path, entry] of Object.entries(entries)) {
    const match = /^samples\/([0-9a-f]+)\.bin$/.exec(path)
    if (match) sampleData[match[1]] = entry
  }
  return { bundle: parseInstrumentJson(strFromU8(json)), sampleData }
}
