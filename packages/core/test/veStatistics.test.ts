import { describe, expect, it } from 'vitest';
import { cellsToFix, DEFAULT_STAT_OPTIONS, findPacketByDelay, veStatistics } from '../src/index.js';

const X = [500, 1000, 1500, 2000];
const Y = [20, 40, 60];
const opt = { ...DEFAULT_STAT_OPTIONS, minData: 3, maxVariance: 5, varianceMultiplier: 0, weighted: false };

describe('veStatistics (RTDataStat)', () => {
  it('findPacketByDelay picks the nearest packet in the delay direction', () => {
    const t = [0, 100, 200, 300, 400];
    expect(findPacketByDelay(t, 1, 0)).toBe(1);
    expect(findPacketByDelay(t, 1, 140)).toBe(2);
    expect(findPacketByDelay(t, 1, 160)).toBe(3);
    expect(findPacketByDelay(t, 3, -190)).toBe(1);
    expect(findPacketByDelay(t, 4, 50)).toBe(-1);
  });

  it('bins samples, counts dropped/out-of-range and averages per cell', () => {
    const s = [
      { rpm: 1000, load: 40, pass: true, value: 52 },
      { rpm: 1010, load: 41, pass: true, value: 54 },
      { rpm: 990, load: 39, pass: false, value: 99 },
      { rpm: 9000, load: 40, pass: true, value: 50 },
    ];
    const r = veStatistics(X, Y, s, opt);
    const c = r.cells[1 * 4 + 1]!;
    expect(c).toMatchObject({ n: 2, dropped: 1, min: 52, max: 54, mean: 53 });
    expect(r).toMatchObject({ total: 4, outOfRange: 1, dropped: 1 });
  });

  it('centre weighting: border samples count half', () => {
    const s = [
      { rpm: 1000, load: 40, pass: true, value: 60 }, // centre: w = 1·1
      { rpm: 750, load: 40, pass: true, value: 30 }, // rpm on the lower border: w = 0.5
    ];
    const r = veStatistics(X, Y, s, { ...opt, weighted: true });
    // 750 belongs to cell x=1 (border 750 → next cell), weights 1 and 0.5
    expect(r.cells[5]!.mean).toBeCloseTo((60 + 0.5 * 30) / 1.5);
  });

  it('outlier filtering keeps mean ± m·σ', () => {
    const vals = [50, 50, 51, 49, 50, 50, 80];
    const s = vals.map((value) => ({ rpm: 1000, load: 40, pass: true, value }));
    const r = veStatistics(X, Y, s, { ...opt, varianceMultiplier: 1.5 });
    expect(r.cells[5]).toMatchObject({ n: 6, outliers: 1, mean: 50 });
    expect(r.outliers).toBe(1);
  });

  it('cellsToFix requires Min. data and σ ≤ Max. variance', () => {
    const s = [50, 52, 54].map((value) => ({ rpm: 1000, load: 40, pass: true, value }));
    const r = veStatistics(X, Y, s, opt);
    expect(cellsToFix(r, [5, 6], opt)).toEqual([{ i: 5, value: 52 }]);
    expect(cellsToFix(r, [5], { ...opt, maxVariance: 1 })).toEqual([]);
    expect(cellsToFix(r, [5], { ...opt, minData: 4 })).toEqual([]);
  });
});

describe('veStatistics uneven bins', () => {
  it('never returns NaN: negative weights are clamped, all-zero falls back to the plain mean', () => {
    // load bins 58, 70, 100: cell 70 has lower half 6 and upper half 15 → load 84 would weigh < 0
    const r = veStatistics([500, 1000], [58, 70, 100], [{ rpm: 1000, load: 84, pass: true, value: 150 }], {
      ...DEFAULT_STAT_OPTIONS,
      varianceMultiplier: 0,
    });
    expect(r.cells[1 * 2 + 1]).toMatchObject({ n: 1, mean: 150, sd: 0 });
  });
});
