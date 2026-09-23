// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ChannelStrip } from './ChannelStrip'
import { InstrumentStrip } from './InstrumentStrip'
import { STRIP_FOOTER_HEIGHT, STRIP_GAP } from './mixerStrip'
import { createMasterChannel, newModularInstrument } from '../domain/factory'
import { MASTER_CHANNEL_ID } from '../domain/types'

const noop = () => {}

function renderChannel() {
  const master = createMasterChannel()
  return render(
    <ChannelStrip channel={master} isMaster onSelect={noop}
      onVolumeSilent={noop} onVolumeCommit={noop} onPanSilent={noop} onPanCommit={noop}
      onToggleMute={noop} onToggleSolo={noop} onRename={noop} onAddFx={noop} />,
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

describe('mixer strips', () => {
  it('channel and instrument strips share gap, border width and footer height', () => {
    const channel = renderChannel().container.firstElementChild as HTMLElement
    const instrument = renderInstrument().container.firstElementChild as HTMLElement

    expect(channel.style.gap).toBe(`${STRIP_GAP}px`)
    expect(instrument.style.gap).toBe(`${STRIP_GAP}px`)
    expect(channel.style.border).toMatch(/^1px/)
    expect(instrument.style.border).toMatch(/^1px/)

    const channelFooter = channel.lastElementChild as HTMLElement
    const instrumentFooter = instrument.lastElementChild as HTMLElement
    expect(instrumentFooter.tagName).toBe('SELECT')
    expect(channelFooter.style.height).toBe(`${STRIP_FOOTER_HEIGHT}px`)
    expect(instrumentFooter.style.height).toBe(`${STRIP_FOOTER_HEIGHT}px`)
    expect(channelFooter.style.marginTop).toBe(instrumentFooter.style.marginTop)
  })

  it('renders the master channel strip', () => {
    expect(renderChannel().container.innerHTML).toMatchSnapshot()
  })
})
