import { MASTER_CHANNEL_ID } from '../domain/types'
import type { Id, Instrument, MixChannel } from '../domain/types'
import { VerticalFader } from './VerticalFader'
import { PanSlider } from './PanSlider'

export function InstrumentStrip({
  inst, channels, gain, onVolumeSilent, onVolumeCommit, onPanSilent, onPanCommit,
  onRoute, onHide, onMoveUp, onMoveDown,
}: {
  inst: Instrument; channels: Record<Id, MixChannel>; gain: number
  onVolumeSilent: (v: number) => void; onVolumeCommit: (v: number) => void
  onPanSilent: (pan: number) => void; onPanCommit: (pan: number) => void
  onRoute: (channelId: Id) => void; onHide: () => void
  onMoveUp?: () => void; onMoveDown?: () => void
}) {
  const kindLabel = inst.kind === 'modular' ? 'SYN' : 'DK'
  const subChannels = Object.values(channels).filter((c) => c.kind === 'sub')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 72, padding: '4px 3px', border: '1px solid #444', borderRadius: 4, background: '#1a1a2e', flexShrink: 0, gap: 2, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
        {onMoveUp && <button className="octbtn" onClick={onMoveUp} style={{ padding: '0 2px', fontSize: 9, lineHeight: '12px' }}>◀</button>}
        {onMoveDown && <button className="octbtn" onClick={onMoveDown} style={{ padding: '0 2px', fontSize: 9, lineHeight: '12px' }}>▶</button>}
        <div style={{ flex: 1, fontSize: 9, fontWeight: 'bold', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inst.name}</div>
        <button className="octbtn" onClick={onHide} title="Hide from mixer" style={{ fontSize: 10, padding: '0 2px', lineHeight: '14px', position: 'absolute', top: 3, right: 3 }}>👁</button>
      </div>
      <div style={{ fontSize: 8, color: '#888' }}>{kindLabel}</div>
      <div style={{ flex: 1, minHeight: 4 }} />
      {/* Per-instrument metering deferred — needs Elementary snapshot support */}
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <button className="octbtn" style={{ fontSize: 9, padding: '1px 5px' }}>M</button>
        <button className="octbtn" style={{ fontSize: 9, padding: '1px 5px' }}>S</button>
      </div>
      <div style={{ fontSize: 8, color: '#aaa' }}>Pan</div>
      <PanSlider value={inst.pan ?? 0} onSilent={onPanSilent} onCommit={onPanCommit} />
      <VerticalFader value={gain} onDrag={onVolumeSilent} onCommit={onVolumeCommit} />
      <select value={inst.channelId ?? MASTER_CHANNEL_ID} onChange={(e) => onRoute(e.target.value)}
        className="mixer-dropdown" style={{ fontSize: 9, width: '100%', marginTop: 2 }}>
        <option value={MASTER_CHANNEL_ID}>Master</option>
        {subChannels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  )
}
