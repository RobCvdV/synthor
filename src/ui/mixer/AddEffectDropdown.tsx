import { EFFECT_MODULE_TYPES, MODULE_DEFS } from '../../domain/moduleDefs'
import type { ModuleType } from '../../domain/types'
import { Select } from '../components/Select'

export function AddEffectDropdown({ existingTypes, onAdd }: { existingTypes: ModuleType[]; onAdd: (type: ModuleType) => void }) {
  const available = EFFECT_MODULE_TYPES.filter((t) => !existingTypes.includes(t))
  if (available.length === 0) return null
  return (
    <Select small block value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value as ModuleType) }}>
      <option value="">+ Add effect</option>
      {available.map((type) => <option key={type} value={type}>{MODULE_DEFS[type].label}</option>)}
    </Select>
  )
}
