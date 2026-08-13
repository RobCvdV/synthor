import type { EffectSettingKey, Instrument } from '../domain/types'
import { DEFAULT_EFFECT_SETTINGS } from '../domain/types'
import { useDocStore } from '../state/docStore'

/** Discrete preset options per setting. */
const SETTING_OPTIONS: Record<EffectSettingKey, { label: string; unit: string; values: number[] }> = {
  vibratoRate:  { label: 'Vib Rate Max',  unit: 'Hz', values: [25, 50, 100, 200, 500, 1000] },
  vibratoDepth: { label: 'Vib Depth Max', unit: 'st', values: [1, 2, 6, 12, 24, 48] },
  tremoloRate:  { label: 'Trm Rate Max',  unit: 'Hz', values: [25, 50, 100, 200, 500, 1000] },
  tremoloDepth: { label: 'Trm Depth Max', unit: '×',  values: [1, 2] },
  portamento:   { label: 'Porta Max',     unit: 'st', values: [1, 2, 6, 12, 24, 48] },
}

interface Props {
  inst: Instrument
  usage: number
  onDuplicate: () => void
  onExport: () => void
  onDelete: () => void
}

/** Settings pane for an instrument: name, actions, and effect range presets. */
export function InstrumentSettings({ inst, usage, onDuplicate, onExport, onDelete }: Props) {
  const renameInstrument = useDocStore((s) => s.renameInstrument)
  const setEffectSetting = useDocStore((s) => s.setEffectSetting)

  const effectSettings = inst.kind !== 'drumkit' ? inst.effectSettings : undefined
  const settingKeys = Object.keys(DEFAULT_EFFECT_SETTINGS) as EffectSettingKey[]

  return (
    <aside className="inst-settings">
      <div className="inst-settings-head">
        <input
          className="inst-name-input"
          value={inst.name}
          onChange={(e) => renameInstrument(inst.id, e.target.value)}
        />
        <span className="muted">{inst.kind === 'drumkit' ? 'Drum Kit' : 'Synth'}</span>
        <div className="inst-settings-actions">
          <button title="Duplicate this instrument" onClick={onDuplicate}>
            Duplicate
          </button>
          <button onClick={onExport}>Export</button>
          <button
            disabled={usage > 0}
            title={usage > 0 ? 'In use by a track — reassign first' : 'Delete instrument'}
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="inst-settings-body">
        <h4>Effect Ranges</h4>
        {inst.kind !== 'drumkit' ? (
          <>
            {settingKeys.map((key) => {
              const opts = SETTING_OPTIONS[key]
              const current = effectSettings?.[key] ?? DEFAULT_EFFECT_SETTINGS[key]
              return (
                <div key={key} className="inst-setting-row">
                  <span className="inst-setting-label" title={key}>{opts.label}</span>
                  <select
                    className="inst-setting-select"
                    value={current}
                    onChange={(e) => setEffectSetting(inst.id, key, Number(e.target.value))}
                  >
                    {opts.values.map((v) => (
                      <option key={v} value={v}>{v} {opts.unit}</option>
                    ))}
                  </select>
                </div>
              )
            })}
          </>
        ) : (
          <p className="muted hint">Effect ranges are set on each sub-instrument. Select a sub‑instrument in the rail to edit its ranges.</p>
        )}
      </div>
    </aside>
  )
}
