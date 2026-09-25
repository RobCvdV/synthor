// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ChannelStrip } from './ChannelStrip'
import { InstrumentStrip } from './InstrumentStrip'
import { MixerView } from './MixerView'
import { createMasterChannel, newModularInstrument } from '../../domain/factory'
import { MASTER_CHANNEL_ID } from '../../domain/types'
import { useDocStore } from '../../state/docStore'
import { resetStores } from '../test/testUtils'

const noop = () => {}

function renderChannel() {
  return render(
    <ChannelStrip channel={createMasterChannel()} onSelect={noop}
      onVolumeSilent={noop} onVolumeCommit={noop} onPanSilent={noop} onPanCommit={noop}
      onToggleMute={noop} onToggleSolo={noop} onAddFx={noop} />,
  )
}

function renderInstrument() {
  const inst = newModularInstrument('Lead')
  inst.id = 'inst_fixed'
  return render(
    <InstrumentStrip inst={inst} channels={{ [MASTER_CHANNEL_ID]: createMasterChannel() }} gain={1}
      onVolumeSilent={noop} onVolumeCommit={noop} onPanSilent={noop} onPanCommit={noop}
      onRoute={noop} onHide={noop} />,
  )
}

/** Class names of the strip's bottom controls, which must match across strip types to align. */
function bottomStack(strip: Element): string[] {
  return Array.from(strip.children).slice(-5).map((el) => el.className)
}

describe('mixer strips', () => {
  beforeEach(resetStores)

  it('channel and instrument strips end in the same control stack', () => {
    const channel = renderChannel().container.firstElementChild!
    const instrument = renderInstrument().container.firstElementChild!

    expect(bottomStack(channel)).toEqual(['muteSolo', 'label', 'slider pan', 'slider vertical fader', 'footer'])
    expect(bottomStack(instrument)).toEqual(bottomStack(channel))
    expect(channel.lastElementChild!.childElementCount).toBe(0)
    expect(instrument.lastElementChild!.firstElementChild!.tagName).toBe('SELECT')
  })

  it('disables the instrument M/S buttons, which have no function yet', () => {
    renderInstrument()
    expect(screen.getByText('M')).toBeDisabled()
    expect(screen.getByText('S')).toBeDisabled()
  })

  it('renders the master channel strip', () => {
    expect(renderChannel().container.innerHTML).toMatchSnapshot()
  })

  it('renders an instrument strip', () => {
    expect(renderInstrument().container.innerHTML).toMatchSnapshot()
  })
})

describe('MixerView', () => {
  beforeEach(resetStores)

  it('deletes a sub channel only after confirming', () => {
    const id = useDocStore.getState().addChannel('sub')
    const name = useDocStore.getState().doc.entities.mixChannels[id].name
    render(<MixerView />)

    fireEvent.click(screen.getByTitle('Delete channel'))
    expect(useDocStore.getState().doc.entities.mixChannels[id]).toBeDefined()
    expect(screen.getByText(`Delete channel "${name}"?`)).toBeTruthy()

    fireEvent.click(screen.getByText('Delete'))
    expect(useDocStore.getState().doc.entities.mixChannels[id]).toBeUndefined()
    expect(screen.getByText('Master Channel')).toBeTruthy()
  })
})
