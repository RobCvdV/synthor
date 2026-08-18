import { useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useDocStore } from '../state/docStore'
import { useMidiStore } from '../state/midiStore'
import { MODULE_DEFS, WAVEFORM_MAX_LENGTH_SECONDS } from '../domain/moduleDefs'
import type { AudioHost } from '../audio/host'
import type { Id } from '../domain/types'
import { CLIP_THRESHOLD, drawScope } from './scope'
import { round } from './format'

export interface ModuleNodeData {
  instrumentId: Id
  moduleId: Id
  host?: AudioHost
  [key: string]: unknown
}

/** Vertical offset (px) for the i-th handle on a node side. */
const handleTop = (i: number) => 44 + i * 24

/** One module rendered as a React Flow node. Reads its params live from the
 *  store so slider edits never need a node rebuild. For the output module a
 *  clip LED and small waveform oscilloscope are rendered when an audio host
 *  is available. */
export function ModuleNode({ data }: NodeProps) {
  const { instrumentId, moduleId, host } = data as ModuleNodeData
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
          title={`${port} — hold ⌘/Ctrl while connecting to add a second cord`}
        >
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
