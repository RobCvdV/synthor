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

/**
 * Registry of Elementary `createRef` nodes so slider / MIDI CC values can be
 * updated directly (no graph recompilation) after the initial render.
 */
export class ParamRefRegistry {
  private refs = new Map<string, { node: NodeRepr_t; setter: (props: Record<string, unknown>) => void; apply?: (value: number) => void }>()
  private core: WebRenderer | null = null
  /** Values queued while refs were unmounted — flushed after render completes.
   *  Array preserves order so rapid on→off sequences aren't collapsed. */
  private pending: { key: string; value: number }[] = []

  attach(core: WebRenderer): void { this.core = core }

  /** Return a ref node for the given key, creating one on first call.
   *  Does NOT sync the value on existing refs — the setter handles that. */
  getOrCreate(key: string, value: number): NodeRepr_t {
    const existing = this.refs.get(key)
    if (existing) return existing.node
    if (!this.core) return el.const({ key, value })
    const pair = this.core.createRef('const', { value }, [])
    const node = pair[0] as NodeRepr_t
    const setter = pair[1] as (props: Record<string, unknown>) => void
    this.refs.set(key, { node, setter })
    return node
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
    if (!this.core) return createNode(kind, props, children) as unknown as NodeRepr_t
    const pair = this.core.createRef(kind, props, children)
    const node = pair[0] as NodeRepr_t
    const setter = pair[1] as (props: Record<string, unknown>) => void
    const apply = makeApply?.(setter)
    this.refs.set(key, { node, setter, apply })
    return node
  }

  /** Update a ref's value without recompiling.  If the ref isn't mounted yet
   *  the value is queued and applied via flushPending after the next render. */
  setValue(key: string, value: number): void {
    const ref = this.refs.get(key)
    if (!ref) {
      this.pending.push({ key, value })
      return
    }
    try {
      if (ref.apply) ref.apply(value)
      else ref.setter({ value })
    } catch {
      this.pending.push({ key, value })
    }
  }

  /** Apply all queued values in order.  Call after core.render() completes. */
  flushPending(): void {
    if (this.pending.length === 0) return
    const batch = this.pending
    this.pending = []
    for (const { key, value } of batch) {
      const ref = this.refs.get(key)
      if (ref) {
        try {
          if (ref.apply) ref.apply(value)
          else ref.setter({ value })
        } catch { /* still unmounted */ }
      }
    }
  }

  get pendingCount(): number { return this.pending.length }

  /** Discard all cached refs (call before structural recompile). */
  clear(): void { this.refs.clear(); this.pending.length = 0 }

  get size(): number { return this.refs.size }
}
