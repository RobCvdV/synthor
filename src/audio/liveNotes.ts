import type { Doc, Id } from '../domain/types'
import { liveVoiceCount } from '../domain/types'
import { computeSlotLayouts, slotGlobalIndex, type InstrumentSlotLayout } from '../engine/voiceSlotLayout'
import { chooseLiveSlot, liveGraphOptions, liveSlotValues } from '../player/liveSlot'
import { useAppStore } from '../state/appStore'
import { useDocStore } from '../state/docStore'
import type { AudioHost } from './host'

interface HeldNote {
  instId: Id
  note: number
  velocity: number
  /** Global txSeq slot, or -1 when played on free-play voices. */
  slot: number
}

/**
 * Routes live notes (keyboard, MIDI, tracker pips): the current instrument
 * plays its own voices in free play; everything else plays through the
 * instrument's tracker slots on the txSeq node, so it costs no extra DSP.
 */
export class LiveNotes {
  private held = new Map<string, HeldNote>()
  /** Global slot → key of the note that owns it. */
  private slotOwner = new Map<number, string>()
  private lastSlot = new Map<Id, number>()
  private layoutCache: { doc: Doc; ensure: Id | null; layouts: InstrumentSlotLayout[] } | null = null

  constructor(private host: AudioHost) {}

  /** `preferredSlot` is the instrument-local tracker slot to use (the cursor track's). */
  noteOn(instId: Id, note: number, velocity = 127, preferredSlot?: number): void {
    const { doc } = useDocStore.getState()
    const inst = doc.entities.instruments[instId]
    if (!inst) return
    const key = `${instId}:${note}`
    this.release(key)

    const { freePlay, selectedInstrumentId } = useAppStore.getState()
    if (freePlay && instId === selectedInstrumentId) {
      const pool = inst.kind === 'drumkit'
        ? this.host.voicePool(instId, 1, inst)
        : this.host.voicePool(instId, liveVoiceCount(inst))
      pool.noteOn(note, velocity)
      this.held.set(key, { instId, note, velocity, slot: -1 })
      return
    }

    const layouts = this.layouts(doc, liveGraphOptions(freePlay, selectedInstrumentId).ensureSlotInstId)
    const layout = layouts.find((l) => l.instId === instId)
    if (!layout) return

    const heldLocal = [...this.held.values()]
      .filter((h) => h.instId === instId && h.slot >= 0)
      .map((h) => h.slot - slotGlobalIndex(layouts, instId, 0))
    const local = chooseLiveSlot(layout.slotCount, heldLocal, this.lastSlot.get(instId) ?? -1, preferredSlot)
    if (local < 0) return
    const payload = liveSlotValues(layout, inst, note, velocity, true)
    if (!payload) return

    const slot = slotGlobalIndex(layouts, instId, local)
    const stolen = this.slotOwner.get(slot)
    if (stolen) this.held.delete(stolen)
    this.slotOwner.set(slot, key)
    this.lastSlot.set(instId, local)
    this.held.set(key, { instId, note, velocity, slot })

    // Stopped transport gates the tracker mix; a live note opens it.
    this.host.paramRefs.setValue('transport:playing', 1)
    this.host.sendTxSeqLive({ type: 'live', slot, ...payload })
  }

  noteOff(instId: Id, note: number): void {
    this.release(`${instId}:${note}`)
  }

  /** Forget all live notes; the host zeroes the voices and clears txSeq overrides. */
  reset(): void {
    this.held.clear()
    this.slotOwner.clear()
  }

  private release(key: string): void {
    const h = this.held.get(key)
    if (!h) return
    this.held.delete(key)

    if (h.slot < 0) {
      this.host.voicePool(h.instId).noteOff(h.note)
      return
    }
    if (this.slotOwner.get(h.slot) !== key) return
    this.slotOwner.delete(h.slot)

    const { doc } = useDocStore.getState()
    const inst = doc.entities.instruments[h.instId]
    const layout = this.layoutCache?.layouts.find((l) => l.instId === h.instId)
    const payload = inst && layout ? liveSlotValues(layout, inst, h.note, h.velocity, false) : null
    if (payload) this.host.sendTxSeqLive({ type: 'live', slot: h.slot, ...payload })
  }

  private layouts(doc: Doc, ensure: Id | null): InstrumentSlotLayout[] {
    const c = this.layoutCache
    if (c && c.doc === doc && c.ensure === ensure) return c.layouts
    const layouts = computeSlotLayouts(doc, ensure)
    this.layoutCache = { doc, ensure, layouts }
    return layouts
  }
}
