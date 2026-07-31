import { useCallback, useState } from 'react'
import { useDocStore } from '../state/docStore'
import type { AudioHost } from '../audio/host'
import type { Id, Instrument, MixChannel, ChannelEffect, ModuleType } from '../domain/types'
import { MASTER_CHANNEL_ID } from '../domain/types'
import { EFFECT_MODULE_TYPES, MODULE_DEFS } from '../domain/moduleDefs'

// ── MixerView: mixer with instrument strips, sub channels, master channel ──

interface MixerViewProps {
  host: AudioHost
}

export function MixerView({ host: _host }: MixerViewProps) {
  const doc = useDocStore((s) => s.doc)
  const {
    setChannelVolume, setChannelVolumeFast, setChannelPan, setChannelMute,
    setChannelSolo, addChannel, removeChannel, renameChannel,
    addChannelEffect, removeChannelEffect, moveChannelEffect,
    setChannelEffectParam, setChannelEffectParamFast,
    hideInstrumentFromMixer, showInstrumentInMixer, reorderMixerInstrument,
    setInstrumentChannelId, setInstrumentPan, setInstrumentPanFast,
    setOscParam, setOscParamFast,
    setDrumKitParam, setDrumKitParamFast,
  } = useDocStore((s) => ({
    setChannelVolume: s.setChannelVolume,
    setChannelVolumeFast: s.setChannelVolumeFast,
    setChannelPan: s.setChannelPan,
    setChannelMute: s.setChannelMute,
    setChannelSolo: s.setChannelSolo,
    addChannel: s.addChannel,
    removeChannel: s.removeChannel,
    renameChannel: s.renameChannel,
    addChannelEffect: s.addChannelEffect,
    removeChannelEffect: s.removeChannelEffect,
    moveChannelEffect: s.moveChannelEffect,
    setChannelEffectParam: s.setChannelEffectParam,
    setChannelEffectParamFast: s.setChannelEffectParamFast,
    hideInstrumentFromMixer: s.hideInstrumentFromMixer,
    showInstrumentInMixer: s.showInstrumentInMixer,
    reorderMixerInstrument: s.reorderMixerInstrument,
    setInstrumentChannelId: s.setInstrumentChannelId,
    setInstrumentPan: s.setInstrumentPan,
    setInstrumentPanFast: s.setInstrumentPanFast,
    setOscParam: s.setOscParam,
    setOscParamFast: s.setOscParamFast,
    setDrumKitParam: s.setDrumKitParam,
    setDrumKitParamFast: s.setDrumKitParamFast,
  }))

  const [selectedChannel, setSelectedChannel] = useState<Id | null>(null)
  const [selectedEffect, setSelectedEffect] = useState<Id | null>(null)
  const orders = doc.entities.mixerInstrumentOrder
  const instruments = doc.entities.instruments
  const channels = doc.entities.mixChannels
  const subChannels = Object.values(channels).filter((c) => c.kind === 'sub')

  // Hidden instruments (exist but not in mixerInstrumentOrder).
  const hiddenInstruments = Object.values(instruments).filter(
    (inst) => !orders.includes(inst.id),
  )

  const handleAddChannel = useCallback(() => {
    const id = addChannel('sub')
    setSelectedChannel(id)
  }, [addChannel])

  const handleVolumeDrag = useCallback(
    (chanId: Id, vol: number) => setChannelVolumeFast(chanId, Math.max(0, Math.min(2, vol))),
    [setChannelVolumeFast],
  )
  const handleVolumeCommit = useCallback(
    (chanId: Id, vol: number) => setChannelVolume(chanId, Math.max(0, Math.min(2, vol))),
    [setChannelVolume],
  )

  const handleInstVolumeDrag = useCallback(
    (inst: Instrument, vol: number) => {
      const v = Math.max(0, Math.min(2, vol))
      if (inst.kind === 'osc') setOscParamFast(inst.id, 'gain', v)
      else if (inst.kind === 'drumkit') setDrumKitParamFast(inst.id, 'gain', v)
      // modular: output gain is handled by the module param system
    },
    [setOscParamFast, setDrumKitParamFast],
  )
  const handleInstVolumeCommit = useCallback(
    (inst: Instrument, vol: number) => {
      const v = Math.max(0, Math.min(2, vol))
      if (inst.kind === 'osc') setOscParam(inst.id, 'gain', v)
      else if (inst.kind === 'drumkit') setDrumKitParam(inst.id, 'gain', v)
    },
    [setOscParam, setDrumKitParam],
  )

  const handleInstPanDrag = useCallback(
    (instId: Id, pan: number) => setInstrumentPanFast(instId, Math.max(-1, Math.min(1, pan))),
    [setInstrumentPanFast],
  )
  const handleInstPanCommit = useCallback(
    (instId: Id, pan: number) => setInstrumentPan(instId, Math.max(-1, Math.min(1, pan))),
    [setInstrumentPan],
  )

  const handleFxParamDrag = useCallback(
    (chanId: Id, fxId: Id, key: string, value: number) =>
      setChannelEffectParamFast(chanId, fxId, key, value),
    [setChannelEffectParamFast],
  )
  const handleFxParamCommit = useCallback(
    (chanId: Id, fxId: Id, key: string, value: number) =>
      setChannelEffectParam(chanId, fxId, key, value),
    [setChannelEffectParam],
  )

  const selectedSub = subChannels.find((c) => c.id === selectedChannel) ?? null
  const selectedMaster = channels[MASTER_CHANNEL_ID]
  const selectedEffects = selectedSub?.effects ?? selectedMaster?.effects ?? []
  const selectedEffectObj = selectedEffects.find((e) => e.id === selectedEffect) ?? null

  // ── Render ──────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Channel strips area — horizontal scroll */}
      <div style={{ display: 'flex', flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '8px', gap: '4px', minHeight: 0 }}>
        {/* Instrument strips */}
        {orders.map((instId, idx) => {
          const inst = instruments[instId]
          if (!inst) return null
          return (
            <InstrumentStrip
              key={instId}
              inst={inst}
              channels={channels}
              isFirst={idx > 0}
              isLast={idx < orders.length - 1}
              canMoveUp={idx > 0}
              canMoveDown={idx < orders.length - 1}
              onVolumeDrag={(v) => handleInstVolumeDrag(inst, v)}
              onVolumeCommit={(v) => handleInstVolumeCommit(inst, v)}
              onPanDrag={(pan) => handleInstPanDrag(inst.id, pan)}
              onPanCommit={(pan) => handleInstPanCommit(inst.id, pan)}
              onRoute={(cid) => setInstrumentChannelId(inst.id, cid)}
              onHide={() => hideInstrumentFromMixer(inst.id)}
              onMoveUp={() => reorderMixerInstrument(inst.id, idx - 1)}
              onMoveDown={() => reorderMixerInstrument(inst.id, idx + 1)}
            />
          )
        })}

        {/* Sub-channel strips */}
        {subChannels.map((chan) => (
          <ChannelStrip
            key={chan.id}
            channel={chan}
            isSelected={selectedChannel === chan.id}
            onSelect={() => { setSelectedChannel(chan.id); setSelectedEffect(null) }}
            onVolumeDrag={(v) => handleVolumeDrag(chan.id, v)}
            onVolumeCommit={(v) => handleVolumeCommit(chan.id, v)}
            onPanDrag={(pan) => setChannelPan(chan.id, Math.max(-1, Math.min(1, pan)))}
            onPanCommit={(pan) => setChannelPan(chan.id, Math.max(-1, Math.min(1, pan)))}
            onToggleMute={() => setChannelMute(chan.id, !chan.mute)}
            onToggleSolo={() => setChannelSolo(chan.id, !chan.solo)}
            onRename={(name) => renameChannel(chan.id, name)}
            onDelete={() => { if (selectedChannel === chan.id) { setSelectedChannel(null); setSelectedEffect(null) }; removeChannel(chan.id) }}
            onAddFx={(type) => { const fxId = addChannelEffect(chan.id, type); setSelectedChannel(chan.id); setSelectedEffect(fxId) }}
            onSelectFx={(fxId) => { setSelectedChannel(chan.id); setSelectedEffect(fxId) }}
            selectedFx={selectedChannel === chan.id ? selectedEffect : null}
          />
        ))}

        {/* Add sub button */}
        <button className="octbtn" onClick={handleAddChannel} title="Add sub channel" style={{ alignSelf: 'center', height: 'fit-content' }}>
          + Sub
        </button>

        {/* Master strip */}
        {selectedMaster && (
          <ChannelStrip
            channel={selectedMaster}
            isSelected={selectedChannel === MASTER_CHANNEL_ID}
            isMaster
            onSelect={() => { setSelectedChannel(MASTER_CHANNEL_ID); setSelectedEffect(null) }}
            onVolumeDrag={(v) => handleVolumeDrag(MASTER_CHANNEL_ID, v)}
            onVolumeCommit={(v) => handleVolumeCommit(MASTER_CHANNEL_ID, v)}
            onPanDrag={(pan) => setChannelPan(MASTER_CHANNEL_ID, Math.max(-1, Math.min(1, pan)))}
            onPanCommit={(pan) => setChannelPan(MASTER_CHANNEL_ID, Math.max(-1, Math.min(1, pan)))}
            onToggleMute={() => setChannelMute(MASTER_CHANNEL_ID, !selectedMaster.mute)}
            onToggleSolo={() => setChannelSolo(MASTER_CHANNEL_ID, !selectedMaster.solo)}
            onRename={() => {}}
            onAddFx={(type) => { const fxId = addChannelEffect(MASTER_CHANNEL_ID, type); setSelectedChannel(MASTER_CHANNEL_ID); setSelectedEffect(fxId) }}
            onSelectFx={(fxId) => { setSelectedChannel(MASTER_CHANNEL_ID); setSelectedEffect(fxId) }}
            selectedFx={selectedChannel === MASTER_CHANNEL_ID ? selectedEffect : null}
          />
        )}

        {/* Hidden instruments dropdown */}
        {hiddenInstruments.length > 0 && (
          <div style={{ alignSelf: 'center', marginLeft: 8 }}>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) showInstrumentInMixer(e.target.value)
              }}
              style={{ fontSize: '11px' }}
            >
              <option value="">+ Show ({hiddenInstruments.length})</option>
              {hiddenInstruments.map((inst) => (
                <option key={inst.id} value={inst.id}>{inst.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Effect editor */}
      {selectedEffectObj && (
        <EffectEditor
          effect={selectedEffectObj}
          channelId={selectedChannel ?? ''}
          onParamDrag={(key, value) => handleFxParamDrag(selectedChannel!, selectedEffect!, key, value)}
          onParamCommit={(key, value) => handleFxParamCommit(selectedChannel!, selectedEffect!, key, value)}
          onRemove={() => { removeChannelEffect(selectedChannel!, selectedEffect!); setSelectedEffect(null) }}
          selectedEffects={selectedEffects}
          selectedEffectId={selectedEffect!}
          onReorder={(fxId, newIdx) => moveChannelEffect(selectedChannel!, fxId, newIdx)}
        />
      )}
    </div>
  )
}

// ── Instrument Strip ──────────────────────────────────────────

function InstrumentStrip({
  inst,
  channels,
  isFirst: _isFirst,
  isLast: _isLast,
  canMoveUp,
  canMoveDown,
  onVolumeDrag,
  onVolumeCommit,
  onPanDrag,
  onPanCommit,
  onRoute,
  onHide,
  onMoveUp,
  onMoveDown,
}: {
  inst: Instrument
  channels: Record<Id, MixChannel>
  isFirst: boolean
  isLast: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onVolumeDrag: (v: number) => void
  onVolumeCommit: (v: number) => void
  onPanDrag: (pan: number) => void
  onPanCommit: (pan: number) => void
  onRoute: (channelId: Id) => void
  onHide: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const gain = inst.kind === 'drumkit' ? inst.params.gain
    : inst.kind === 'osc' ? inst.params.gain
    : inst.kind === 'modular'
      ? inst.modules[inst.outputId]?.params.gain ?? 1
      : 1

  const kindLabel = inst.kind === 'osc' ? 'OSC' : inst.kind === 'modular' ? 'MOD' : 'DK'
  const subChannels = Object.values(channels).filter((c) => c.kind === 'sub')

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      minWidth: 60, maxWidth: 70, padding: '4px 2px',
      border: '1px solid #444', borderRadius: 4, background: '#1a1a2e',
      flexShrink: 0, gap: 2,
    }}>
      {/* Move buttons */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 0 }}>
        {canMoveUp && <button className="octbtn" onClick={onMoveUp} style={{ padding: '0 4px', fontSize: 10 }}>◀</button>}
        {canMoveDown && <button className="octbtn" onClick={onMoveDown} style={{ padding: '0 4px', fontSize: 10 }}>▶</button>}
      </div>

      {/* Name + hide */}
      <div style={{ fontSize: 10, fontWeight: 'bold', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
        {inst.name}
      </div>
      <div style={{ fontSize: 8, color: '#888' }}>{kindLabel}</div>
      <button className="octbtn" onClick={onHide} style={{ fontSize: 10, padding: 0, width: 18, height: 18, lineHeight: '16px' }} title="Hide from mixer">×</button>

      {/* Volume fader */}
      <VerticalFader value={gain} onDrag={onVolumeDrag} onCommit={onVolumeCommit} />

      {/* Pan slider */}
      <div style={{ fontSize: 8, color: '#aaa' }}>Pan</div>
      <input
        type="range" min={-1} max={1} step={0.01} value={inst.pan ?? 0}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onPanDrag(parseFloat(e.target.value))}
        onMouseUp={(e) => onPanCommit(parseFloat((e.target as HTMLInputElement).value))}
        style={{ width: '100%', writingMode: 'horizontal-tb', direction: 'ltr', height: 16 }}
      />

      {/* Routing */}
      <select
        value={inst.channelId ?? MASTER_CHANNEL_ID}
        onChange={(e) => onRoute(e.target.value)}
        style={{ fontSize: 9, width: '100%', marginTop: 4 }}
      >
        <option value={MASTER_CHANNEL_ID}>Master</option>
        {subChannels.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  )
}

// ── Channel Strip ─────────────────────────────────────────────

function ChannelStrip({
  channel,
  isSelected,
  isMaster,
  onSelect,
  onVolumeDrag,
  onVolumeCommit,
  onPanDrag,
  onPanCommit,
  onToggleMute,
  onToggleSolo,
  onRename,
  onDelete,
  onAddFx,
  onSelectFx,
  selectedFx,
}: {
  channel: MixChannel
  isSelected?: boolean
  isMaster?: boolean
  onSelect: () => void
  onVolumeDrag: (v: number) => void
  onVolumeCommit: (v: number) => void
  onPanDrag: (pan: number) => void
  onPanCommit: (pan: number) => void
  onToggleMute: () => void
  onToggleSolo: () => void
  onRename: (name: string) => void
  onDelete?: () => void
  onAddFx: (type: ModuleType) => void
  onSelectFx: (fxId: Id) => void
  selectedFx: Id | null
}) {
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState(channel.name)

  const borderColor = isSelected ? '#6af' : '#555'
  const bg = isMaster ? '#1a1a3e' : '#1a2e1a'

  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        minWidth: 72, maxWidth: 80, padding: '4px 4px',
        border: `2px solid ${borderColor}`, borderRadius: 4, background: bg,
        flexShrink: 0, gap: 2, cursor: 'pointer',
      }}
    >
      {/* Name */}
      {editing && !isMaster ? (
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => { setEditing(false); onRename(nameDraft) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { setEditing(false); onRename(nameDraft) } }}
          style={{ width: '100%', fontSize: 10, textAlign: 'center' }}
          autoFocus
        />
      ) : (
        <div
          onDoubleClick={() => { if (!isMaster) { setNameDraft(channel.name); setEditing(true) } }}
          style={{ fontSize: 10, fontWeight: 'bold', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}
        >
          {channel.name}
        </div>
      )}
      {isMaster && <div style={{ fontSize: 8, color: '#888' }}>MASTER</div>}
      {!isMaster && !isMaster && <div style={{ fontSize: 8, color: '#888' }}>SUB</div>}
      {onDelete && (
        <button className="octbtn" onClick={onDelete} style={{ fontSize: 10, padding: 0, width: 18, height: 18, lineHeight: '16px' }} title="Delete channel">×</button>
      )}

      {/* Volume fader */}
      <VerticalFader value={channel.volume} onDrag={onVolumeDrag} onCommit={onVolumeCommit} />

      {/* Pan */}
      <div style={{ fontSize: 8, color: '#aaa' }}>Bal</div>
      <input
        type="range" min={-1} max={1} step={0.01} value={channel.pan}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onPanDrag(parseFloat(e.target.value))}
        onMouseUp={(e) => onPanCommit(parseFloat((e.target as HTMLInputElement).value))}
        style={{ width: '100%', height: 16 }}
      />

      {/* Mute/Solo */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          className="octbtn"
          onClick={(e) => { e.stopPropagation(); onToggleMute() }}
          style={{ fontSize: 9, padding: '1px 5px', background: channel.mute ? '#c44' : undefined }}
        >M</button>
        <button
          className="octbtn"
          onClick={(e) => { e.stopPropagation(); onToggleSolo() }}
          style={{ fontSize: 9, padding: '1px 5px', background: channel.solo ? '#cc4' : undefined }}
        >S</button>
      </div>

      {/* Effect slots */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%', marginTop: 4 }}>
        {channel.effects.map((fx) => {
          const def = MODULE_DEFS[fx.type]
          return (
            <button
              key={fx.id}
              className="octbtn"
              onClick={(e) => { e.stopPropagation(); onSelectFx(fx.id) }}
              style={{
                fontSize: 8, padding: '1px 3px',
                background: fx.id === selectedFx ? '#48a' : undefined,
                textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {def?.label ?? fx.type}
            </button>
          )
        })}
        <div style={{ display: 'flex', gap: 2 }}>
          {EFFECT_MODULE_TYPES.map((type) => (
            <button
              key={type}
              className="octbtn"
              onClick={(e) => { e.stopPropagation(); onAddFx(type) }}
              style={{ fontSize: 7, padding: '1px 3px' }}
              title={MODULE_DEFS[type].label}
            >
              +{MODULE_DEFS[type].label.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Vertical Fader ────────────────────────────────────────────

function VerticalFader({ value, onDrag, onCommit }: {
  value: number
  onDrag: (v: number) => void
  onCommit: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minHeight: 80 }}>
      <input
        type="range"
        min={0} max={2} step={0.01}
        value={value}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onDrag(parseFloat(e.target.value))}
        onMouseUp={(e) => onCommit(parseFloat((e.target as HTMLInputElement).value))}
        style={{
          writingMode: 'vertical-lr', direction: 'rtl',
          height: 100, width: 24,
        }}
      />
      <div style={{ fontSize: 8, color: '#aaa' }}>{(value * 100).toFixed(0)}%</div>
    </div>
  )
}

// ── Effect Editor ─────────────────────────────────────────────

function EffectEditor({
  effect,
  channelId: _channelId,
  onParamDrag,
  onParamCommit,
  onRemove,
  selectedEffects,
  selectedEffectId,
  onReorder,
}: {
  effect: ChannelEffect
  channelId: string
  onParamDrag: (key: string, value: number) => void
  onParamCommit: (key: string, value: number) => void
  onRemove: () => void
  selectedEffects: ChannelEffect[]
  selectedEffectId: Id
  onReorder: (fxId: Id, newIndex: number) => void
}) {
  const def = MODULE_DEFS[effect.type]
  if (!def) return null

  const fxIdx = selectedEffects.findIndex((e) => e.id === selectedEffectId)

  return (
    <div style={{
      borderTop: '2px solid #555', padding: '8px', background: '#12121f',
      maxHeight: 160, overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 12 }}>{def.label}</strong>
        <button className="octbtn" onClick={onRemove} style={{ fontSize: 10 }}>Remove</button>
        {fxIdx > 0 && (
          <button className="octbtn" onClick={() => onReorder(selectedEffectId, fxIdx - 1)} style={{ fontSize: 10 }}>↑</button>
        )}
        {fxIdx < selectedEffects.length - 1 && (
          <button className="octbtn" onClick={() => onReorder(selectedEffectId, fxIdx + 1)} style={{ fontSize: 10 }}>↓</button>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {def.params.map((param) => {
          const val = effect.params[param.key] ?? param.default
          const label = param.enumLabels
            ? param.enumLabels[Math.round(val)] ?? val
            : param.label

          return (
            <div key={param.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 80 }}>
              <label style={{ fontSize: 9, color: '#aaa' }}>{label}</label>
              {param.enumLabels ? (
                <select
                  value={Math.round(val)}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    onParamCommit(param.key, v)
                  }}
                  style={{ fontSize: 10, width: '100%' }}
                >
                  {param.enumLabels.map((lbl, i) => (
                    <option key={i} value={i}>{lbl}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="range" min={param.min} max={param.max} step={param.step}
                  value={val}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => onParamDrag(param.key, parseFloat(e.target.value))}
                  onMouseUp={(e) => onParamCommit(param.key, parseFloat((e.target as HTMLInputElement).value))}
                  style={{ width: 70 }}
                />
              )}
              <span style={{ fontSize: 8, color: '#aaa' }}>
                {typeof val === 'number' ? (param.step >= 1 ? val.toFixed(0) : val.toFixed(2)) : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
