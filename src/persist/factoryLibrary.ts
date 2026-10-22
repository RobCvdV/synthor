/**
 * Seeds the factory instruments into the instrument library. A manifest remembers what was
 * seeded, so a preset the user deleted stays deleted, and a release with new presets adds just
 * those. An existing library item with the same folder name is never overwritten.
 */
import type { LibraryMeta } from '../domain/library'
import { FACTORY_INSTRUMENTS, type FactoryInstrument } from '../domain/presets/factoryInstruments'
import { serializeInstrumentBundle } from './instrumentFile'
import { joinPath, storage } from './storage'

const LIBRARY_DIR = 'instruments'
const MANIFEST = joinPath(LIBRARY_DIR, '.factory.json')

async function readSeeded(): Promise<Set<string>> {
  const text = await storage()?.readText(MANIFEST).catch(() => null)
  if (!text) return new Set()
  try {
    const seeded = (JSON.parse(text) as { seeded?: unknown }).seeded
    return new Set(Array.isArray(seeded) ? seeded.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Adds the presets not seeded before; returns the ids written to the library. */
export async function seedFactoryInstruments(presets: FactoryInstrument[] = FACTORY_INSTRUMENTS, now = new Date()): Promise<string[]> {
  const s = storage()
  if (!s) return []
  const seeded = await readSeeded()
  const pending = presets.filter((p) => !seeded.has(p.id))
  if (pending.length === 0) return []

  const written: string[] = []
  for (const preset of pending) {
    const file = joinPath(LIBRARY_DIR, preset.id, 'instrument.json')
    if (!await s.exists(joinPath(LIBRARY_DIR, preset.id))) {
      const inst = preset.build()
      const stamp = now.toISOString()
      const meta: LibraryMeta = { category: preset.category, tags: [...preset.tags], createdAt: stamp, modifiedAt: stamp }
      await s.write(file, serializeInstrumentBundle({ rootId: inst.id, instruments: { [inst.id]: inst }, samples: {} }, meta))
      written.push(preset.id)
    }
    seeded.add(preset.id)
  }
  await s.write(MANIFEST, JSON.stringify({ seeded: [...seeded] }, null, 2))
  return written
}
