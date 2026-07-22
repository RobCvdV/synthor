/**
 * Effect command definitions — pure data, no dependencies.
 *
 * Classic tracker effects use a 3-nibble format:
 *   effect type (0-F) + operand x (0-F) + operand y (0-F)
 *
 * The effect value is stored as a packed 12-bit number (0x000–0xFFF):
 *   effect = type * 256 + operand
 * where operand = x * 16 + y (or just an 8-bit value for non-xy effects).
 */

/** Effect type nibble (0x0 – 0xF). */
export const enum Eff {
  Arpeggio       = 0x0,
  PortaUp        = 0x1,
  PortaDown      = 0x2,
  Vibrato        = 0x4,
  Tremolo        = 0x7,
  SetPanning     = 0x8,
  VolumeSlide    = 0xA,
  PatternBreak   = 0xD,
}

export interface EffectDef {
  /** 3-character display name shown in the legend / tooltips. */
  name: string
  /** Short mnemonic for inline display. */
  mnemonic: string
  /** Human-readable description of what the effect does. */
  description: string
  /** How the operand is formatted: 'xy' splits into two nibbles, 'xx' is a single byte. */
  operandFormat: 'xy' | 'xx'
}

/** Registry of all supported effects. */
export const EFFECT_DEFS: Record<number, EffectDef> = {
  [Eff.Arpeggio]:     { name: 'Arpeggio',       mnemonic: 'Arp',  description: 'Cycle pitch: base, base+x, base+y',      operandFormat: 'xy' },
  [Eff.PortaUp]:      { name: 'Porta Up',       mnemonic: 'PoU',  description: 'Slide pitch up by xx each row',            operandFormat: 'xx' },
  [Eff.PortaDown]:    { name: 'Porta Down',     mnemonic: 'PoD',  description: 'Slide pitch down by xx each row',          operandFormat: 'xx' },
  [Eff.Vibrato]:      { name: 'Vibrato',        mnemonic: 'Vib',  description: 'Oscillate pitch — speed x, depth y',      operandFormat: 'xy' },
  [Eff.Tremolo]:      { name: 'Tremolo',        mnemonic: 'Trm',  description: 'Oscillate volume — speed x, depth y',     operandFormat: 'xy' },
  [Eff.SetPanning]:   { name: 'Set Panning',    mnemonic: 'Pan',  description: 'Stereo position: 00=left, 80=center, FF=right', operandFormat: 'xx' },
  [Eff.VolumeSlide]:  { name: 'Volume Slide',   mnemonic: 'VSl',  description: 'Slide volume up (x) or down (y) each row', operandFormat: 'xy' },
  [Eff.PatternBreak]: { name: 'Pattern Break',  mnemonic: 'Brk',  description: 'Jump to row xx of next pattern',           operandFormat: 'xx' },
}

/** Pack an effect type + operand into a single 12-bit value. */
export function packEffect(type: number, operand: number): number {
  return (type << 8) | (operand & 0xFF)
}

/** Unpack an effect value into its type nibble. */
export function effectType(value: number): number {
  return (value >> 8) & 0xF
}

/** Unpack an effect value into its operand byte. */
export function effectOperand(value: number): number {
  return value & 0xFF
}

/** Split an operand byte into x (high nibble) and y (low nibble). */
export function operandXY(operand: number): { x: number; y: number } {
  return { x: (operand >> 4) & 0xF, y: operand & 0xF }
}

/** Effect value as a tracker-style 3-char display string. */
export function effectDisplay(value: number): string {
  const type = effectType(value)
  const op = effectOperand(value)
  const typeHex = type.toString(16).toUpperCase()
  const opHex = op.toString(16).toUpperCase().padStart(2, '0')
  return `${typeHex}${opHex}`
}
