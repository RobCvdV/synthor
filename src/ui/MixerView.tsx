import { useEffect, useRef, useState } from 'react'
import { useDocStore } from '../state/docStore'
import type { AudioHost } from '../audio/host'
import type { Id, Instrument, MixChannel, ChannelEffect, ModuleType } from '../domain/types'
import { MASTER_CHANNEL_ID } from '../domain/types'
import { EFFECT_MODULE_TYPES, MODULE_DEFS } from '../domain/moduleDefs'

// ── MixerView ────────────────────────────────────────────────

interface MixerViewProps {
  host: AudioHost
}

export function MixerView({ host }: MixerViewProps) {
  const doc = useDocStore((s) => s.doc)
  const store = () => useDocStore.getState()

  const [selectedChannel, setSelectedChannel] = useState<Id>(MASTER_CHANNEL_ID)
  const [levels, setLevels] = useState<Record<Id, { left: number; right: number }>>({})

  const orders = doc.entities.mixerInstrumentOrder
  const instruments = doc.entities.instruments
  const channels = doc.entities.mixChannels
  const subChannels = Object.values(channels).filter((c) => c.kind === 'sub')
  const master = channels[MASTER_CHANNEL_ID]
  const selectedChan = channels[selectedChannel]

  // ── Level metering ───────────────────────────────────────
  const rafRef = useRef(0)
  useEffect(() => {
    const tick = () => {
      const lvl = host.getLevel()
      // Use master level for all channels (per-channel metering needs Elementary snapshot support — deferred).
      const entry = { left: lvl, right: lvl * 0.95 }
      const next: Record<Id, { left: number; right: number }> = { master: entry }
      for (const instId of orders) next[instId] = entry
      for (const ch of Object.values(channels)) next[ch.id] = entry
      setLevels(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(rafRef.current)
  }, [host, orders, channels])

  // ── Hidden instruments ───────────────────────────────────
  const hiddenInstruments = Object.values(instruments).filter(
    (inst) => !orders.includes(inst.id),
  )

  // ── Helpers ──────────────────────────────────────────────
  const getInstGain = (inst: Instrument): number => {
    if (inst.kind === 'osc') return inst.params.gain
    if (inst.kind === 'drumkit') return inst.params.gain
    return inst.modules[inst.outputId]?.params.gain ?? 1
  }

  // ── Render ───────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Channel strips area */}
      <div style={{ flex: 1, display: 'flex', overflowX: 'auto', overflowY: 'hidden', padding: '8px 8px 4px', gap: 4, minHeight: 0, alignItems: 'stretch' }}>
        {/* Instrument strips */}
        {orders.map((instId, idx) => {
          const inst = instruments[instId]
          if (!inst) return null
          return (
            <InstrumentStrip
              key={instId}
              inst={inst}
              channels={channels}
              gain={getInstGain(inst)}
              level={levels[instId]}
              isLast={idx === orders.length - 1}
              onVolumeDrag={(v) => {
                const vol = Math.max(0, Math.min(2, v))
                if (inst.kind === 'osc') store().setOscParamFast(inst.id, 'gain', vol)
                else if (inst.kind === 'drumkit') store().setDrumKitParamFast(inst.id, 'gain', vol)
              }}
              onVolumeCommit={(v) => {
                const vol = Math.max(0, Math.min(2, v))
                if (inst.kind === 'osc') store().setOscParam(inst.id, 'gain', vol)
                else if (inst.kind === 'drumkit') store().setDrumKitParam(inst.id, 'gain', vol)
              }}
              onPanDrag={(pan) => store().setInstrumentPanFast(inst.id, Math.max(-1, Math.min(1, pan)))}
              onPanCommit={(pan) => store().setInstrumentPan(inst.id, Math.max(-1, Math.min(1, pan)))}
              onRoute={(cid) => store().setInstrumentChannelId(inst.id, cid)}
              onHide={() => store().hideInstrumentFromMixer(inst.id)}
              onMoveUp={idx > 0 ? () => store().reorderMixerInstrument(inst.id, idx - 1) : undefined}
              onMoveDown={idx < orders.length - 1 ? () => store().reorderMixerInstrument(inst.id, idx + 1) : undefined}
            />
          )
        })}

        {/* Hidden instruments dropdown */}
        {hiddenInstruments.length > 0 && (
          <div style={{ alignSelf: 'flex-start', marginLeft: 4, flexShrink: 0 }}>
            <select
              value=""
              onChange={(e) => { if (e.target.value) store().showInstrumentInMixer(e.target.value) }}
              className="mixer-dropdown"
            >
              <option value="">Hidden ({hiddenInstruments.length})</option>
              {hiddenInstruments.map((inst) => (
                <option key={inst.id} value={inst.id}>{inst.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Sub-channel strips */}
        {subChannels.map((chan) => (
          <ChannelStrip
            key={chan.id}
            channel={chan}
            isSelected={selectedChannel === chan.id}
            level={levels[chan.id]}
            onSelect={() => setSelectedChannel(chan.id)}
            onVolumeDrag={(v) => store().setChannelVolumeFast(chan.id, Math.max(0, Math.min(2, v)))}
            onVolumeCommit={(v) => store().setChannelVolume(chan.id, Math.max(0, Math.min(2, v)))}
            onPanDrag={(pan) => store().setChannelPan(chan.id, Math.max(-1, Math.min(1, pan)))}
            onPanCommit={(pan) => store().setChannelPan(chan.id, Math.max(-1, Math.min(1, pan)))}
            onToggleMute={() => store().setChannelMute(chan.id, !chan.mute)}
            onToggleSolo={() => store().setChannelSolo(chan.id, !chan.solo)}
            onRename={(name) => store().renameChannel(chan.id, name)}
            onDelete={() => {
              if (selectedChannel === chan.id) setSelectedChannel(MASTER_CHANNEL_ID)
              store().removeChannel(chan.id)
            }}
            onAddFx={(type) => store().addChannelEffect(chan.id, type)}
          />
        ))}

        {/* Add sub button */}
        <button className="octbtn" onClick={() => {
          const id = store().addChannel('sub')
          setSelectedChannel(id)
        }} title="Add sub channel" style={{ alignSelf: 'flex-start', height: 'fit-content', flexShrink: 0 }}>
          + Sub
        </button>

        {/* Master strip */}
        {master && (
          <ChannelStrip
            channel={master}
            isSelected={selectedChannel === MASTER_CHANNEL_ID}
            isMaster
            level={levels.master}
            onSelect={() => setSelectedChannel(MASTER_CHANNEL_ID)}
            onVolumeDrag={(v) => store().setChannelVolumeFast(MASTER_CHANNEL_ID, Math.max(0, Math.min(2, v)))}
            onVolumeCommit={(v) => store().setChannelVolume(MASTER_CHANNEL_ID, Math.max(0, Math.min(2, v)))}
            onPanDrag={(pan) => store().setChannelPan(MASTER_CHANNEL_ID, Math.max(-1, Math.min(1, pan)))}
            onPanCommit={(pan) => store().setChannelPan(MASTER_CHANNEL_ID, Math.max(-1, Math.min(1, pan)))}
            onToggleMute={() => store().setChannelMute(MASTER_CHANNEL_ID, !master.mute)}
            onToggleSolo={() => store().setChannelSolo(MASTER_CHANNEL_ID, !master.solo)}
            onRename={() => {}}
            onAddFx={(type) => store().addChannelEffect(MASTER_CHANNEL_ID, type)}
          />
        )}
      </div>

      {/* ── Effect editor sidebar ─────────────────────────── */}
      {selectedChan && (
        <div style={{
          width: 280, flexShrink: 0, borderLeft: '2px solid #555',
          background: '#12121f', overflowY: 'auto', padding: '8px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 4 }}>
            {selectedChan.name}
            <span style={{ fontSize: 10, color: '#888', marginLeft: 8 }}>
              {selectedChan.kind === 'master' ? 'Master Channel' : 'Sub Channel'}
            </span>
          </div>
          {selectedChan.effects.length === 0 && (
            <div style={{ fontSize: 11, color: '#666', fontStyle: 'italic' }}>No effects on this channel</div>
          )}
          {selectedChan.effects.map((fx, idx) => (
            <EffectCard
              key={fx.id}
              effect={fx}
              channelId={selectedChan.id}
              isFirst={idx === 0}
              isLast={idx === selectedChan.effects.length - 1}
              onToggleBypass={(bypassed) =>
                store().setChannelEffectParam(selectedChan.id, fx.id, 'bypass', bypassed ? 1 : 0)
              }
              onRemove={() => store().removeChannelEffect(selectedChan.id, fx.id)}
              onParam={(key, value) => store().setChannelEffectParamFast(selectedChan.id, fx.id, key, value)}
              onParamCommit={(key, value) => store().setChannelEffectParam(selectedChan.id, fx.id, key, value)}
              onMoveUp={idx > 0 ? () => store().moveChannelEffect(selectedChan.id, fx.id, idx - 1) : undefined}
              onMoveDown={idx < selectedChan.effects.length - 1 ? () => store().moveChannelEffect(selectedChan.id, fx.id, idx + 1) : undefined}
            />
          ))}
          <AddEffectDropdown
            existingTypes={selectedChan.effects.map((e) => e.type)}
            onAdd={(type) => store().addChannelEffect(selectedChan.id, type)}
          />
        </div>
      )}
    </div>
  )
}

// ── Instrument Strip ──────────────────────────────────────

function InstrumentStrip({
  inst, channels, gain, level, isLast: _isLast,
  onVolumeDrag, onVolumeCommit, onPanDrag, onPanCommit,
  onRoute, onHide, onMoveUp, onMoveDown,
}: {
  inst: Instrument; channels: Record<Id, MixChannel>; gain: number
  level?: { left: number; right: number }; isLast: boolean
  onVolumeDrag: (v: number) => void; onVolumeCommit: (v: number) => void
  onPanDrag: (pan: number) => void; onPanCommit: (pan: number) => void
  onRoute: (channelId: Id) => void; onHide: () => void
  onMoveUp?: () => void; onMoveDown?: () => void
}) {
  const kindLabel = inst.kind === 'osc' ? 'OSC' : inst.kind === 'modular' ? 'MOD' : 'DK'
  const subChannels = Object.values(channels).filter((c) => c.kind === 'sub')

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      width: 72, padding: '4px 3px', border: '1px solid #444',
      borderRadius: 4, background: '#1a1a2e', flexShrink: 0, gap: 2,
      position: 'relative',
    }}>
      {/* 1. Title + hide */}
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
        {onMoveUp && <button className="octbtn" onClick={onMoveUp} style={{ padding: '0 2px', fontSize: 9, lineHeight: '12px' }}>◀</button>}
        {onMoveDown && <button className="octbtn" onClick={onMoveDown} style={{ padding: '0 2px', fontSize: 9, lineHeight: '12px' }}>▶</button>}
        <div style={{ flex: 1, fontSize: 9, fontWeight: 'bold', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {inst.name}
        </div>
        <button className="octbtn" onClick={onHide} title="Hide from mixer"
          style={{ fontSize: 10, padding: '0 2px', lineHeight: '14px', position: 'absolute', top: 3, right: 3 }}>👁</button>
      </div>
      {/* 2. Subtitle */}
      <div style={{ fontSize: 8, color: '#888' }}>{kindLabel}</div>

      {/* spacer */}
      <div style={{ flex: 1, minHeight: 4 }} />

      {/* 4. Vertical signal levels */}
      <StereoLevelMeter level={level} />

      {/* 5. Mute + Solo */}
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <button className="octbtn" style={{ fontSize: 9, padding: '1px 5px' }}>M</button>
        <button className="octbtn" style={{ fontSize: 9, padding: '1px 5px' }}>S</button>
      </div>

      {/* 6. Pan */}
      <div style={{ fontSize: 8, color: '#aaa' }}>Pan</div>
      <input type="range" min={-1} max={1} step={0.01} value={inst.pan ?? 0}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onPanDrag(parseFloat(e.target.value))}
        onMouseUp={(e) => onPanCommit(parseFloat((e.target as HTMLInputElement).value))}
        style={{ width: '100%', height: 14 }} />

      {/* 7. Volume fader */}
      <VerticalFader value={gain} onDrag={onVolumeDrag} onCommit={onVolumeCommit} />

      {/* 8. Channel director dropdown */}
      <select value={inst.channelId ?? MASTER_CHANNEL_ID}
        onChange={(e) => onRoute(e.target.value)}
        className="mixer-dropdown" style={{ fontSize: 9, width: '100%', marginTop: 2 }}>
        <option value={MASTER_CHANNEL_ID}>Master</option>
        {subChannels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  )
}

// ── Channel Strip (sub + master) ───────────────────────────

function ChannelStrip({
  channel, isSelected, isMaster, level, onSelect,
  onVolumeDrag, onVolumeCommit, onPanDrag, onPanCommit,
  onToggleMute, onToggleSolo, onRename, onDelete, onAddFx,
}: {
  channel: MixChannel; isSelected?: boolean; isMaster?: boolean
  level?: { left: number; right: number }
  onSelect: () => void; onVolumeDrag: (v: number) => void
  onVolumeCommit: (v: number) => void; onPanDrag: (pan: number) => void
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
    <div onClick={onSelect} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      width: 80, padding: '4px 4px', border: `2px solid ${borderColor}`,
      borderRadius: 4, background: isSelected ? (isMaster ? '#252550' : '#253525') : bg,
      flexShrink: 0, gap: 2, cursor: 'pointer',
    }}>
      {/* 1. Title + close */}
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
        {editing && !isMaster ? (
          <input value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => { setEditing(false); onRename(nameDraft) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setEditing(false); onRename(nameDraft) } }}
            style={{ width: '100%', fontSize: 10, textAlign: 'center' }} autoFocus />
        ) : (
          <div onDoubleClick={() => { if (!isMaster) { setNameDraft(channel.name); setEditing(true) } }}
            style={{ flex: 1, fontSize: 10, fontWeight: 'bold', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {channel.name}
          </div>
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

      {/* spacer */}
      <div style={{ flex: 1, minHeight: 4 }} />

      {/* 3. Effects — pill list */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto', maxHeight: 80, minHeight: 0 }}>
        {channel.effects.map((fx) => {
          const def = MODULE_DEFS[fx.type]
          const bypassed = (fx.params.bypass ?? 0) === 1
          return (
            <div key={fx.id} style={{
              fontSize: 8, padding: '1px 3px', borderRadius: 2,
              background: bypassed ? 'rgba(255,255,255,0.05)' : 'rgba(72,136,170,0.25)',
              textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              opacity: bypassed ? 0.4 : 1,
            }}>{def?.label ?? fx.type}</div>
          )
        })}
      </div>

      {/* Add effect dropdown */}
      <AddEffectDropdown existingTypes={channel.effects.map((e) => e.type)} onAdd={onAddFx} />

      {/* 4. Vertical signal levels */}
      <StereoLevelMeter level={level} />

      {/* 5. Mute + Solo */}
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <button className="octbtn" onClick={(e) => { e.stopPropagation(); onToggleMute() }}
          style={{ fontSize: 9, padding: '1px 5px', background: channel.mute ? '#c44' : undefined }}>M</button>
        <button className="octbtn" onClick={(e) => { e.stopPropagation(); onToggleSolo() }}
          style={{ fontSize: 9, padding: '1px 5px', background: channel.solo ? '#cc4' : undefined }}>S</button>
      </div>

      {/* 6. Balance */}
      <div style={{ fontSize: 8, color: '#aaa' }}>Bal</div>
      <input type="range" min={-1} max={1} step={0.01} value={channel.pan}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onPanDrag(parseFloat(e.target.value))}
        onMouseUp={(e) => onPanCommit(parseFloat((e.target as HTMLInputElement).value))}
        style={{ width: '100%', height: 14 }} />

      {/* 7. Volume fader */}
      <VerticalFader value={channel.volume} onDrag={onVolumeDrag} onCommit={onVolumeCommit} />
    </div>
  )
}

// ── Effect Card ────────────────────────────────────────────

function EffectCard({
  effect, channelId: _channelId,
  isFirst: _isFirst, isLast: _isLast,
  onToggleBypass, onRemove, onParam, onParamCommit,
  onMoveUp, onMoveDown,
}: {
  effect: ChannelEffect; channelId: string
  isFirst: boolean; isLast: boolean
  onToggleBypass: (bypassed: boolean) => void; onRemove: () => void
  onParam: (key: string, value: number) => void
  onParamCommit: (key: string, value: number) => void
  onMoveUp?: () => void; onMoveDown?: () => void
}) {
  const def = MODULE_DEFS[effect.type]
  if (!def) return null
  const bypassed = (effect.params.bypass ?? 0) === 1

  return (
    <div style={{ border: '1px solid #444', borderRadius: 4, padding: 6, background: bypassed ? '#1a1a24' : '#1e1e30', opacity: bypassed ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <button
          className={'mod-bypass-btn' + (bypassed ? ' off' : '')}
          style={{ position: 'static', transform: 'none' }}
          title={bypassed ? 'Bypassed — click to engage' : 'Active — click to bypass'}
          onClick={(e) => { e.preventDefault(); onToggleBypass(!bypassed) }}>⏻</button>
        <span style={{ fontSize: 11, fontWeight: 'bold', flex: 1 }}>{def.label}</span>
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
              {param.enumLabels ? (
                <select value={Math.round(val)}
                  onChange={(e) => onParamCommit(param.key, parseInt(e.target.value))}
                  className="mixer-dropdown" style={{ fontSize: 10, width: '100%' }}>
                  {param.enumLabels.map((lbl, i) => <option key={i} value={i}>{lbl}</option>)}
                </select>
              ) : (
                <input type="range" min={param.min} max={param.max} step={param.step} value={val}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => onParam(param.key, parseFloat(e.target.value))}
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

// ── Add Effect Dropdown ────────────────────────────────────

function AddEffectDropdown({ existingTypes, onAdd }: { existingTypes: ModuleType[]; onAdd: (type: ModuleType) => void }) {
  const available = EFFECT_MODULE_TYPES.filter((t) => !existingTypes.includes(t))
  if (available.length === 0) return null
  return (
    <select value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value as ModuleType) }}
      className="mixer-dropdown" style={{ fontSize: 9, width: '100%' }}>
      <option value="">+ Add effect</option>
      {available.map((type) => <option key={type} value={type}>{MODULE_DEFS[type].label}</option>)}
    </select>
  )
}

// ── Stereo Level Meter (vertical) ──────────────────────────

function StereoLevelMeter({ level }: { level?: { left: number; right: number } }) {
  const l = level?.left ?? 0
  const r = level?.right ?? 0
  const clipL = l > 0.95
  const clipR = r > 0.95

  const barGradient = (val: number): string => {
    const pct = Math.min(100, val * 100)
    if (pct > 80) return '#e44'
    if (pct > 60) return '#ea4'
    if (pct > 40) return '#cc4'
    return '#4c4'
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%', marginTop: 2 }}>
      {/* Clip dots */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, width: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: clipR ? '#f00' : '#300', boxShadow: clipR ? '0 0 4px #f00' : undefined }} />
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: clipL ? '#f00' : '#300', boxShadow: clipL ? '0 0 4px #f00' : undefined }} />
      </div>
      {/* Vertical level bars */}
      <div style={{ display: 'flex', gap: 2, height: 60, width: '100%', background: '#111', borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
        {/* R bar (right) */}
        <div style={{ width: '50%', height: '100%', position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ width: '100%', height: `${Math.min(100, r * 100)}%`, background: barGradient(r), borderRadius: '1px 1px 0 0', transition: 'height 80ms linear' }} />
          <div style={{ position: 'absolute', top: 0, width: '100%', textAlign: 'center', fontSize: 6, color: '#666' }}>R</div>
        </div>
        {/* L bar (left) */}
        <div style={{ width: '50%', height: '100%', position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ width: '100%', height: `${Math.min(100, l * 100)}%`, background: barGradient(l), borderRadius: '1px 1px 0 0', transition: 'height 80ms linear' }} />
          <div style={{ position: 'absolute', top: 0, width: '100%', textAlign: 'center', fontSize: 6, color: '#666' }}>L</div>
        </div>
      </div>
    </div>
  )
}

// ── Vertical Fader ─────────────────────────────────────────

function VerticalFader({ value, onDrag, onCommit }: { value: number; onDrag: (v: number) => void; onCommit: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minHeight: 80, justifyContent: 'flex-end' }}>
      <input type="range" min={0} max={2} step={0.01} value={value}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onDrag(parseFloat(e.target.value))}
        onMouseUp={(e) => onCommit(parseFloat((e.target as HTMLInputElement).value))}
        style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 100, width: 24 }} />
      <div style={{ fontSize: 8, color: '#aaa' }}>{(value * 100).toFixed(0)}%</div>
    </div>
  )
}
