import { useEffect, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useDocStore } from '../state/docStore'
import { useMidiStore } from '../state/midiStore'
import { MODULE_DEFS } from '../domain/moduleDefs'
import type { AudioHost } from '../audio/host'
import type { Id } from '../domain/types'
import { CLIP_THRESHOLD, drawScope } from './scope'
import { round } from './format'
import { ParamControl } from './components/ParamControl'
import { SamplePicker } from './components/SamplePicker'
import { BypassToggle } from './components/BypassToggle'
import { EditableLabel } from './components/EditableLabel'

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
  const setModuleSample = useDocStore((s) => s.setModuleSample)
  const removeModule = useDocStore((s) => s.removeModule)
  const renameModule = useDocStore((s) => s.renameModule)
  const [ccLearning, setCcLearning] = useState(false)
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

  // --- oscilloscope / clip LED for the output node --------------------
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // State only flips on clip changes, so the node doesn't re-render per frame.
  const [clip, setClip] = useState(false)

  useEffect(() => {
    if (!isOutput || !host) return
    let raf = 0
    const tick = () => {
      const [lvlL, lvlR] = host.getLevels()
      setClip(lvlL > CLIP_THRESHOLD || lvlR > CLIP_THRESHOLD)
      const canvas = canvasRef.current
      if (canvas) drawScope(canvas, host)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isOutput, host])

  // Live CC readout for effect modules — scope to this node's CC number
  // so only the relevant node re-renders when a knob turns.
  const isEff = module?.type === 'eff'
  const effCc = isEff ? (module?.params.cc ?? 0) : 0
  const effCcVal = useMidiStore((s) => (effCc > 0 ? (s.ccValues[effCc] ?? 0) : 0)) / 127

  // EARLY RETURN only after ALL hooks have been called.
  if (!module || !def) return null


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
          <EditableLabel value={module.name ?? def.label} onCommit={(name) => renameModule(instrumentId, moduleId, name)}
            className="mod-name nodrag" inputClassName="mod-name-input nodrag" />
        ) : (
          <span>{def.label}</span>
        )}
        {hasBypass && (
          <BypassToggle className="mod-bypass-pos nodrag" bypassed={bypassed}
            onToggle={(b) => setModuleParam(instrumentId, moduleId, 'bypass', b ? 1 : 0)} />
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
        {def.samplePicker && (
          <SamplePicker className="mod-param nodrag" moduleType={module.type} label={def.samplePicker}
            sampleId={module.sampleId} onChange={(id) => setModuleSample(instrumentId, moduleId, id)} />
        )}
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

          // Bypass is rendered as a header toggle, not a body slider.
          if (p.key === 'bypass') return null

          const value = module.params[p.key] ?? p.default
          const isCcParam = p.key === 'cc' && module.type === 'eff'
          // Companion scale param (e.g. modDepthScale for modDepth).
          const scaleKey = p.showScale ? `${p.key}Scale` : null
          const scaleVal = scaleKey ? (module.params[scaleKey] ?? 1) : null
          const setScale = (e: React.MouseEvent, delta: number) => {
            e.preventDefault()
            const step = e.shiftKey ? 10 : 1
            setModuleParam(instrumentId, moduleId, scaleKey!, Math.max(1, Math.min(99, scaleVal! + delta * step)))
          }

          const readout = isCcParam ? (
            <>
              {value === 0 ? 'off' : `CC ${value}`}{' '}
              <button
                className={`mod-scale-btn nodrag${ccLearning ? ' active' : ''}`}
                title={ccLearning ? 'Listening for CC… click to cancel' : 'Learn CC — click then turn a knob'}
                onClick={(e) => { e.preventDefault(); setCcLearning((v) => !v) }}
              >
                {ccLearning ? '…' : 'learn'}
              </button>
            </>
          ) : scaleVal !== null ? (
            <>
              {round(value * scaleVal)}{' '}
              <button className="mod-scale-btn nodrag" title="Decrease scale · hold Shift for −10"
                onClick={(e) => setScale(e, -1)}>−</button>{' '}
              <span className="mod-scale-val">{scaleVal}</span>{' '}
              <button className="mod-scale-btn nodrag" title="Increase scale · hold Shift for +10"
                onClick={(e) => setScale(e, 1)}>+</button>
            </>
          ) : undefined

          return (
            <ParamControl key={p.key} className="mod-param nodrag" param={p} value={value}
              readout={readout} readOnly={isCcParam}
              onChange={(v) => (p.structural ? setModuleParam : setModuleParamSilent)(instrumentId, moduleId, p.key, v)} />
          )
        })}
        {isOutput && host && (
          <canvas ref={canvasRef} className="mod-scope" width={120} height={36} />
        )}
      </div>
    </div>
  )
}
