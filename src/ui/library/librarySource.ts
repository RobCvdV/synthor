import type { InstrumentLibraryItem, LibraryItem, SampleLibraryItem } from '../../domain/library'
import {
  deleteLibraryInstrument, listLibraryInstruments, updateLibraryItem,
} from '../../persist/instrumentLibrary'
import { deleteLibrarySample, listLibrarySamples, readLibrarySampleAudio, updateLibrarySample } from '../../persist/sampleLibrary'
import { formatDuration } from '../format'
import { exportLibraryInstrumentFile, importInstrumentFilesToLibrary } from '../instrumentActions'
import { exportLibrarySampleFile, importSampleFilesToLibrary } from '../sampleActions'
import type { LibraryImportResult } from './libraryImport'

export interface LibraryPatch {
  name?: string
  category?: string
  tags?: string[]
}

/** One library as the shared dialogs see it. */
export interface LibrarySource<T extends LibraryItem = LibraryItem> {
  title: string
  pickTitle: string
  /** Singular, lowercase: "instrument", "sample". */
  noun: string
  list(): Promise<T[]>
  update(id: string, patch: LibraryPatch): Promise<T>
  remove(id: string): Promise<void>
  exportFile(id: string): Promise<{ blob: Blob; filename: string }>
  /** File types for the Import… picker. */
  importAccept: string
  /** Adds files to the library only, not to the song. */
  importFiles(files: File[]): Promise<LibraryImportResult>
  /** Row icon and a one-line description for the details pane. */
  describe(item: T): { icon: string; label: string }
  /** Plays the item, when it can be auditioned. */
  preview?(item: T): void
}

export const instrumentLibrary: LibrarySource<InstrumentLibraryItem> = {
  title: 'Instrument Library',
  pickTitle: 'Add Instruments from Library',
  noun: 'instrument',
  list: listLibraryInstruments,
  update: updateLibraryItem,
  remove: deleteLibraryInstrument,
  exportFile: exportLibraryInstrumentFile,
  importAccept: '.synthinst,.json,application/json,application/zip',
  importFiles: importInstrumentFilesToLibrary,
  describe: (item) => (item.kind === 'drumkit' ? { icon: '◆', label: 'Drum Kit' } : { icon: '▦', label: 'Synth' }),
}

/** The sample library; `play` auditions audio bytes (e.g. `host.playSamplePreview`). */
export function sampleLibrary(play?: (hash: string, bytes: ArrayBuffer) => void): LibrarySource<SampleLibraryItem> {
  return {
    title: 'Sample Library',
    pickTitle: 'Add Samples from Library',
    noun: 'sample',
    list: listLibrarySamples,
    update: updateLibrarySample,
    remove: deleteLibrarySample,
    exportFile: exportLibrarySampleFile,
    importAccept: 'audio/*',
    importFiles: importSampleFilesToLibrary,
    describe: ({ sample }) => ({
      icon: '∿',
      label: `${sample.channels === 2 ? 'Stereo' : 'Mono'} · ${sample.sampleRate} Hz · ${formatDuration(sample.sampleRate, sample.frames, 1)}`,
    }),
    preview: play && ((item) => {
      void readLibrarySampleAudio(item.id).then((audio) => { if (audio) play(item.sample.hash, audio.bytes) })
    }),
  }
}
