import { describe, expect, it } from 'vitest';
import { DEFAULT_ANALYZER_SETTINGS, LiveVeAnalyzer } from '../src/index.js';

const X = [500, 1000, 1500, 2000];
const Y = [20, 40, 60];
const make = (over = {}) =>
  new LiveVeAnalyzer(X, Y, new Array(12).fill(50), { ...DEFAULT_ANALYZER_SETTINGS, minData: 3, ...over });

describe('LiveVeAnalyzer (RTLiveAnalyzer)', () => {
  it('bins: midpoint borders, mirrored table edges, tolerance around the centre', () => {
    const a = make({ rpmTolerance: 100, loadTolerance: 100 });
    expect(a.locate(1000, 40)).toEqual({ x: 1, y: 1 });
    expect(a.locate(1249, 49)).toEqual({ x: 1, y: 1 });
    expect(a.locate(1250, 51)).toEqual({ x: 2, y: 2 }); // border → next cell
    expect(a.locate(2501, 40)).toBe('outside'); // edge = 2·2000 − 1500
    expect(a.locate(250, 0)).toEqual({ x: 0, y: 0 });
    const b = make({ rpmTolerance: 50 });
    expect(b.locate(1125, 40)).toEqual({ x: 1, y: 1 });
    expect(b.locate(1130, 40)).toBe('off-center'); // centre 1000, half-cell 250 → ±125
  });

  it('settings rectangle limits the analysed area', () => {
    expect(make({ minRpm: 900 }).locate(500, 40)).toBe('outside');
  });

  it('collects Min.data samples, then tunes to the rounded mean; TUNED when stable', () => {
    const a = make();
    const step = (v: number) => a.process(1000, 40, 1, () => v);
    expect(step(53).message).toBe('Collecting data');
    expect(step(54).message).toBe('Collecting data');
    const s3 = step(55);
    expect(s3.message).toBe('Tuning in progress');
    expect(s3.changes).toEqual([{ x: 1, y: 1, value: 54 }]);
    expect(a.tuned[1 * 4 + 1]).toBe(54);
    step(54);
    step(54);
    expect(step(54).message).toBe('TUNED');
    expect(a.state[5]).toBe('tuned');
  });

  it('filter and too-high difference', () => {
    const a = make();
    expect(a.process(1000, 40, 0, () => 60).message).toBe('Filter failed!');
    for (let i = 0; i < 2; i++) a.process(1000, 40, 1, () => 70);
    expect(a.process(1000, 40, 1, () => 70).message).toBe('Too high difference!');
    expect(a.tuned[5]).toBe(50);
    expect(a.summary()).toMatchObject({ total: 4, filtered: 1, altered: 0 });
  });

  it('tune ahead to the right extrapolates into the next empty cell', () => {
    const a = make({ aheadRight: true });
    for (let i = 0; i < 3; i++) a.process(500, 40, 1, () => 52);
    for (let i = 0; i < 3; i++) a.process(1000, 40, 1, () => 54);
    expect(a.tuned[1 * 4 + 2]).toBe(56);
    expect(a.state[6]).toBe('ahead');
  });
});
