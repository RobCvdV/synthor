import { useDocStore } from '../state/docStore'
import { MODULE_DEFS } from '../domain/moduleDefs'
import type { ChannelEffect } from '../domain/types'

export function EffectCard({
  effect, channelId: _channelId, isFirst: _isFirst, isLast: _isLast,
  onToggleBypass, onRemove, onParamSilent, onParamCommit, onMoveUp, onMoveDown,
}: {
  effect: ChannelEffect; channelId: string; isFirst: boolean; isLast: boolean
  onToggleBypass: (bypassed: boolean) => void; onRemove: () => void
  onParamSilent: (key: string, value: number) => void
  onParamCommit: (key: string, value: number) => void
  onMoveUp?: () => void; onMoveDown?: () => void
}) {
  const def = MODULE_DEFS[effect.type]
  // Sample dropdown for conv (IR) effects — same name-sorted order the engine
  // uses when resolving sampleIndex → VFS hash. Hook stays above the early
  // return so the hook order is stable across renders.
  const sampleLabels = Object.values(useDocStore((s) => s.doc.entities.samples))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => s.name)
  if (!def) return null
  const bypassed = (effect.params.bypass ?? 0) === 1

  return (
    <div style={{ border: '1px solid #444', borderRadius: 4, padding: 6, background: bypassed ? '#1a1a24' : '#1e1e30', opacity: bypassed ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <button className={'mod-bypass-btn' + (bypassed ? ' off' : '')} style={{ position: 'static', transform: 'none' }}
          title={bypassed ? 'Bypassed — click to engage' : 'Active — click to bypass'}
          onClick={(e) => { e.preventDefault(); onToggleBypass(!bypassed) }}>⏻</button>
        <span style={{ fontSize: 11, fontWeight: 'bold', flex: 1 }}>{def.label}{effect.side ? ` ${effect.side}` : ''}</span>
        {onMoveUp && <button className="octbtn" onClick={onMoveUp} style={{ fontSize: 9, padding: '0 4px' }}>↑</button>}
        {onMoveDown && <button className="octbtn" onClick={onMoveDown} style={{ fontSize: 9, padding: '0 4px' }}>↓</button>}
        <button className="octbtn" onClick={onRemove} style={{ fontSize: 9, padding: '0 4px' }}>×</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {def.params.filter((p) => p.key !== 'bypass').map((param) => {
          const val = effect.params[param.key] ?? param.default
          return (
            <div key={param.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 70 }}>
              <label style={{ fontSize: 9, color: '#aaa' }}>{param.label}</label>
              {param.key === 'sampleIndex' ? (
                <select
                  value={Math.round(val)}
                  onChange={(e) => onParamCommit(param.key, parseInt(e.target.value))}
                  className="mixer-dropdown" style={{ fontSize: 10, width: '100%' }}>
                  {(sampleLabels.length ? sampleLabels : ['(none)']).map((lbl, i) => <option key={i} value={i}>{lbl}</option>)}
                </select>
              ) : param.enumLabels ? (
                <select value={Math.round(val)} onChange={(e) => onParamCommit(param.key, parseInt(e.target.value))}
                  className="mixer-dropdown" style={{ fontSize: 10, width: '100%' }}>
                  {param.enumLabels.map((lbl, i) => <option key={i} value={i}>{lbl}</option>)}
                </select>
              ) : (
                <input type="range" min={param.min} max={param.max} step={param.step} value={val}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => onParamSilent(param.key, parseFloat(e.target.value))}
                  onMouseUp={(e) => onParamCommit(param.key, parseFloat((e.target as HTMLInputElement).value))}
                  style={{ width: 60 }} />
              )}
              <span style={{ fontSize: 8, color: '#aaa' }}>{typeof val === 'number' ? (param.step >= 1 ? val.toFixed(0) : val.toFixed(2)) : ''}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
