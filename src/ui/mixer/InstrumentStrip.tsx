import { MASTER_CHANNEL_ID } from '../../domain/types'
import type { Id, Instrument, MixChannel } from '../../domain/types'
import { Button } from '../components/Button'
import { Select } from '../components/Select'
import { MixerStrip } from './MixerStrip'

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
  const subChannels = Object.values(channels).filter((c) => c.kind === 'sub')
  return (
    <MixerStrip
      variant="instrument" kindLabel={inst.kind === 'modular' ? 'SYN' : 'DK'} name={inst.name}
      actions={<>
        {onMoveUp && <Button size="xs" title="Move left" onClick={onMoveUp}>◀</Button>}
        {onMoveDown && <Button size="xs" title="Move right" onClick={onMoveDown}>▶</Button>}
      </>}
      actionsEnd={<Button size="xs" title="Hide from mixer" onClick={onHide}>Hide</Button>}
      mute={false} solo={false}
      panLabel="Pan" pan={inst.pan ?? 0} onPanSilent={onPanSilent} onPanCommit={onPanCommit}
      volume={gain} onVolumeSilent={onVolumeSilent} onVolumeCommit={onVolumeCommit}
      footer={
        <Select small value={inst.channelId ?? MASTER_CHANNEL_ID} onChange={(e) => onRoute(e.target.value)}
          title="Output channel">
          <option value={MASTER_CHANNEL_ID}>Master</option>
          {subChannels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      }
    />
  )
}
