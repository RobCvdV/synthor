import { createNode, el, type NodeRepr_t, type ElemNode } from '@elemaudio/core'
import type WebRenderer from '@elemaudio/web-renderer'

/** Module-level singleton so the store can reach it without coupling to React. */
let activeRegistry: ParamRefRegistry | null = null

/** Exposed for docStore / midiStore — call after AudioHost creates the registry. */
export function setActiveParamRefs(r: ParamRefRegistry | null): void {
  activeRegistry = r
}

/** Quick ref update from anywhere — no-op when the host isn't ready. */
export function updateParamRef(key: string, value: number): void {
  if (!activeRegistry) return
  activeRegistry.setValue(key, value)
}

/** Clear all refs — call on undo/redo so the next compile recreates them. */
export function clearParamRefs(): void {
  activeRegistry?.clear()
}

type Setter = (props: Record<string, unknown>) => void

/**
 * Registry of Elementary `createRef` nodes so slider / MIDI CC values can be
 * updated directly (no graph recompilation) after the initial render.
 *
 * Multi-core: the split rendering uses one Elementary node per 32-channel
 * scheduler batch. Each core creates refs in lockstep call order, so ref
 * nodes share identical `__refKey` ids across cores — one compiled graph
 * works on every core, and setValue broadcasts to each core's setter.
 */
export class ParamRefRegistry {
  private refs = new Map<string, { node: NodeRepr_t; setters: Setter[]; applys?: ((value: number) => void)[] }>()
  private cores: WebRenderer[] = []
  /** Values queued while refs were unmounted — flushed after render completes.
   *  Array preserves order so rapid on→off sequences aren't collapsed. */
  private pending: { key: string; value: number }[] = []

  attach(core: WebRenderer): void { this.cores.push(core) }

  /** Return a ref node for the given key, creating one per core on first call.
   *  Does NOT sync the value on existing refs — the setter handles that. */
  getOrCreate(key: string, value: number): NodeRepr_t {
    const existing = this.refs.get(key)
    if (existing) return existing.node
    if (this.cores.length === 0) return el.const({ key, value })
    let node: NodeRepr_t | null = null
    const setters: Setter[] = []
    for (const core of this.cores) {
      const pair = core.createRef('const', { value }, [])
      node ??= pair[0] as NodeRepr_t
      setters.push(pair[1] as Setter)
    }
    this.refs.set(key, { node: node!, setters })
    return node!
  }

  /** Like getOrCreate but for any node kind (not just const).
   *  `makeApply` receives the node's setter and returns an apply function
   *  that translates a numeric slider value to the node's props.
   *  Example: filter mode 0→1→2 mapped to 'lowpass'/'highpass'/'bandpass'. */
  getOrCreateNode(
    key: string,
    kind: string,
    props: Record<string, unknown>,
    children: ElemNode[],
    makeApply?: (setter: (props: Record<string, unknown>) => void) => (value: number) => void,
  ): NodeRepr_t {
    const existing = this.refs.get(key)
    if (existing) return existing.node
    if (this.cores.length === 0) return createNode(kind, props, children) as unknown as NodeRepr_t
    let node: NodeRepr_t | null = null
    const setters: Setter[] = []
    const applys: ((value: number) => void)[] = []
    for (const core of this.cores) {
      const pair = core.createRef(kind, props, children)
      node ??= pair[0] as NodeRepr_t
      const setter = pair[1] as Setter
      setters.push(setter)
      applys.push(makeApply?.(setter) ?? ((value) => setter({ value })))
    }
    this.refs.set(key, { node: node!, setters, applys })
    return node!
  }

  /** Update a ref's value without recompiling.  If the ref isn't mounted yet
   *  the value is queued and applied via flushPending after the next render.
   *  When the ref exists, any stale pending entries for this key are removed
   *  first — otherwise flushPending could override a direct setValue call
   *  (e.g. a note-off directly setting gate=0 getting overridden by a
   *  previously-queued gate=1). */
  setValue(key: string, value: number): void {
    const ref = this.refs.get(key)
    if (!ref) {
      this.pending.push({ key, value })
      return
    }
    // Remove stale pending entries — this direct write supersedes them.
    this.pending = this.pending.filter((p) => p.key !== key)
    for (let i = 0; i < ref.setters.length; i++) {
      try {
        if (ref.applys) ref.applys[i](value)
        else ref.setters[i]({ value })
      } catch {
        // Ref not mounted on this core — queue for the next flush.
      }
    }
  }

  /** Apply all queued values in order.  Call after core.render() completes. */
  flushPending(): void {
    if (this.pending.length === 0) return
    const batch = this.pending
    this.pending = []
    for (const { key, value } of batch) {
      const ref = this.refs.get(key)
      if (!ref) continue
      for (let i = 0; i < ref.setters.length; i++) {
        try {
          if (ref.applys) ref.applys[i](value)
          else ref.setters[i]({ value })
        } catch { /* still unmounted */ }
      }
    }
  }

  get pendingCount(): number { return this.pending.length }

  /** Discard all cached refs (call before structural recompile). */
  clear(): void { this.refs.clear(); this.pending.length = 0 }

  /** Set all gate and velocity refs to 0 — silences every live voice instantly. */
  panic(): void {
    for (const [key, ref] of this.refs) {
      if (key.endsWith(':gate') || key.endsWith(':vel')) {
        for (const setter of ref.setters) {
          try { setter({ value: 0 }) } catch { /* ignore unmounted refs */ }
        }
      }
    }
  }

  get size(): number { return this.refs.size }
}
