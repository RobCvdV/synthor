import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useNodesState,
  type Connection as RFConnection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useDocStore } from '../state/docStore'
import { MODULE_DEFS } from '../domain/moduleDefs'
import type { Id, ModularInstrument, ModuleType } from '../domain/types'

/** Non-singleton module types the palette can drop into a patch. */
const PALETTE: ModuleType[] = ['osc', 'filter', 'adsr', 'gain', 'mix', 'lfo', 'tanh', 'delay', 'echo', 'reverb']

interface NodeData {
  instrumentId: Id
  moduleId: Id
  [key: string]: unknown
}

/** Vertical offset (px) for the i-th handle on a node side. */
const handleTop = (i: number) => 44 + i * 24

/** One module rendered as a React Flow node. Reads its params live from the
 *  store so slider edits never need a node rebuild. */
function ModuleNode({ data }: NodeProps) {
  const { instrumentId, moduleId } = data as NodeData
  const module = useDocStore((s) => {
    const inst = s.doc.entities.instruments[instrumentId]
    return inst?.kind === 'modular' ? inst.modules[moduleId] : undefined
  })
  const setModuleParam = useDocStore((s) => s.setModuleParam)
  const removeModule = useDocStore((s) => s.removeModule)
  if (!module) return null

  const def = MODULE_DEFS[module.type]
  return (
    <div className="mod-node">
      <div className="mod-node-head">
        <span>{def.label}</span>
        {!def.singleton && (
          <button className="mod-del nodrag" title="Delete module" onClick={() => removeModule(instrumentId, moduleId)}>
            ×
          </button>
        )}
      </div>

      {def.inlets.map((port, i) => (
        <div className="mod-port in" key={`in-${port}`} style={{ top: handleTop(i) }}>
          <Handle type="target" position={Position.Left} id={port} />
          <span className="mod-port-label">{port}</span>
        </div>
      ))}
      {def.outlets.map((port, i) => (
        <div className="mod-port out" key={`out-${port}`} style={{ top: handleTop(i) }}>
          <span className="mod-port-label">{port}</span>
          <Handle type="source" position={Position.Right} id={port} />
        </div>
      ))}

      <div className="mod-node-body" style={{ paddingTop: Math.max(def.inlets.length, def.outlets.length) * 24 }}>
        {def.params.map((p) => {
          const value = module.params[p.key] ?? p.default
          return (
            <label className="mod-param" key={p.key}>
              <span className="mod-param-label">
                {p.label}
                <span className="mod-param-value">{p.enumLabels ? p.enumLabels[Math.round(value)] : round(value)}</span>
              </span>
              <input
                className="nodrag"
                type="range"
                min={p.min}
                max={p.max}
                step={p.step}
                value={value}
                onChange={(e) => setModuleParam(instrumentId, moduleId, p.key, Number(e.target.value))}
              />
            </label>
          )
        })}
      </div>
    </div>
  )
}

const nodeTypes = { module: ModuleNode }

function round(v: number): string {
  return Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(2).replace(/\.?0+$/, '')
}

function buildNodes(inst: ModularInstrument): Node[] {
  return Object.values(inst.modules).map((m) => ({
    id: m.id,
    type: 'module',
    position: { ...m.pos },
    data: { instrumentId: inst.id, moduleId: m.id },
  }))
}

function buildEdges(inst: ModularInstrument): Edge[] {
  return Object.values(inst.connections).map((c) => ({
    id: c.id,
    source: c.from.moduleId,
    sourceHandle: c.from.port,
    target: c.to.moduleId,
    targetHandle: c.to.port,
    label: c.gain === 1 ? undefined : `×${round(c.gain)}`,
  }))
}

function Editor({ inst }: { inst: ModularInstrument }) {
  const addModule = useDocStore((s) => s.addModule)
  const moveModule = useDocStore((s) => s.moveModule)
  const addConnection = useDocStore((s) => s.addConnection)
  const removeConnection = useDocStore((s) => s.removeConnection)
  const setConnectionGain = useDocStore((s) => s.setConnectionGain)

  // Local node state for smooth dragging; positions persist to the doc on drag
  // stop. Rebuilt from the doc whenever the *set* of modules changes (add /
  // remove / undo) — param edits are read live inside ModuleNode, so they don't
  // force a rebuild.
  const [nodes, setNodes] = useNodesState<Node>(buildNodes(inst))
  const moduleKey = Object.keys(inst.modules).sort().join(',')
  useEffect(() => setNodes(buildNodes(inst)), [moduleKey, inst.id, setNodes, inst])

  // Edges are cheap and fully controlled by the doc.
  const connectionKey = Object.keys(inst.connections).sort().join(',')
  const edges = useMemo(() => buildEdges(inst), [connectionKey, inst])

  const [selectedEdge, setSelectedEdge] = useState<Id | null>(null)

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [setNodes],
  )
  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => moveModule(inst.id, node.id, node.position),
    [moveModule, inst.id],
  )
  const onConnect = useCallback(
    (c: RFConnection) => {
      if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return
      addConnection(
        inst.id,
        { moduleId: c.source, port: c.sourceHandle },
        { moduleId: c.target, port: c.targetHandle },
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

  return (
    <div className="modular-editor">
      <div className="mod-palette">
        <span className="mod-palette-label">Add:</span>
        {PALETTE.map((type, i) => (
          <button key={type} onClick={() => addModule(inst.id, type, { x: 320 + (i % 3) * 40, y: 300 + i * 30 })}>
            {MODULE_DEFS[type].label}
          </button>
        ))}
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
      <div className="mod-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onEdgesChange={onEdgesChange}
          colorMode="dark"
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  )
}

export function ModularEditor({ inst }: { inst: ModularInstrument }) {
  return (
    <ReactFlowProvider>
      <Editor inst={inst} />
    </ReactFlowProvider>
  )
}
