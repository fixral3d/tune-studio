/**
 * Analog input (MCP3208) two-point calibration — VemsTune AnalogInputCalibrationCalculator (CAL-03).
 * Firmware: value = scale·mult/4096·adc + offset·offsetMult, multiplier codes 0..3 = ×0.1, ×1, ×2, ×10.
 */

export const ANALOG_CAL_CHANNELS = [0, 1, 2, 5, 6, 7] as const;
/** multiplier code → factor (INI "/ 10","x1","x2","x10") */
export const ANALOG_CAL_MULT = [0.1, 1, 2, 10] as const;
const EPSILON = 1e-6;
/** full-scale ADC voltage; the wizard divides the entered volts by this */
const VREF = 5;

export interface AnalogCalResult {
  /** value at full scale (5 V) */
  slope: number;
  /** value at 0 V */
  intercept: number;
  scale: number;
  mult: number;
  offset: number;
  offsetMult: number;
}

/** x87 FIST in the default round-to-nearest-even mode */
function roundEven(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** getTranslationA: slope → (scale 0..255, mult code); undefined outside 0..2550. */
export function translationA(v: number): { value: number; mult: number } | undefined {
  if (!(v >= 0 && v <= 2550)) return undefined;
  if (v <= 25.5) return { value: roundEven(10 * v), mult: 0 };
  if (v < 256) return { value: roundEven(v), mult: 1 };
  if (v < 512) return { value: roundEven(v / 2), mult: 2 };
  return { value: roundEven(v / 10), mult: 3 };
}

/** getTranslationB: intercept → (offset −127..127, mult code); undefined outside ±1270. */
export function translationB(v: number): { value: number; mult: number } | undefined {
  if (!(v >= -1270 && v <= 1270)) return undefined;
  // positive and negative branches use the same magnitude buckets (12.7 / 127 / 254, inclusive)
  const a = Math.abs(v);
  if (a <= 12.7) return { value: roundEven(10 * v), mult: 0 };
  if (a <= 127) return { value: roundEven(v), mult: 1 };
  if (a <= 254) return { value: roundEven(v / 2), mult: 2 };
  return { value: roundEven(v / 10), mult: 3 };
}

/** calculate(x1,y1,x2,y2) with x in volts; undefined when the points coincide or a value is out of range. */
export function calculateAnalogCal(v1: number, y1: number, v2: number, y2: number): AnalogCalResult | undefined {
  const x1 = v1 / VREF;
  const x2 = v2 / VREF;
  if (Math.abs(x1 - x2) < EPSILON || Math.abs(y1 - y2) < EPSILON) return undefined;
  const slope = (y1 - y2) / (x1 - x2);
  const intercept = y1 - slope * x1;
  const a = translationA(slope);
  const b = translationB(intercept);
  if (!a || !b) return undefined;
  return { slope, intercept, scale: a.value, mult: a.mult, offset: b.value, offsetMult: b.mult };
}

/** What the firmware computes from the written values at `volts`. */
export function analogCalValue(r: Pick<AnalogCalResult, 'scale' | 'mult' | 'offset' | 'offsetMult'>, volts: number): number {
  return ((r.scale * ANALOG_CAL_MULT[r.mult]!) / 4096) * ((volts / VREF) * 4096) + r.offset * ANALOG_CAL_MULT[r.offsetMult]!;
}
