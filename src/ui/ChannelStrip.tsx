import { useState } from 'react'
import { MODULE_DEFS } from '../domain/moduleDefs'
import type { MixChannel, ModuleType } from '../domain/types'
import { MeterCanvas } from './MeterCanvas'
import { VerticalFader } from './VerticalFader'
import { PanSlider } from './PanSlider'
import { AddEffectDropdown } from './AddEffectDropdown'

export function ChannelStrip({
  channel, isSelected, isMaster, showMeter, onSelect,
  onVolumeSilent, onVolumeCommit, onPanSilent, onPanCommit,
  onToggleMute, onToggleSolo, onRename, onDelete, onAddFx,
}: {
  channel: MixChannel; isSelected?: boolean; isMaster?: boolean; showMeter?: boolean
  onSelect: () => void; onVolumeSilent: (v: number) => void
  onVolumeCommit: (v: number) => void; onPanSilent: (pan: number) => void
  onPanCommit: (pan: number) => void; onToggleMute: () => void
  onToggleSolo: () => void; onRename: (name: string) => void
  onDelete?: () => void; onAddFx: (type: ModuleType) => void
}) {
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState(channel.name)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const borderColor = isSelected ? '#6af' : '#555'
  const bg = isMaster ? '#1a1a3e' : '#1a2e1a'

  return (
    <div onClick={onSelect} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 80, padding: '4px 4px', border: `2px solid ${borderColor}`, borderRadius: 4, background: isSelected ? (isMaster ? '#252550' : '#253525') : bg, flexShrink: 0, gap: 2, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
        {editing && !isMaster ? (
          <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => { setEditing(false); onRename(nameDraft) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setEditing(false); onRename(nameDraft) } }}
            style={{ width: '100%', fontSize: 10, textAlign: 'center' }} autoFocus />
        ) : (
          <div onDoubleClick={() => { if (!isMaster) { setNameDraft(channel.name); setEditing(true) } }}
            style={{ flex: 1, fontSize: 10, fontWeight: 'bold', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{channel.name}</div>
        )}
        {onDelete && !confirmDelete && (
          <button className="octbtn" onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
            title="Delete channel" style={{ fontSize: 10, padding: '0 3px', lineHeight: '14px', flexShrink: 0 }}>×</button>
        )}
        {confirmDelete && (
          <span style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
            <button className="octbtn" onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); onDelete!() }}
              style={{ fontSize: 8, padding: '0 3px', background: '#822' }}>OK?</button>
            <button className="octbtn" onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }}
              style={{ fontSize: 8, padding: '0 3px' }}>No</button>
          </span>
        )}
      </div>
      {isMaster && <div style={{ fontSize: 8, color: '#888' }}>MASTER</div>}
      {!isMaster && <div style={{ fontSize: 8, color: '#888' }}>SUB</div>}

      <div style={{ flex: 1, minHeight: 4 }} />

      {/* Effects */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto', maxHeight: 80, minHeight: 0 }}>
        {channel.effects.map((fx) => {
          const def = MODULE_DEFS[fx.type]
          const bypassed = (fx.params.bypass ?? 0) === 1
          const label = (def?.label ?? fx.type) + (fx.side ? ` ${fx.side}` : '')
          return <div key={fx.id} style={{ fontSize: 8, padding: '1px 3px', borderRadius: 2, background: bypassed ? 'rgba(255,255,255,0.05)' : 'rgba(72,136,170,0.25)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: bypassed ? 0.4 : 1 }}>{label}</div>
        })}
      </div>
      <AddEffectDropdown existingTypes={channel.effects.map((e) => e.type)} onAdd={onAddFx} />

      {/* Level meter — only on master (per-channel metering deferred) */}
      {showMeter && <MeterCanvas width={56} height={64} />}

      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <button className="octbtn" onClick={(e) => { e.stopPropagation(); onToggleMute() }}
          style={{ fontSize: 9, padding: '1px 5px', background: channel.mute ? '#c44' : undefined }}>M</button>
        <button className="octbtn" onClick={(e) => { e.stopPropagation(); onToggleSolo() }}
          style={{ fontSize: 9, padding: '1px 5px', background: channel.solo ? '#cc4' : undefined }}>S</button>
      </div>

      <div style={{ fontSize: 8, color: '#aaa' }}>Bal</div>
      <PanSlider value={channel.pan} onSilent={onPanSilent} onCommit={onPanCommit} />

      <VerticalFader value={channel.volume} onDrag={onVolumeSilent} onCommit={onVolumeCommit} />
    </div>
  )
}
