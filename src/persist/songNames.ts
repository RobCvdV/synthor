import { slugify } from './songStore'

/** Songs are stored by name slug, so two names with the same slug would overwrite each other. */
export function songNameConflict(name: string, takenSlugs: Iterable<string>, ownSlug?: string): string | null {
  if (!name.trim()) return 'Enter a name'
  const slug = slugify(name)
  if (slug === ownSlug) return null
  for (const taken of takenSlugs) {
    if (taken === slug) return 'Another song already uses this name'
  }
  return null
}

/** `base`, or `base 2`, `base 3`… — the first name whose slug is free. */
export function uniqueSongName(base: string, takenSlugs: Iterable<string>): string {
  const taken = new Set(takenSlugs)
  if (!taken.has(slugify(base))) return base
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`
    if (!taken.has(slugify(name))) return name
  }
}
