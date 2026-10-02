import { MODULE_DEFS } from '../../domain/moduleDefs'
import type { ChannelEffect } from '../../domain/types'
import { BypassToggle } from '../components/BypassToggle'
import { Button } from '../components/Button'
import { cx } from '../components/cx'
import { ParamControl } from '../components/ParamControl'
import { SamplePicker } from '../components/SamplePicker'
import s from './EffectCard.module.css'

export function EffectCard({
  effect, onToggleBypass, onRemove, onParamSilent, onParamCommit, onSampleChange, onMoveUp, onMoveDown,
}: {
  effect: ChannelEffect
  onToggleBypass: (bypassed: boolean) => void; onRemove: () => void
  onParamSilent: (key: string, value: number) => void
  onParamCommit: (key: string, value: number) => void
  onSampleChange: (sampleId: string) => void
  onMoveUp?: () => void; onMoveDown?: () => void
}) {
  const def = MODULE_DEFS[effect.type]
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
        {def.samplePicker && (
          <SamplePicker className={s.param} moduleType={effect.type} label={def.samplePicker}
            sampleId={effect.sampleId} onChange={onSampleChange} />
        )}
        {def.params.filter((p) => p.key !== 'bypass').map((param) => (
          <ParamControl key={param.key} className={s.param} param={param}
            value={effect.params[param.key] ?? param.default}
            onChange={(v) => onParamSilent(param.key, v)}
            onCommit={(v) => onParamCommit(param.key, v)} />
        ))}
      </div>
    </div>
  )
}
