import { useState } from 'react'
import { useDocStore } from '../state/docStore'
import { MASTER_CHANNEL_ID } from '../domain/types'
import type { Id, Instrument } from '../domain/types'
import { InstrumentStrip } from './InstrumentStrip'
import { ChannelStrip } from './ChannelStrip'
import { EffectCard } from './EffectCard'
import { AddEffectDropdown } from './AddEffectDropdown'

// ── MixerView ────────────────────────────────────────────────

export function MixerView() {
  const doc = useDocStore((s) => s.doc)
  const store = () => useDocStore.getState()
  const [selectedChannel, setSelectedChannel] = useState<Id>(MASTER_CHANNEL_ID)

  const orders = doc.entities.mixerInstrumentOrder
  const instruments = doc.entities.instruments
  const channels = doc.entities.mixChannels
  const subChannels = Object.values(channels).filter((c) => c.kind === 'sub')
  const master = channels[MASTER_CHANNEL_ID]
  const selectedChan = channels[selectedChannel]

  const hiddenInstruments = Object.values(instruments).filter((inst) => !orders.includes(inst.id))

  const getInstGain = (inst: Instrument): number => {
    if (inst.kind === 'drumkit') return inst.params.gain
    return inst.modules[inst.outputId]?.params.gain ?? 1
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Channel strips */}
      <div style={{ flex: 1, display: 'flex', overflowX: 'auto', overflowY: 'hidden', padding: '8px 8px 4px', gap: 4, minHeight: 0, alignItems: 'stretch' }}>
        {/* Instruments */}
        {orders.map((instId, idx) => {
          const inst = instruments[instId]
          if (!inst) return null
          return (
            <InstrumentStrip
              key={instId} inst={inst} channels={channels}
              gain={getInstGain(inst)}
              onVolumeSilent={(v) => {
                const vol = Math.max(0, Math.min(2, v))
                if (inst.kind === 'drumkit') store().setDrumKitParamSilent(inst.id, 'gain', vol)
                else store().setModuleParamSilent(inst.id, inst.outputId, 'gain', vol)
              }}
              onVolumeCommit={(v) => {
                const vol = Math.max(0, Math.min(2, v))
                if (inst.kind === 'drumkit') store().setDrumKitParam(inst.id, 'gain', vol)
                else store().setModuleParam(inst.id, inst.outputId, 'gain', vol)
              }}
              onPanSilent={(pan) => store().setInstrumentPanSilent(inst.id, Math.max(-1, Math.min(1, pan)))}
              onPanCommit={(pan) => store().setInstrumentPan(inst.id, Math.max(-1, Math.min(1, pan)))}
              onRoute={(cid) => store().setInstrumentChannelId(inst.id, cid)}
              onHide={() => store().hideInstrumentFromMixer(inst.id)}
              onMoveUp={idx > 0 ? () => store().reorderMixerInstrument(inst.id, idx - 1) : undefined}
              onMoveDown={idx < orders.length - 1 ? () => store().reorderMixerInstrument(inst.id, idx + 1) : undefined}
            />
          )
        })}
        {hiddenInstruments.length > 0 && (
          <div style={{ alignSelf: 'flex-start', marginLeft: 4, flexShrink: 0 }}>
            <select value="" onChange={(e) => { if (e.target.value) store().showInstrumentInMixer(e.target.value) }} className="mixer-dropdown">
              <option value="">Hidden ({hiddenInstruments.length})</option>
              {hiddenInstruments.map((inst) => <option key={inst.id} value={inst.id}>{inst.name}</option>)}
            </select>
          </div>
        )}
        {subChannels.map((chan) => (
          <ChannelStrip key={chan.id} channel={chan} isSelected={selectedChannel === chan.id}
            onSelect={() => setSelectedChannel(chan.id)}
            onVolumeSilent={(v) => store().setChannelVolumeSilent(chan.id, Math.max(0, Math.min(2, v)))}
            onVolumeCommit={(v) => store().setChannelVolume(chan.id, Math.max(0, Math.min(2, v)))}
            onPanSilent={(pan) => store().setChannelPanSilent(chan.id, Math.max(-1, Math.min(1, pan)))}
            onPanCommit={(pan) => store().setChannelPan(chan.id, Math.max(-1, Math.min(1, pan)))}
            onToggleMute={() => store().setChannelMute(chan.id, !chan.mute)}
            onToggleSolo={() => store().setChannelSolo(chan.id, !chan.solo)}
            onRename={(name) => store().renameChannel(chan.id, name)}
            onDelete={() => { if (selectedChannel === chan.id) setSelectedChannel(MASTER_CHANNEL_ID); store().removeChannel(chan.id) }}
            onAddFx={(type) => store().addChannelEffect(chan.id, type)}
          />
        ))}
        <button className="octbtn" onClick={() => { const id = store().addChannel('sub'); setSelectedChannel(id) }}
          title="Add sub channel" style={{ alignSelf: 'flex-start', height: 'fit-content', flexShrink: 0 }}>+ Sub</button>
        {master && (
          <ChannelStrip channel={master} isSelected={selectedChannel === MASTER_CHANNEL_ID} isMaster showMeter
            onSelect={() => setSelectedChannel(MASTER_CHANNEL_ID)}
            onVolumeSilent={(v) => store().setChannelVolumeSilent(MASTER_CHANNEL_ID, Math.max(0, Math.min(2, v)))}
            onVolumeCommit={(v) => store().setChannelVolume(MASTER_CHANNEL_ID, Math.max(0, Math.min(2, v)))}
            onPanSilent={(pan) => store().setChannelPanSilent(MASTER_CHANNEL_ID, Math.max(-1, Math.min(1, pan)))}
            onPanCommit={(pan) => store().setChannelPan(MASTER_CHANNEL_ID, Math.max(-1, Math.min(1, pan)))}
            onToggleMute={() => store().setChannelMute(MASTER_CHANNEL_ID, !master.mute)}
            onToggleSolo={() => store().setChannelSolo(MASTER_CHANNEL_ID, !master.solo)}
            onRename={() => {}}
            onAddFx={(type) => store().addChannelEffect(MASTER_CHANNEL_ID, type)}
          />
        )}
      </div>

      {/* Effect editor sidebar */}
      {selectedChan && (
        <div style={{ width: 280, flexShrink: 0, borderLeft: '2px solid #555', background: '#12121f', overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 'bold' }}>
            {selectedChan.name}
            <span style={{ fontSize: 10, color: '#888', marginLeft: 8 }}>{selectedChan.kind === 'master' ? 'Master Channel' : 'Sub Channel'}</span>
          </div>
          {selectedChan.effects.length === 0 && <div style={{ fontSize: 11, color: '#666', fontStyle: 'italic' }}>No effects on this channel</div>}
          {selectedChan.effects.map((fx, idx) => (
            <EffectCard key={fx.id} effect={fx} channelId={selectedChan.id}
              isFirst={idx === 0} isLast={idx === selectedChan.effects.length - 1}
              onToggleBypass={(bypassed) => store().setChannelEffectParamSilent(selectedChan.id, fx.id, 'bypass', bypassed ? 1 : 0)}
              onRemove={() => store().removeChannelEffect(selectedChan.id, fx.id)}
              onParamSilent={(key, value) => store().setChannelEffectParamSilent(selectedChan.id, fx.id, key, value)}
              onParamCommit={(key, value) => store().setChannelEffectParam(selectedChan.id, fx.id, key, value)}
              onMoveUp={idx > 0 ? () => store().moveChannelEffect(selectedChan.id, fx.id, idx - 1) : undefined}
              onMoveDown={idx < selectedChan.effects.length - 1 ? () => store().moveChannelEffect(selectedChan.id, fx.id, idx + 1) : undefined}
            />
          ))}
          <AddEffectDropdown existingTypes={selectedChan.effects.map((e) => e.type)} onAdd={(type) => store().addChannelEffect(selectedChan.id, type)} />
        </div>
      )}
    </div>
  )
}
