import { describe, expect, it } from 'vitest';
import { analogCalValue, calculateAnalogCal, translationA, translationB } from '../src/index.js';

describe('analog input calibration (AnalogInputCalibrationCalculator)', () => {
  it('EGT amplifier example from the help: 0 V → 0, 5 V → 1195', () => {
    const r = calculateAnalogCal(0, 0, 5, 1195)!;
    expect(r.slope).toBeCloseTo(1195);
    // 119.5 rounds to even (x87 default) → 120, ×10
    expect(r).toMatchObject({ scale: 120, mult: 3, offset: 0, offsetMult: 0 });
  });

  it('pressure sensor 0.5 V → 0 bar, 4.5 V → 10 bar', () => {
    const r = calculateAnalogCal(0.5, 0, 4.5, 10)!;
    expect(r.slope).toBeCloseTo(12.5);
    expect(r.intercept).toBeCloseTo(-1.25);
    expect(r).toMatchObject({ scale: 125, mult: 0, offset: -12, offsetMult: 0 });
    expect(analogCalValue(r, 2.5)).toBeCloseTo(5, 0);
  });

  it('translation buckets match the decompiled bounds', () => {
    expect(translationA(25.5)).toEqual({ value: 255, mult: 0 });
    expect(translationA(255.5)).toEqual({ value: 256, mult: 1 });
    expect(translationA(300)).toEqual({ value: 150, mult: 2 });
    expect(translationA(600)).toEqual({ value: 60, mult: 3 });
    expect(translationA(-1)).toBeUndefined();
    expect(translationB(-12.7)).toEqual({ value: -127, mult: 0 });
    expect(translationB(-100)).toEqual({ value: -100, mult: 1 });
    expect(translationB(-200)).toEqual({ value: -100, mult: 2 });
    expect(translationB(1000)).toEqual({ value: 100, mult: 3 });
    expect(translationB(1271)).toBeUndefined();
  });

  it('rejects coincident points', () => {
    expect(calculateAnalogCal(1, 5, 1, 7)).toBeUndefined();
    expect(calculateAnalogCal(1, 5, 2, 5)).toBeUndefined();
  });
});
