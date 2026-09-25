import { MODULE_DEFS } from '../../domain/moduleDefs'
import type { ChannelEffect } from '../../domain/types'
import { BypassToggle } from '../components/BypassToggle'
import { Button } from '../components/Button'
import { cx } from '../components/cx'
import { ParamSlider } from '../components/ParamSlider'
import { Select } from '../components/Select'
import { useSortedSamples } from '../hooks/useSortedSamples'
import s from './EffectCard.module.css'

export function EffectCard({
  effect, onToggleBypass, onRemove, onParamSilent, onParamCommit, onMoveUp, onMoveDown,
}: {
  effect: ChannelEffect
  onToggleBypass: (bypassed: boolean) => void; onRemove: () => void
  onParamSilent: (key: string, value: number) => void
  onParamCommit: (key: string, value: number) => void
  onMoveUp?: () => void; onMoveDown?: () => void
}) {
  const def = MODULE_DEFS[effect.type]
  const sampleLabels = useSortedSamples().map((smp) => smp.name)
  if (!def) return null
  const bypassed = (effect.params.bypass ?? 0) === 1

  return (
    <div className={cx(s.card, bypassed && s.bypassed)}>
      <div className={s.head}>
        <BypassToggle bypassed={bypassed} onToggle={onToggleBypass} />
        <span className={s.title}>{def.label}{effect.side ? ` ${effect.side}` : ''}</span>
        {onMoveUp && <Button size="xs" title="Move up" onClick={onMoveUp}>↑</Button>}
        {onMoveDown && <Button size="xs" title="Move down" onClick={onMoveDown}>↓</Button>}
        <Button size="xs" title="Remove effect" onClick={onRemove}>×</Button>
      </div>
      <div className={s.params}>
        {def.params.filter((p) => p.key !== 'bypass').map((param) => {
          const val = effect.params[param.key] ?? param.default
          const labels = param.key === 'sampleIndex'
            ? (sampleLabels.length ? sampleLabels : ['(none)'])
            : param.enumLabels
          return (
            <label key={param.key} className={s.param}>
              <span className={s.paramLabel}>{param.label}</span>
              {labels ? (
                <Select block value={Math.round(val)} onChange={(e) => onParamCommit(param.key, parseInt(e.target.value))}>
                  {labels.map((lbl, i) => <option key={i} value={i}>{lbl}</option>)}
                </Select>
              ) : (
                <ParamSlider value={val} min={param.min} max={param.max} step={param.step}
                  onChange={(v) => onParamSilent(param.key, v)}
                  onCommit={(v) => onParamCommit(param.key, v)}
                  formatValue={(v) => param.step >= 1 ? v.toFixed(0) : v.toFixed(2)} />
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}
