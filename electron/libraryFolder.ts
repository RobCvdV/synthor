/** Moving the library to another folder: target checks and a merging copy. */
import fs from 'node:fs/promises'
import path from 'node:path'

/** Library parts copied to a new folder (`recent` points at the last open song). */
const LIBRARY_ENTRIES = ['songs', 'instruments', 'samples', 'recent']

/** Why `target` can't be the new library folder, or null if it can. */
export function libraryTargetProblem(current: string, target: string): string | null {
  const from = path.resolve(current)
  const to = path.resolve(target)
  if (from === to) return 'That is already the library folder.'
  const inside = (child: string, parent: string) => {
    const rel = path.relative(parent, child)
    return !rel.startsWith('..') && !path.isAbsolute(rel)
  }
  if (inside(to, from)) return 'The new folder can’t be inside the current library.'
  if (inside(from, to)) return 'The new folder can’t contain the current library.'
  return null
}

/** Copies the library into `target`, keeping anything already there (like a restore, never overwrites). */
export async function copyLibrary(current: string, target: string): Promise<void> {
  for (const entry of LIBRARY_ENTRIES) {
    const src = path.join(current, entry)
    if (!(await fs.stat(src).catch(() => null))) continue
    await fs.cp(src, path.join(target, entry), {
      recursive: true,
      force: false,
      errorOnExist: false,
      filter: (p) => !path.basename(p).startsWith('.'),
    })
  }
}
