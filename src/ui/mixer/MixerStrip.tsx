import type { ReactNode } from 'react'
import { Button } from '../components/Button'
import { cx } from '../components/cx'
import { EditableLabel } from '../components/EditableLabel'
import { ParamSlider } from '../components/ParamSlider'
import s from './MixerStrip.module.css'

export interface MixerStripProps {
  variant: 'instrument' | 'sub' | 'master'
  kindLabel: string
  name: string
  /** Makes the name renamable by double-click. */
  onRename?: (name: string) => void
  /** Buttons at the start and end of the top row. */
  actions?: ReactNode
  actionsEnd?: ReactNode
  selected?: boolean
  onSelect?: () => void
  /** Content between the spacer and the controls (effects, meter). */
  children?: ReactNode
  mute: boolean
  solo: boolean
  /** Without handlers the M/S buttons render disabled. */
  onToggleMute?: () => void
  onToggleSolo?: () => void
  panLabel: string
  pan: number
  onPanSilent: (pan: number) => void
  onPanCommit: (pan: number) => void
  volume: number
  onVolumeSilent: (v: number) => void
  onVolumeCommit: (v: number) => void
  footer?: ReactNode
}

/** Layout shared by all mixer strips; the fixed bottom stack keeps their controls aligned. */
export function MixerStrip({
  variant, kindLabel, name, onRename, actions, actionsEnd, selected, onSelect, children,
  mute, solo, onToggleMute, onToggleSolo,
  panLabel, pan, onPanSilent, onPanCommit, volume, onVolumeSilent, onVolumeCommit, footer,
}: MixerStripProps) {
  const unavailable = 'Not available for instruments yet'
  return (
    <div className={cx(s.strip, s[variant], onSelect && s.selectable, selected && s.selected)} onClick={onSelect}>
      <div className={s.actions}>
        {actions}
        {actionsEnd && <span className={s.actionsEnd}>{actionsEnd}</span>}
      </div>
      <div className={s.kind}>{kindLabel}</div>
      {onRename
        ? <EditableLabel value={name} onCommit={onRename} commitOnBlur className={s.name} inputClassName={s.nameInput} />
        : <div className={s.name}>{name}</div>}
      <div className={s.spacer} />
      {children}
      <div className={s.muteSolo}>
        <Button size="sm" tone="danger" active={mute} disabled={!onToggleMute}
          title={onToggleMute ? 'Mute' : unavailable}
          onClick={(e) => { e.stopPropagation(); onToggleMute?.() }}>M</Button>
        <Button size="sm" tone="warn" active={solo} disabled={!onToggleSolo}
          title={onToggleSolo ? 'Solo' : unavailable}
          onClick={(e) => { e.stopPropagation(); onToggleSolo?.() }}>S</Button>
      </div>
      <div className={s.label}>{panLabel}</div>
      <ParamSlider className={s.pan} value={pan} min={-1} max={1} step={0.01}
        onChange={onPanSilent} onCommit={onPanCommit} />
      <ParamSlider className={s.fader} value={volume} min={0} max={2} step={0.01} orientation="vertical"
        onChange={onVolumeSilent} onCommit={onVolumeCommit} formatValue={(v) => `${(v * 100).toFixed(0)}%`} />
      <div className={s.footer}>{footer}</div>
    </div>
  )
}
