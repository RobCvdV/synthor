import { EFFECT_MODULE_TYPES, MODULE_DEFS } from '../domain/moduleDefs'
import type { ModuleType } from '../domain/types'

export function AddEffectDropdown({ existingTypes, onAdd }: { existingTypes: ModuleType[]; onAdd: (type: ModuleType) => void }) {
  const available = EFFECT_MODULE_TYPES.filter((t) => !existingTypes.includes(t))
  if (available.length === 0) return null
  return (
    <select value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value as ModuleType) }}
      className="mixer-dropdown" style={{ fontSize: 9, width: '100%' }}>
      <option value="">+ Add effect</option>
      {available.map((type) => <option key={type} value={type}>{MODULE_DEFS[type].label}</option>)}
    </select>
  )
}
