import { useState } from 'react'
import { useDocStore } from '../../state/docStore'
import { askConfirm } from '../../state/dialogStore'
import { MASTER_CHANNEL_ID } from '../../domain/types'
import type { Id, Instrument, MixChannel, ModuleType } from '../../domain/types'
import { Button } from '../components/Button'
import { Select } from '../components/Select'
import { cx } from '../components/cx'
import { InstrumentStrip } from './InstrumentStrip'
import { ChannelStrip } from './ChannelStrip'
import { EffectCard } from './EffectCard'
import { AddEffectDropdown } from './AddEffectDropdown'
import s from './MixerView.module.css'

const store = () => useDocStore.getState()
const volume = (v: number) => Math.max(0, Math.min(2, v))
const balance = (p: number) => Math.max(-1, Math.min(1, p))

function instrumentGain(inst: Instrument): number {
  if (inst.kind === 'drumkit') return inst.params.gain
  return inst.modules[inst.outputId]?.params.gain ?? 1
}

function channelHandlers(chan: MixChannel) {
  return {
    onVolumeSilent: (v: number) => store().setChannelVolumeSilent(chan.id, volume(v)),
    onVolumeCommit: (v: number) => store().setChannelVolume(chan.id, volume(v)),
    onPanSilent: (p: number) => store().setChannelPanSilent(chan.id, balance(p)),
    onPanCommit: (p: number) => store().setChannelPan(chan.id, balance(p)),
    onToggleMute: () => store().setChannelMute(chan.id, !chan.mute),
    onToggleSolo: () => store().setChannelSolo(chan.id, !chan.solo),
    onAddFx: (type: ModuleType) => store().addChannelEffect(chan.id, type),
  }
}

export function MixerView() {
  const doc = useDocStore((st) => st.doc)
  const [selectedChannel, setSelectedChannel] = useState<Id>(MASTER_CHANNEL_ID)

  const orders = doc.entities.mixerInstrumentOrder
  const instruments = doc.entities.instruments
  const channels = doc.entities.mixChannels
  const subChannels = Object.values(channels).filter((c) => c.kind === 'sub')
  const master = channels[MASTER_CHANNEL_ID]
  const selectedChan = channels[selectedChannel]
  const hiddenInstruments = Object.values(instruments).filter((inst) => !orders.includes(inst.id))

  const deleteChannel = async (chan: MixChannel) => {
    if (!await askConfirm({ message: `Delete channel "${chan.name}"?`, confirmLabel: 'Delete', danger: true })) return
    if (selectedChannel === chan.id) setSelectedChannel(MASTER_CHANNEL_ID)
    store().removeChannel(chan.id)
  }

  return (
    <div className={s.view}>
      <div className={s.strips}>
        {orders.map((instId, idx) => {
          const inst = instruments[instId]
          if (!inst) return null
          return (
            <InstrumentStrip
              key={instId} inst={inst} channels={channels} gain={instrumentGain(inst)}
              onVolumeSilent={(v) => {
                if (inst.kind === 'drumkit') store().setDrumKitParamSilent(inst.id, 'gain', volume(v))
                else store().setModuleParamSilent(inst.id, inst.outputId, 'gain', volume(v))
              }}
              onVolumeCommit={(v) => {
                if (inst.kind === 'drumkit') store().setDrumKitParam(inst.id, 'gain', volume(v))
                else store().setModuleParam(inst.id, inst.outputId, 'gain', volume(v))
              }}
              onPanSilent={(p) => store().setInstrumentPanSilent(inst.id, balance(p))}
              onPanCommit={(p) => store().setInstrumentPan(inst.id, balance(p))}
              onRoute={(cid) => store().setInstrumentChannelId(inst.id, cid)}
              onHide={() => store().hideInstrumentFromMixer(inst.id)}
              onMoveUp={idx > 0 ? () => store().reorderMixerInstrument(inst.id, idx - 1) : undefined}
              onMoveDown={idx < orders.length - 1 ? () => store().reorderMixerInstrument(inst.id, idx + 1) : undefined}
            />
          )
        })}
        {hiddenInstruments.length > 0 && (
          <Select small className={cx(s.between, s.hidden)} value=""
            onChange={(e) => { if (e.target.value) store().showInstrumentInMixer(e.target.value) }}>
            <option value="">Hidden ({hiddenInstruments.length})</option>
            {hiddenInstruments.map((inst) => <option key={inst.id} value={inst.id}>{inst.name}</option>)}
          </Select>
        )}
        {subChannels.map((chan) => (
          <ChannelStrip key={chan.id} channel={chan} selected={selectedChannel === chan.id}
            onSelect={() => setSelectedChannel(chan.id)}
            onRename={(name) => store().renameChannel(chan.id, name)}
            onDelete={() => void deleteChannel(chan)}
            {...channelHandlers(chan)}
          />
        ))}
        <Button className={s.between} title="Add sub channel"
          onClick={() => setSelectedChannel(store().addChannel('sub'))}>+ Sub</Button>
        {master && (
          <ChannelStrip channel={master} selected={selectedChannel === MASTER_CHANNEL_ID} showMeter
            onSelect={() => setSelectedChannel(MASTER_CHANNEL_ID)}
            {...channelHandlers(master)}
          />
        )}
      </div>

      {selectedChan && (
        <div className={s.sidebar}>
          <div className={s.sidebarTitle}>
            {selectedChan.name}
            <span className={s.sidebarKind}>{selectedChan.kind === 'master' ? 'Master Channel' : 'Sub Channel'}</span>
          </div>
          {selectedChan.effects.length === 0 && <div className={s.empty}>No effects on this channel</div>}
          {selectedChan.effects.map((fx, idx) => (
            <EffectCard key={fx.id} effect={fx}
              onToggleBypass={(bypassed) => store().setChannelEffectParamSilent(selectedChan.id, fx.id, 'bypass', bypassed ? 1 : 0)}
              onRemove={() => store().removeChannelEffect(selectedChan.id, fx.id)}
              onParamSilent={(key, value) => store().setChannelEffectParamSilent(selectedChan.id, fx.id, key, value)}
              onParamCommit={(key, value) => store().setChannelEffectParam(selectedChan.id, fx.id, key, value)}
              onSampleChange={(sampleId) => store().setChannelEffectSample(selectedChan.id, fx.id, sampleId)}
              onMoveUp={idx > 0 ? () => store().moveChannelEffect(selectedChan.id, fx.id, idx - 1) : undefined}
              onMoveDown={idx < selectedChan.effects.length - 1 ? () => store().moveChannelEffect(selectedChan.id, fx.id, idx + 1) : undefined}
            />
          ))}
          <AddEffectDropdown existingTypes={selectedChan.effects.map((e) => e.type)}
            onAdd={(type) => store().addChannelEffect(selectedChan.id, type)} />
        </div>
      )}
    </div>
  )
}
