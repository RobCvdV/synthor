/** Outcome of importing files straight into a library. */
export interface LibraryImportResult {
  /** Library ids of the added items, in file order. */
  ids: string[]
  failed: { fileName: string; error: string }[]
}
