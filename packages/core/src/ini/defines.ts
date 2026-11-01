/**
 * INI `#if` condition table, as VemsTune assembles it (MTConfigHelper::parseMTConfigData @0x6cc3d4):
 *   USE_SUPER_TABLE (always) + project session params (v3gui.cfg default CELSIUS=1)
 *   + FirmwareInfo detected params + the INI's own [Params] (handled by the preprocessor).
 *
 * Detected params (FirmwareInfo::fillDetectedParams @0x513a7a, setHighAndLowBoost @0x513bd6):
 *  - compile-option bits → names (table built in FirmwareInfo::FirmwareInfo @0x511c72)
 *  - signature substrings: 12x12 → 12X12; kpa=2,2|4,2 → HIGHBOOST; kpa=4,* → KPAUNIT_4;
 *    kpa=*,4 → KPACONFRES_4 (is12x12/isHighBoost/isKpaUnit_4/isKpaConfRes_4)
 * The option bits come from the .vemscfg `CompileOptions` header (hex, setFirmwareCompileOptions)
 * or, over TriggerFrame, from chars 24..25 of a 26–29 char firmware-options string
 * (FirmwareInfo::setFirmwareOptions @0x51326c).
 */

export const COMPILE_OPTION_BITS: [number, string][] = [
  [0x001, 'PS2KEYBOARD'],
  [0x002, 'N2O_RETARD'],
  [0x004, 'WARNING_BEEP'],
  [0x008, 'EXPENSIVE_MISC1OUT'],
  [0x010, 'EXPENSIVE_MISC2OUT'],
  [0x020, 'INJECTOR_DEADTIME_SIMPLE'],
  [0x040, 'INJECTOR_TRIM'],
  [0x080, 'KNOCK_ALTERNATIVE'],
  [0x100, 'TOYOTA_1JZ_VVTI'],
  [0x200, 'A340E'],
  [0x400, 'ALTERNATIVE_AE_DE_FILM'],
  [0x800, 'WOODGAS_CONTROLLER'],
];

/** Option word from a TF firmware-options string (chars 24 and 25, high byte first). */
export function optionsFromString(s: string | undefined): number | undefined {
  if (!s || s.length <= 0x19 || s.length >= 0x1e) return undefined;
  return ((s.charCodeAt(24) & 0xff) << 8) | (s.charCodeAt(25) & 0xff);
}

export interface FirmwareIdentity {
  /** MegaTune-style signature, e.g. "VEMS v1.2.34 16x14 kpa=2,2". */
  signature?: string;
  /** compile-option bit mask (CompileOptions header or optionsFromString). */
  options?: number;
}

/** Defines VemsTune derives from the connected/loaded firmware. */
export function firmwareDefines(fw: FirmwareIdentity): Set<string> {
  const out = new Set<string>();
  if (fw.options !== undefined) for (const [bit, name] of COMPILE_OPTION_BITS) if ((fw.options & bit) === bit) out.add(name);
  const s = fw.signature ?? '';
  if (s.includes('12x12') || s.includes('12X12')) out.add('12X12');
  if (s.includes('kpa=2,2') || s.includes('kpa=4,2')) out.add('HIGHBOOST');
  if (s.includes('kpa=4,1') || s.includes('kpa=4,2') || s.includes('kpa=4,4')) out.add('KPAUNIT_4');
  if (s.includes('kpa=2,4') || s.includes('kpa=4,4')) out.add('KPACONFRES_4');
  return out;
}

/** The full condition table for an INI load: always-on + session + firmware-detected. */
export function vemsTuneDefines(fw: FirmwareIdentity = {}, session: string[] = ['CELSIUS']): Set<string> {
  return new Set(['USE_SUPER_TABLE', ...session, ...firmwareDefines(fw)]);
}
