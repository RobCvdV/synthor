import { createDefaultDoc } from '../../domain/factory'
import { useDocStore } from '../../state/docStore'
import { useAppStore } from '../../state/appStore'
import { useTransportStore } from '../../state/transportStore'
import { useAudioStore } from '../../state/audioStore'
import { useProjectStore } from '../../state/projectStore'
import type { AudioHost } from '../../audio/host'

/** Reset every zustand store to its initial state. Call in beforeEach. */
export function resetStores(): void {
  useDocStore.setState({
    doc: createDefaultDoc(),
    past: [],
    future: [],
    trackClipboard: null,
    rectClipboard: null,
    vfsLoadedHashes: null,
    silentBatch: false,
  })
  useAppStore.setState({
    playMode: 'pattern',
    view: 'tracker',
    trackerCursor: { row: 0, track: 0, col: 0, laneIndex: null },
    selectedInstrumentId: null,
    selectedSampleId: null,
    octave: 5,
    mutedTrackNumbers: {},
    soloedTrackNumbers: {},
    freePlay: true,
  })
  useTransportStore.setState({
    playing: false,
    bpm: 120,
    linesPerBeat: 4,
    startTime: 0,
    startRow: 0,
    playEpoch: 0,
    currentRow: 0,
  })
  useAudioStore.setState({ status: 'idle', playbackStarted: false })
  useProjectStore.setState({
    name: 'Untitled',
    slug: 'untitled',
    savedSlug: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'idle',
    lastSavedAt: null,
  })
  // appStore is zustand persist — clear localStorage so side effects don't leak
  localStorage.clear()
}

/** Minimal AudioHost stub for components that accept an optional host. */
export function stubHost(): AudioHost {
  return {
    isReady: true,
    currentTime: 0,
    playStartTime: 0,
    playStartRow: 0,
    outputAgeMs: 0,
    skipNextRecompile: false,
    start: () => Promise.resolve(),
    panic: () => {},
    updateVfs: () => Promise.resolve(),
    pruneVfs: () => Promise.resolve(),
    getLevel: () => 0,
    paramRefs: {
      clear: () => {},
      setValue: () => {},
    },
    ccBindings: new Map(),
  } as unknown as AudioHost
}