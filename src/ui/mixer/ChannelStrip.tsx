import { MODULE_DEFS } from '../../domain/moduleDefs'
import type { MixChannel, ModuleType } from '../../domain/types'
import { Button } from '../components/Button'
import { cx } from '../components/cx'
import { MeterCanvas } from './MeterCanvas'
import { AddEffectDropdown } from './AddEffectDropdown'
import { MixerStrip } from './MixerStrip'
import s from './ChannelStrip.module.css'

export function ChannelStrip({
  channel, selected, showMeter, onSelect,
  onVolumeSilent, onVolumeCommit, onPanSilent, onPanCommit,
  onToggleMute, onToggleSolo, onRename, onDelete, onAddFx,
}: {
  channel: MixChannel; selected?: boolean; showMeter?: boolean
  onSelect: () => void
  onVolumeSilent: (v: number) => void; onVolumeCommit: (v: number) => void
  onPanSilent: (pan: number) => void; onPanCommit: (pan: number) => void
  onToggleMute: () => void; onToggleSolo: () => void
  onRename?: (name: string) => void
  onDelete?: () => void
  onAddFx: (type: ModuleType) => void
}) {
  const isMaster = channel.kind === 'master'
  return (
    <MixerStrip
      variant={channel.kind} kindLabel={isMaster ? 'MASTER' : 'SUB'}
      name={channel.name} onRename={onRename}
      actionsEnd={onDelete && (
        <Button size="xs" title="Delete channel" onClick={(e) => { e.stopPropagation(); onDelete() }}>×</Button>
      )}
      selected={selected} onSelect={onSelect}
      mute={channel.mute} solo={channel.solo} onToggleMute={onToggleMute} onToggleSolo={onToggleSolo}
      panLabel="Bal" pan={channel.pan} onPanSilent={onPanSilent} onPanCommit={onPanCommit}
      volume={channel.volume} onVolumeSilent={onVolumeSilent} onVolumeCommit={onVolumeCommit}
    >
      <div className={s.effects}>
        {channel.effects.map((fx) => {
          const label = (MODULE_DEFS[fx.type]?.label ?? fx.type) + (fx.side ? ` ${fx.side}` : '')
          const bypassed = (fx.params.bypass ?? 0) === 1
          return <div key={fx.id} className={cx(s.effect, bypassed && s.bypassed)}>{label}</div>
        })}
      </div>
      <AddEffectDropdown existingTypes={channel.effects.map((e) => e.type)} onAdd={onAddFx} />
      {showMeter && <MeterCanvas width={56} height={64} />}
    </MixerStrip>
  )
}
