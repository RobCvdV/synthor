import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useNodesState,
  useOnSelectionChange,
  useReactFlow,
  type Connection as RFConnection,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useDocStore } from '../state/docStore'
import { MODULE_DEFS, type ModuleGroup } from '../domain/moduleDefs'
import type { Id, ModuleType, ModularInstrument } from '../domain/types'
import { collectClipboardModules, collectDeletableIds, preparePastedModules, type ModuleClipboard } from '../domain/clipboard'
import { computeModuleLayout, estimateModuleSize } from '../domain/layout'
import { buildDxAlgorithm } from '../domain/factory'
import type { AudioHost } from '../audio/host'
import { isEditableTarget } from './keymap'
import { ModuleNode } from './ModuleNode'
import { buildEdges, buildNodes } from './modularLayout'
import { round } from './format'

/** Palette categories in display order. Types come from the registry, so a
 *  new module def with a `group` shows up in the palette automatically. */
const PALETTE_GROUPS: Array<{ label: string; group: ModuleGroup }> = [
  { label: 'Sources', group: 'sources' },
  { label: 'Generators', group: 'generators' },
  { label: 'Shaping', group: 'shaping' },
  { label: 'Distortion', group: 'distortion' },
  { label: 'Time & Space', group: 'time' },
]

/** Non-singleton module types in a palette group, in registry order. */
const paletteTypes = (group: ModuleGroup): ModuleType[] =>
  (Object.keys(MODULE_DEFS) as ModuleType[]).filter(
    (t) => MODULE_DEFS[t].group === group && !MODULE_DEFS[t].singleton,
  )

const nodeTypes = { module: ModuleNode }


function Editor({ inst, host }: { inst: ModularInstrument; host?: AudioHost }) {
  const addModule = useDocStore((s) => s.addModule)
  const _moveModule = useDocStore((s) => s.moveModule) // kept for hook count stability
  void _moveModule
  const addConnection = useDocStore((s) => s.addConnection)
  const removeConnection = useDocStore((s) => s.removeConnection)
  const setConnectionGain = useDocStore((s) => s.setConnectionGain)
  const removeModules = useDocStore((s) => s.removeModules)
  const pasteModules = useDocStore((s) => s.pasteModules)
  const ensureModularSingletons = useDocStore((s) => s.ensureModularSingletons)

  const { screenToFlowPosition, getNodes, fitView } = useReactFlow()

  // Ensure required singleton source modules exist.
  useEffect(() => { ensureModularSingletons(inst.id) }, [inst.id, ensureModularSingletons])

  // Local node state for smooth dragging; positions persist to the doc on drag
  // stop. Rebuilt from the doc whenever the *set* or *positions* of modules
  // change — param edits are read live inside ModuleNode, so they don't force a
  // rebuild.  We derive a structural + position key instead of watching `inst`
  // directly, otherwise every param slider drag would replace all React Flow
  // nodes and cause controlled inputs to revert.
  const [nodes, setNodes] = useNodesState<Node>(buildNodes(inst, host))
  const moduleKey = Object.keys(inst.modules).sort().join(',')
  const posKey = Object.values(inst.modules)
    .map((m) => `${m.id}:${Math.round(m.pos.x)},${Math.round(m.pos.y)}`)
    .sort()
    .join('|')
  const structuralKey = `${moduleKey}||${posKey}`
  useEffect(() => {
    // Preserve selection state across node rebuilds — otherwise React Flow
    // clears the selection after any store change (drag stop, paste, delete).
    // A pending paste replaces the selection entirely, so the freshly pasted
    // nodes can be dragged to a new position right away.
    const prevSelected = new Set(getNodes().filter((n) => n.selected).map((n) => n.id))
    const pending = pendingSelectionRef.current
    pendingSelectionRef.current = []
    const selection = pending.length > 0 ? new Set(pending) : prevSelected
    setNodes(
      buildNodes(inst, host).map((n) => ({
        ...n,
        selected: selection.has(n.id) || undefined,
      })),
    )
  }, [structuralKey, inst.id, host, setNodes, getNodes])

  // Edges are cheap and fully controlled by the doc.
  const connectionKey = Object.keys(inst.connections).sort().join(',')
  const edges = useMemo(() => buildEdges(inst), [connectionKey, inst])

  const [selectedEdge, setSelectedEdge] = useState<Id | null>(null)

  // Track selected node ids via React Flow's selection-change hook.
  const selectedIdsRef = useRef<Set<Id>>(new Set())
  useOnSelectionChange({
    onChange: ({ nodes: sel }) => {
      selectedIdsRef.current = new Set(sel.map((n) => n.id))
    },
  })

  // Clipboard (non-undoable, like the track clipboard).
  const clipboardRef = useRef<ModuleClipboard | null>(null)

  // Track ids that should be selected after the next node rebuild — used
  // to auto-select pasted nodes once they appear in the store.
  const pendingSelectionRef = useRef<Id[]>([])

  // --- helpers for cut/copy/paste/delete --------------------------------
  // The "latest ref" pattern: update the ref body on every render so
  // keyboard handlers and button clicks always read the current store
  // state.  No useCallback, no stale-prop bugs, no eslint-disable.

  const selectedIds = (): Id[] => getNodes().filter((n) => n.selected).map((n) => n.id)

  const doCopyRef = useRef<() => void>(() => {})
  doCopyRef.current = () => {
    const doc = useDocStore.getState().doc
    const current = doc.entities.instruments[inst.id]
    if (current?.kind !== 'modular') return
    clipboardRef.current = collectClipboardModules(current, selectedIds())
  }

  const doCutRef = useRef<() => void>(() => {})
  doCutRef.current = () => {
    const doc = useDocStore.getState().doc
    const current = doc.entities.instruments[inst.id]
    if (current?.kind !== 'modular') return
    clipboardRef.current = collectClipboardModules(current, selectedIds())
    if (clipboardRef.current) removeModules(inst.id, clipboardRef.current.modules.map((m) => m.id))
  }

  const doPasteRef = useRef<() => void>(() => {})
  doPasteRef.current = () => {
    const clip = clipboardRef.current
    if (!clip || clip.modules.length === 0) return
    const doc = useDocStore.getState().doc
    const current = doc.entities.instruments[inst.id]
    if (current?.kind !== 'modular') return
    const { modules, connections } = preparePastedModules(clip)
    pasteModules(inst.id, modules, connections)
    // Select the pasted nodes once they appear in the rebuilt node list.
    pendingSelectionRef.current = modules.map((m) => m.id)
  }

  const doDeleteRef = useRef<() => void>(() => {})
  doDeleteRef.current = () => {
    const doc = useDocStore.getState().doc
    const current = doc.entities.instruments[inst.id]
    if (current?.kind !== 'modular') return
    const ids = collectDeletableIds(current, selectedIds())
    if (ids.length === 0) {
      if (selectedEdge) {
        removeConnection(inst.id, selectedEdge)
        setSelectedEdge(null)
      }
      return
    }
    removeModules(inst.id, ids)
  }

  const doLayoutRef = useRef<() => void>(() => {})
  doLayoutRef.current = () => {
    const doc = useDocStore.getState().doc
    const current = doc.entities.instruments[inst.id]
    if (current?.kind !== 'modular') return
    const all = Object.values(current.modules)
    if (all.length === 0) return
    const sel = selectedIds()
    const selectionMode = sel.length >= 2 // one selected node → whole graph
    const scope = selectionMode
      ? {
          modules: all.filter((m) => sel.includes(m.id)),
          connections: Object.values(current.connections).filter(
            (c) => sel.includes(c.from.moduleId) && sel.includes(c.to.moduleId),
          ),
        }
      : { modules: all, connections: Object.values(current.connections) }
    // Prefer React Flow's live measurements; the def-derived estimate covers
    // nodes RF hasn't measured yet (e.g. a click before the first paint).
    const rfNodes = getNodes()
    const measured = new Map<Id, { width: number; height: number }>()
    for (const n of rfNodes) {
      const m = n.measured
      if (m && m.width !== undefined && m.height !== undefined && m.width > 0 && m.height > 0) {
        measured.set(n.id, { width: m.width, height: m.height })
      }
    }
    const getSize = (id: Id) => measured.get(id) ?? estimateModuleSize(current.modules[id])
    // Anchor at the scope's current top-left so nothing teleports; fitView
    // right after makes the anchor invisible for the whole-graph case.
    const anchor = {
      x: Math.min(...scope.modules.map((m) => m.pos.x)),
      y: Math.min(...scope.modules.map((m) => m.pos.y)),
    }
    const laidOut = computeModuleLayout(scope.modules, scope.connections, getSize, { anchor })
    if (laidOut.length === 0) return
    useDocStore.getState().moveModules(inst.id, laidOut)
    // New positions reach React Flow via the store → rebuild effect → setNodes,
    // all post-commit — wait two frames before fitting.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fitView(selectionMode
        ? { nodes: rfNodes.filter((n) => scope.modules.some((m) => m.id === n.id)), duration: 300, padding: 0.2 }
        : { duration: 300, padding: 0.2 })
    }))
  }

  const addDxAlgorithmRef = useRef<(alg: number, clientX: number, clientY: number) => void>(() => {})
  addDxAlgorithmRef.current = (alg, clientX, clientY) => {
    const doc = useDocStore.getState().doc
    const current = doc.entities.instruments[inst.id]
    if (current?.kind !== 'modular') return
    // The gate singleton always exists (undeletable), so the preset's
    // envelope can rely on it.
    const gate = Object.values(current.modules).find((m) => m.type === 'gate')
    if (!gate) return
    const pos = screenToFlowPosition({ x: clientX, y: clientY })
    const { modules, connections } = buildDxAlgorithm(alg, current.outputId, gate.id, pos)
    pasteModules(inst.id, modules, connections)
    pendingSelectionRef.current = modules.map((m) => m.id)
  }

  // --- keyboard shortcuts -----------------------------------------------
  // Stable effect with empty deps — refs are always current.

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const isCopy = mod && e.code === 'KeyC'
      const isCut = mod && e.code === 'KeyX'
      const isPaste = mod && e.code === 'KeyV'
      const isDel = e.code === 'Delete' || e.code === 'Backspace'

      if (!isCopy && !isCut && !isPaste && !isDel) return
      if (isEditableTarget(e.target)) return

      e.preventDefault()
      if (isCopy) doCopyRef.current()
      else if (isCut) doCutRef.current()
      else if (isPaste) doPasteRef.current()
      else if (isDel) doDeleteRef.current()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // --- React Flow callbacks ---------------------------------------------

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [setNodes],
  )
  const onNodeDragStop = useCallback(
    (_: unknown, _node: Node, nodes: Node[]) => {
      useDocStore.getState().moveModules(
        inst.id,
        nodes.map((n) => ({ id: n.id, pos: n.position })),
      )
    },
    [inst.id],
  )
  // Track the stack modifier (⌘ on Mac / Ctrl elsewhere) while connecting —
  // React Flow's onConnect doesn't carry the event, so read it from a ref.
  // modHeld mirrors it as state so the UI can react (the + indicator) mid-drag.
  const [modHeld, setModHeld] = useState(false)
  const stackModRef = useRef(false)
  useEffect(() => {
    const update = (e: KeyboardEvent) => {
      const held = e.metaKey || e.ctrlKey
      stackModRef.current = held
      setModHeld(held)
    }
    const reset = () => {
      stackModRef.current = false
      setModHeld(false)
    }
    window.addEventListener('keydown', update)
    window.addEventListener('keyup', update)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', update)
      window.removeEventListener('keyup', update)
      window.removeEventListener('blur', reset)
    }
  }, [])

  // True while a cord is being dragged — gates the stack-mode "+" indicator.
  const [connecting, setConnecting] = useState(false)

  const onConnect = useCallback(
    (c: RFConnection) => {
      if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return
      addConnection(
        inst.id,
        { moduleId: c.source, port: c.sourceHandle },
        { moduleId: c.target, port: c.targetHandle },
        stackModRef.current,
      )
    },
    [addConnection, inst.id],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const ch of changes) {
        if (ch.type === 'remove') removeConnection(inst.id, ch.id)
        if (ch.type === 'select' && ch.selected) setSelectedEdge(ch.id)
      }
    },
    [removeConnection, inst.id],
  )

  const selected = selectedEdge ? inst.connections[selectedEdge] : undefined

  // Drag-from-palette: allow dropping a module type onto the canvas.
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const type = e.dataTransfer.getData('application/module-type') as ModuleType | ''
      if (!type || !MODULE_DEFS[type]) return
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      addModule(inst.id, type, pos)
    },
    [addModule, inst.id, screenToFlowPosition],
  )

  return (
    <div className="modular-editor">
      <div className="mod-palette">
        <span className="mod-palette-label" style={{ marginLeft: 12 }}>Selection:</span>
        <button onClick={() => doCopyRef.current()} title="Copy selected (⌘C / Ctrl+C)">Copy</button>
        <button onClick={() => doCutRef.current()} title="Cut selected (⌘X / Ctrl+X)">Cut</button>
        <button onClick={() => doPasteRef.current()} title="Paste (⌘V / Ctrl+V)">Paste</button>
        <button onClick={() => doDeleteRef.current()} title="Delete selected (Del)">Del</button>
        <button onClick={() => doLayoutRef.current()} title="Auto layout: ≥2 selected → layout selection, else whole patch">Layout</button>
        {selected && (
          <span className="mod-edge-inspector">
            <span>cord ×{round(selected.gain)}</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={selected.gain}
              onChange={(e) => setConnectionGain(inst.id, selected.id, Number(e.target.value))}
            />
            <button onClick={() => { removeConnection(inst.id, selected.id); setSelectedEdge(null) }}>remove</button>
          </span>
        )}
      </div>
      <div className="mod-palette">
        <span className="mod-palette-label">Add:</span>
        {PALETTE_GROUPS.map(({ label, group }) => (
          <div className="mod-palette-group" key={group}>
            <span className="mod-palette-group-label">{label}</span>
            {paletteTypes(group).map((type) => (
              <button
                key={type}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/module-type', type)
                  e.dataTransfer.effectAllowed = 'move'
                }}
              >
                {MODULE_DEFS[type].label}
              </button>
            ))}
          </div>
        ))}
        <div className="mod-palette-group">
          <span className="mod-palette-group-label">DX FM</span>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((alg) => (
            <button
              key={alg}
              onClick={(e) => addDxAlgorithmRef.current(alg, e.clientX, e.clientY)}
              title="Insert 4 DX operators wired per this algorithm"
            >
              Alg {alg}
            </button>
          ))}
        </div>
      </div>
      <div
        className={'mod-canvas' + (connecting && modHeld ? ' stack-mode' : '')}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onConnectStart={() => setConnecting(true)}
          onConnectEnd={() => setConnecting(false)}
          onEdgesChange={onEdgesChange}
          colorMode="dark"
          fitView
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={['Backspace', 'Delete']}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  )
}

export function ModularEditor({ inst, host }: { inst: ModularInstrument; host?: AudioHost }) {
  return (
    <ReactFlowProvider>
      <Editor inst={inst} host={host} />
    </ReactFlowProvider>
  )
}
