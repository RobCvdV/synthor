import { MODULE_DEFS } from '../domain/moduleDefs'
import type { ChannelEffect } from '../domain/types'
import { ParamSlider } from './components/ParamSlider'
import { useSortedSamples } from './hooks/useSortedSamples'

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
  const sampleLabels = useSortedSamples().map((s) => s.name)
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
                <ParamSlider value={val} min={param.min} max={param.max} step={param.step}
                  onChange={(v) => onParamSilent(param.key, v)}
                  onCommit={(v) => onParamCommit(param.key, v)}
                  formatValue={(v) => param.step >= 1 ? v.toFixed(0) : v.toFixed(2)} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}