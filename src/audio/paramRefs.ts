import { el, type NodeRepr_t } from '@elemaudio/core'
import type WebRenderer from '@elemaudio/web-renderer'

/** Module-level singleton so the store can reach it without coupling to React. */
let activeRegistry: ParamRefRegistry | null = null

/** Exposed for docStore / midiStore — call after AudioHost creates the registry. */
export function setActiveParamRefs(r: ParamRefRegistry | null): void {
  activeRegistry = r
}

/** Quick ref update from anywhere — no-op when the host isn't ready. */
export function updateParamRef(key: string, value: number): void {
  activeRegistry?.setValue(key, value)
}

/**
 * Registry of Elementary `createRef` nodes so slider / MIDI CC values can be
 * updated directly (no graph recompilation) after the initial render.
 */
export class ParamRefRegistry {
  private refs = new Map<string, { node: NodeRepr_t; setter: (props: Record<string, unknown>) => void }>()
  private core: WebRenderer | null = null

  attach(core: WebRenderer): void { this.core = core }

  /** Return a ref node for the given key, creating one on first call. */
  getOrCreate(key: string, value: number): NodeRepr_t {
    const existing = this.refs.get(key)
    if (existing) {
      try { existing.setter({ value }) } catch { /* unmounted */ }
      return existing.node
    }
    if (!this.core) return el.const({ key, value })
    const pair = this.core.createRef('const', { value }, [])
    const node = pair[0] as NodeRepr_t
    const setter = pair[1] as (props: Record<string, unknown>) => void
    this.refs.set(key, { node, setter })
    return node
  }

  /** Update a ref's value without recompiling.  Silently skips unmounted refs
   *  (the value will be picked up on the next render pass). */
  setValue(key: string, value: number): void {
    const ref = this.refs.get(key)
    if (!ref) return
    try { ref.setter({ value }) } catch { /* unmounted — next render picks it up */ }
  }

  /** Discard all cached refs (call before structural recompile). */
  clear(): void { this.refs.clear() }

  get size(): number { return this.refs.size }
}
