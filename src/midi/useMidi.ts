import { useEffect } from 'react'
import { useMidiStore } from '../state/midiStore'
import { useDocStore } from '../state/docStore'
import type { AudioHost } from '../audio/host'
import type { DrumKitInstrument } from '../domain/types'

/** Look up the instrument for `instId` and return it if it's a drumkit
 *  (so the VoicePool is configured with per-slot routing). */
function getKit(instId: string): DrumKitInstrument | undefined {
  const inst = useDocStore.getState().doc.entities.instruments[instId]
  return inst?.kind === 'drumkit' ? inst : undefined
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
          const chan = msg[0] & 0x0f
          void chan // reserved for per-channel routing later

          switch (status) {
            case 0x90: { // Note On
              const note = msg[1]
              const vel = msg[2]
              const instId = useMidiStore.getState().activeInstrumentId
              if (!instId) break
              const kit = getKit(instId)
              const pool = host.voicePool(instId, 8, kit)
              if (vel === 0) {
                pool.noteOff(note)
              } else {
                // host.start() ensures the AudioContext is running.
                void host.start().then(() => { pool.noteOn(note, vel) })
              }
              break
            }
            case 0x80: { // Note Off
              const instId = useMidiStore.getState().activeInstrumentId
              if (!instId) break
              const kit = getKit(instId)
              host.voicePool(instId, 8, kit).noteOff(msg[1])
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
