import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useNodesState,
  useOnSelectionChange,
  useReactFlow,
  type Connection as RFConnection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useDocStore } from '../state/docStore'
import { useMidiStore } from '../state/midiStore'
import { MODULE_DEFS, WAVEFORM_MAX_LENGTH_SECONDS, type ModuleGroup } from '../domain/moduleDefs'
import type { Id, ModuleType, ModularInstrument } from '../domain/types'
import { collectClipboardModules, collectDeletableIds, preparePastedModules, type ModuleClipboard } from '../domain/clipboard'
import { computeModuleLayout, estimateModuleSize } from '../domain/layout'
import { buildDxAlgorithm } from '../domain/factory'
import type { AudioHost } from '../audio/host'

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

interface NodeData {
  instrumentId: Id
  moduleId: Id
  [key: string]: unknown
}

/** Vertical offset (px) for the i-th handle on a node side. */
const handleTop = (i: number) => 44 + i * 24

/** Waveform colour for the output oscilloscope. */
const SCOPE_COLOR = '#4af'
const CLIP_THRESHOLD = 0.95

/** One module rendered as a React Flow node. Reads its params live from the
 *  store so slider edits never need a node rebuild. For the output module a
 *  clip LED and small waveform oscilloscope are rendered when an audio host
 *  is available. */
function ModuleNode({ data }: NodeProps) {
  const { instrumentId, moduleId, host } = data as NodeData & { host?: AudioHost }
  const module = useDocStore((s) => {
    const inst = s.doc.entities.instruments[instrumentId]
    return inst?.kind === 'modular' ? inst.modules[moduleId] : undefined
  })
  const setModuleParam = useDocStore((s) => s.setModuleParam)
  const setModuleParamSilent = useDocStore((s) => s.setModuleParamSilent)
  const removeModule = useDocStore((s) => s.removeModule)
  const renameModule = useDocStore((s) => s.renameModule)
  const [ccLearning, setCcLearning] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const ccLearningRef = useRef(false)
  ccLearningRef.current = ccLearning

  // Inlets with ≥ 2 incoming cords get a "+" badge (stacked input).
  // Stable joined string keeps re-renders to fan-in changes only.
  const stackedPorts = useDocStore((s) => {
    const inst = s.doc.entities.instruments[instrumentId]
    if (inst?.kind !== 'modular') return ''
    const counts = new Map<string, number>()
    for (const c of Object.values(inst.connections)) {
      if (c.to.moduleId === moduleId) counts.set(c.to.port, (counts.get(c.to.port) ?? 0) + 1)
    }
    return [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .map(([p]) => p)
      .sort()
      .join(',')
  })
  const isStacked = (port: string) => stackedPorts !== '' && stackedPorts.split(',').includes(port)

  // Auto-learn: when a CC value changes while in learn mode, set the CC
  // param and exit learn mode.
  useEffect(() => {
    if (!ccLearning) return
    const unsub = useMidiStore.subscribe((s, prev) => {
      if (!ccLearningRef.current) return
      for (const [cc, val] of Object.entries(s.ccValues)) {
        const prevVal = prev.ccValues[Number(cc)] ?? 0
        if (val !== prevVal) {
          setModuleParam(instrumentId, moduleId, 'cc', Number(cc))
          setCcLearning(false)
          return
        }
      }
    })
    return unsub
  }, [ccLearning, instrumentId, moduleId, setModuleParam])

  const def = module ? MODULE_DEFS[module.type] : undefined
  const isOutput = module?.type === 'output'
  const isInput = def?.inlets.length === 0 && def?.outlets.length > 0
  const hasBypass = def?.params.some((p) => p.key === 'bypass') ?? false
  const bypassed = hasBypass && (module?.params.bypass ?? 0) === 1
  const sampleEntities = useDocStore((s) => s.doc.entities.samples)
  const samples = useMemo(
    () => Object.values(sampleEntities).sort((a, b) => a.name.localeCompare(b.name)),
    [sampleEntities],
  )
  const sampleLabels = samples.map((s) => s.name)
  // Dynamically override the sampleIndex param when samples exist. The wave
  // module only lists samples ≤ WAVEFORM_MAX_LENGTH_SECONDS — the same filter
  // the engine applies, over the same name-sorted order. conv (IR) lists all.
  const moduleLabels =
    module?.type === 'sample' || module?.type === 'conv'
      ? sampleLabels
      : module?.type === 'wave'
        ? samples.filter((s) => s.frames / s.sampleRate <= WAVEFORM_MAX_LENGTH_SECONDS).map((s) => s.name)
        : undefined
  const paramOverrides =
    moduleLabels === undefined
      ? undefined
      : new Map<string, { max?: number; enumLabels?: string[] }>([
          [
            'sampleIndex',
            { max: Math.max(0, moduleLabels.length - 1), enumLabels: moduleLabels.length ? moduleLabels : ['(none)'] },
          ],
        ])

  // --- oscilloscope / clip LED for the output node --------------------
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const levelRef = useRef(0)

  useEffect(() => {
    if (!isOutput || !host) return
    let raf = 0
    const tick = () => {
      const lvl = host.getLevel()
      levelRef.current = lvl
      const canvas = canvasRef.current
      if (canvas) drawScope(canvas, host)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isOutput, host])

  // Poll the level ref on a cheap interval so React re-renders the LED
  // without repainting the scope canvas from React.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isOutput || !host) return
    const id = setInterval(() => setTick((n) => n + 1), 80)
    return () => clearInterval(id)
  }, [isOutput, host])

  // Live CC readout for effect modules — must be above the early return
  // because hooks must never be skipped between renders.
  const ccValues = useMidiStore((s) => s.ccValues)
  const isEff = module?.type === 'eff'
  const effCc = isEff ? (module?.params.cc ?? 0) : 0
  const effCcVal = effCc > 0 ? (ccValues[effCc] ?? 0) / 127 : 0

  // EARLY RETURN only after ALL hooks have been called.
  if (!module || !def) return null

  const clip = levelRef.current > CLIP_THRESHOLD

  return (
    <div className={'mod-node' + (bypassed ? ' bypassed' : '' + (isInput ? ' input' : '') + (isOutput ? ' output' : ''))}>
      <div className="mod-node-head">
        {isOutput && (
          <span
            className={'mod-clip-led' + (clip ? ' on' : '')}
            title={clip ? 'Clipping!' : 'Signal OK'}
          />
        )}
        {isEff ? (
          editingName ? (
            <input
              className="mod-name-input nodrag"
              defaultValue={module.name ?? ''}
              autoFocus
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => setEditingName(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  renameModule(instrumentId, moduleId, (e.target as HTMLInputElement).value)
                  setEditingName(false)
                }
                if (e.key === 'Escape') setEditingName(false)
              }}
            />
          ) : (
            <span
              className="mod-name nodrag"
              title="Double-click to rename"
              onDoubleClick={(e) => { e.stopPropagation(); setEditingName(true) }}
            >
              {module.name ?? def.label}
            </span>
          )
        ) : (
          <span>{def.label}</span>
        )}
        {hasBypass && (
          <button
            className={'mod-bypass-btn nodrag' + (bypassed ? ' off' : '')}
            title={bypassed ? 'Bypassed — click to engage' : 'Active — click to bypass'}
            onClick={(e) => {
              e.preventDefault()
              setModuleParam(instrumentId, moduleId, 'bypass', bypassed ? 0 : 1)
            }}
          >
            ⏻
          </button>
        )}
        <span className="mod-head-right">
          {isEff && (
            <span className="mod-eff-val" title={`CC ${effCc}: ${effCcVal.toFixed(2)} + tracker`}>
              {effCc > 0 ? effCcVal.toFixed(2) : '—'}
            </span>
          )}
          {!def.singleton && (
            <button className="mod-del nodrag" title="Delete module" onClick={() => removeModule(instrumentId, moduleId)}>
              ×
            </button>
          )}
        </span>
      </div>

      {def.inlets.map((port, i) => (
        <div
          className="mod-port in"
          key={`in-${port}`}
          style={{ top: handleTop(i) }}
          title={isStacked(port) ? `${port} — stacked input (multiple cords, each with its own gain)` : `${port} — hold ⌘/Ctrl while connecting to add a second cord`}
        >
          <Handle type="target" position={Position.Left} id={port} />
          <span className="mod-port-label">{port}</span>
          {isStacked(port) && <span className="mod-port-plus" title="Stacked input — each cord adds its own gain">+</span>}
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
          // Scale params are rendered inline alongside their parent param
          // (the one with showScale); skip them in the normal loop.
          if (p.key.endsWith('Scale')) return null

          // Width only shapes the Pulse waveform — hide it for other shapes so
          // the slider can't silently do nothing (square is hard-wired to 50%).
          if (p.key === 'pulseWidth') {
            const wfDef = def.params.find((d) => d.key === 'waveform')
            const pulseIdx = wfDef?.enumLabels?.indexOf('pulse') ?? -1
            const wf = module.params.waveform ?? wfDef?.default ?? 0
            if (Math.round(wf) !== pulseIdx) return null
          }

          const value = module.params[p.key] ?? p.default
          const over = paramOverrides?.get(p.key)
          const labels = over?.enumLabels ?? p.enumLabels
          const max = over?.max ?? p.max

          // Companion scale param (e.g. modDepthScale for modDepth).
          const scaleKey = p.showScale ? `${p.key}Scale` : null
          const scaleVal = scaleKey ? (module.params[scaleKey] ?? 1) : null

          const displayVal = scaleVal !== null ? value * scaleVal : value
          const isCcParam = p.key === 'cc' && module.type === 'eff'
          const isBypass = p.key === 'bypass'

          // Bypass is rendered as a header toggle, not a body slider.
          if (isBypass) return null

          return (
            <label className="mod-param" key={p.key}>
              <span className="mod-param-label">
                {p.label}
                <span className="mod-param-value">
                  {isCcParam ? (
                    <>
                      {value === 0 ? 'off' : `CC ${value}`}
                      {' '}
                      <button
                        className={`mod-scale-btn nodrag${ccLearning ? ' active' : ''}`}
                        title={ccLearning ? 'Listening for CC… click to cancel' : 'Learn CC — click then turn a knob'}
                        onClick={(e) => { e.preventDefault(); setCcLearning((v) => !v) }}
                      >
                        {ccLearning ? '…' : 'learn'}
                      </button>
                    </>
                  ) : labels ? (
                    labels[Math.round(value)] ?? '?'
                  ) : (
                    round(displayVal)
                  )}
                  {scaleVal !== null && (
                    <>{' '}
                      <button
                        className="mod-scale-btn nodrag"
                        title="Decrease scale · hold Shift for −10"
                        onClick={(e) => {
                          e.preventDefault()
                          const step = e.shiftKey ? 10 : 1
                          setModuleParam(instrumentId, moduleId, scaleKey!, Math.max(1, scaleVal - step))
                        }}
                      >
                        −
                      </button>
                      {' '}
                      <span className="mod-scale-val">{scaleVal}</span>
                      {' '}
                      <button
                        className="mod-scale-btn nodrag"
                        title="Increase scale · hold Shift for +10"
                        onClick={(e) => {
                          e.preventDefault()
                          const step = e.shiftKey ? 10 : 1
                          setModuleParam(instrumentId, moduleId, scaleKey!, Math.min(99, scaleVal + step))
                        }}
                      >
                        +
                      </button>
                    </>
                  )}
                </span>
              </span>
              {!isCcParam && (
                <input
                  className="nodrag"
                  type="range"
                  min={p.min}
                  max={max}
                  step={p.step}
                  value={value}
                  onChange={(e) => setModuleParamSilent(instrumentId, moduleId, p.key, Number(e.target.value))}
                />
              )}
            </label>
          )
        })}
        {isOutput && host && (
          <canvas ref={canvasRef} className="mod-scope" width={120} height={36} />
        )}
      </div>
    </div>
  )
}

/** Draw the host's current waveform onto a canvas (one frame, called from rAF). */
function drawScope(canvas: HTMLCanvasElement, host: AudioHost) {
  const buf = host.getWaveform()
  if (buf.length === 0) return
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== w * dpr) canvas.width = w * dpr
  if (canvas.height !== h * dpr) canvas.height = h * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.strokeStyle = SCOPE_COLOR
  ctx.lineWidth = 1
  ctx.beginPath()
  const mid = h / 2
  const n = buf.length
  for (let x = 0; x < w; x++) {
    const idx = Math.floor((x / w) * n)
    const y = mid + buf[idx] * mid * 0.85
    if (x === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

const nodeTypes = { module: ModuleNode }

function round(v: number): string {
  return Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(2).replace(/\.?0+$/, '')
}

function buildNodes(inst: ModularInstrument, host?: AudioHost): Node[] {
  return Object.values(inst.modules).map((m) => ({
    id: m.id,
    type: 'module',
    position: { ...m.pos },
    data: { instrumentId: inst.id, moduleId: m.id, host: m.type === 'output' ? host : undefined },
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

/** True when a keystroke should stay in a focused form field. Range sliders are
 *  excluded — they can't receive text, and we want shortcuts to work. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLInputElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT') return el.type !== 'range'
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}


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
    const prevSelected = new Set(getNodes().filter((n) => n.selected).map((n) => n.id))
    // Also auto-select nodes that were just pasted/cut (tracked via pendingSelectionRef).
    const pending = pendingSelectionRef.current
    pendingSelectionRef.current = []
    for (const id of pending) prevSelected.add(id)
    setNodes(
      buildNodes(inst, host).map((n) => ({
        ...n,
        selected: prevSelected.has(n.id) || undefined,
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
  const stackModRef = useRef(false)
  useEffect(() => {
    const update = (e: KeyboardEvent) => {
      stackModRef.current = e.metaKey || e.ctrlKey
    }
    const reset = () => {
      stackModRef.current = false
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
      <div className="mod-canvas" onDragOver={onDragOver} onDrop={onDrop}>
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
