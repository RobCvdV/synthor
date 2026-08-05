import { useEffect } from 'react'
import { useMidiStore } from '../state/midiStore'
import { useDocStore } from '../state/docStore'
import { usePreviewStore } from '../state/previewStore'
import type { AudioHost } from '../audio/host'
import type { DrumKitInstrument } from '../domain/types'
import { LIVE_VOICE_COUNT } from '../engine/voicePool'

/** Look up the instrument for `instId` and return it if it's a drumkit
 *  (so the VoicePool is configured with per-slot routing). */
function getKit(instId: string): DrumKitInstrument | undefined {
  const inst = useDocStore.getState().doc.entities.instruments[instId]
  return inst?.kind === 'drumkit' ? inst : undefined
}

/**
 * Build a MIDI channel (1-16) → instrument id map from the current doc.
 * Instruments with an explicit `midiChannel` get that channel; the first
 * instrument without a channel gets the "cursor-tracking" role (used when
 * no channel match is found).
 */
function buildChannelMap(): { byChannel: Map<number, string>; fallback: string | null } {
  const doc = useDocStore.getState().doc
  const byChannel = new Map<number, string>()
  let fallback: string | null = null

  for (const inst of Object.values(doc.entities.instruments)) {
    if (inst.midiChannel != null && inst.midiChannel >= 1 && inst.midiChannel <= 16) {
      byChannel.set(inst.midiChannel, inst.id)
    } else if (!fallback) {
      fallback = inst.id
    }
  }
  return { byChannel, fallback }
}

/**
 * Which instrument receives MIDI messages on the given channel.
 * Keyboard preview instrument takes priority (Instruments view);
 * then the channel-mapped instrument; falls back to the cursor-track
 * instrument (midiStore.activeInstrumentId).
 */
function getInstForChannel(channel: number): string | null {
  // Keyboard preview always wins (user is actively holding keys).
  const keyboardInstId = usePreviewStore.getState().instrumentId
  if (keyboardInstId) return keyboardInstId

  const { byChannel, fallback } = buildChannelMap()
  // Preview store instrument overrides the channel map (it's the user
  // explicitly selecting an instrument to play).
  const mapped = byChannel.get(channel + 1) // MIDI channel is 0-based in the message but 1-based in UI
  if (mapped) return mapped

  return fallback ?? useMidiStore.getState().activeInstrumentId
}

/**
 * Connects to the Web MIDI API and routes incoming messages.
 *
 * Note events go through VoicePool (fixed polyphony, ref-based, no recompile).
 * CC / pitch bend go through midiStore.
 */
export function useMidi(host: AudioHost) {
  const setInputs = useMidiStore((s) => s.setInputs)
  const setSelectedInput = useMidiStore((s) => s.setSelectedInput)
  const setConnected = useMidiStore((s) => s.setConnected)
  const setCc = useMidiStore((s) => s.setCcValue)
  const setPitchBend = useMidiStore((s) => s.setPitchBend)

  // CC values update the store once per rAF frame, not on every MIDI event.
  // This keeps the MIDI event loop fast for note on/off during CC floods.
  host.ccBindings.onFlush = (cc, raw) => setCc(cc, raw)

  useEffect(() => {
    // Feature detection — Web MIDI is not available in all browsers.
    if (!('requestMIDIAccess' in navigator)) return

    let midiAccess: MIDIAccess | null = null

    void (async () => {
      try {
        midiAccess = await navigator.requestMIDIAccess()
      } catch {
        // User denied, or no devices.  Stop silently.
        return
      }

      const refreshPorts = () => {
        const inputs = Array.from(midiAccess!.inputs.values()).map((p) => ({
          id: p.id,
          name: p.name ?? `MIDI Port ${p.id.slice(0, 8)}`,
        }))
        setInputs(inputs)

        // Keep the selected input if it still exists.
        const { selectedInputId } = useMidiStore.getState()
        if (selectedInputId && !inputs.find((p) => p.id === selectedInputId)) {
          setSelectedInput(null)
        }
      }

      const attachInput = (port: MIDIInput) => {
        port.addEventListener('midimessage', (e) => {
          const msg = (e as MIDIMessageEvent).data
          if (!(msg instanceof Uint8Array) || msg.length < 2) return

          const status = msg[0] & 0xf0
          const chan = msg[0] & 0x0f // 0-based MIDI channel

          switch (status) {
            case 0x90: { // Note On
              const note = msg[1]
              const vel = msg[2]
              const instId = getInstForChannel(chan)
              if (!instId) break
              const kit = getKit(instId)
              const pool = host.voicePool(instId, LIVE_VOICE_COUNT, kit)
              if (vel === 0) {
                pool.noteOff(note)
              } else {
                void host.start().then(() => { pool.noteOn(note, vel) })
              }
              break
            }
            case 0x80: { // Note Off
              const instId = getInstForChannel(chan)
              if (!instId) break
              const kit = getKit(instId)
              host.voicePool(instId, LIVE_VOICE_COUNT, kit).noteOff(msg[1])
              break
            }
            case 0xb0: { // Control Change
              if (msg[1] === 21) console.log(`[midi] CC21 raw=${msg[2]}  @ ${performance.now().toFixed(0)}`)
              // Only buffer — the store is updated once per rAF in flushPending
              // so the MIDI event loop stays fast for note on/off messages.
              host.ccBindings.queue(msg[1], msg[2])
              break
            }
            case 0xe0: { // Pitch Bend
              // 14-bit value: lsb 7 bits + msb 7 bits, centre = 8192.
              const val = ((msg[2] << 7) | msg[1]) - 8192
              setPitchBend(val / 8192) // normalise to -1 … +1
              break
            }
            case 0xd0: { // Channel Pressure (Aftertouch)
              setCc(128, msg[1]) // store channel pressure at pseudo-CC 128
              break
            }
          }
        })
      }

      // Attach to all connected inputs.
      refreshPorts()
      for (const port of midiAccess.inputs.values()) attachInput(port)
      setConnected(midiAccess.inputs.size > 0)

      // Listen for port connect / disconnect.
      midiAccess.addEventListener('statechange', () => {
        refreshPorts()
        for (const port of midiAccess!.inputs.values()) attachInput(port)
        setConnected(midiAccess!.inputs.size > 0)
      })
    })()

    return () => {
      setConnected(false)
      setInputs([])
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Intentionally runs once on mount — ports are refreshed via statechange events.

  return null
}
