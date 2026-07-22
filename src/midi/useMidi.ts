import { useEffect } from 'react'
import { useMidiStore } from '../state/midiStore'
import { usePreviewStore } from '../state/previewStore'
import type { AudioHost } from '../audio/host'

/**
 * Connects to the Web MIDI API and routes incoming messages.
 *
 * - Note On  (0x9_) → preview note-on with velocity
 * - Note Off (0x8_) → preview note-off
 * - Control Change (0xB_) → midiStore CC values
 * - Pitch Bend  (0xE_) → midiStore pitch bend (-1…+1)
 */
export function useMidi(host: AudioHost) {
  const setInputs = useMidiStore((s) => s.setInputs)
  const setSelectedInput = useMidiStore((s) => s.setSelectedInput)
  const setConnected = useMidiStore((s) => s.setConnected)
  const setCc = useMidiStore((s) => s.setCcValue)
  const setPitchBend = useMidiStore((s) => s.setPitchBend)
  const noteOn = usePreviewStore((s) => s.noteOn)
  const noteOff = usePreviewStore((s) => s.noteOff)

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
              if (vel === 0) {
                noteOff(note)
              } else {
                void host.start().then(() => noteOn(instId, note, vel))
              }
              break
            }
            case 0x80: { // Note Off
              noteOff(msg[1])
              break
            }
            case 0xb0: { // Control Change
              setCc(msg[1], msg[2])
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
