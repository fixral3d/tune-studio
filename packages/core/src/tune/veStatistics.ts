/**
 * VE Tune by statistics — RTDataStat (VemsTune 1.5.46, LOG-11).
 *
 * Re-implemented from re/ghidra/out/RTDataStat.* and LogHistoryMgr.findPacketByDelay:
 *  findPacketByDelay  packet whose time is nearest to time(i) + delay (searching forward for a
 *                     positive delay, backward for a negative one); −1 past the log ends.
 *  insertIntoMatrix   sample outside the table edges → "Out of Range"; cell = same borders as the
 *                     Live Analyzer (first rpm border > rpm, load borders top-down); filter failed →
 *                     per-cell "dropped"; otherwise the value is stored with a weight
 *                     w = w(rpm)·w(load), each axis 0.5 + (1 − |v − centre| / |centre − lower border|) / 2.
 *  doOutLierFiltering per cell: mean, sample variance (n−1); multiplier m > 0 keeps
 *                     mean ± m·σ, the rest are "outliers"; kept values feed a weighted mean/variance.
 *  fixSelectedCells   VE = weighted mean when count ≥ Min. # of data and σ ≤ Max. variance.
 * Constants 0.5 / 2.0 read from the binary (_DAT_010e7478 / _DAT_010e7470).
 */

export interface VeStatOptions {
  /** 0 disables outlier filtering ("Apply 0 to disable outlier filtering"). */
  varianceMultiplier: number;
  minData: number;
  /** compared with the weighted standard deviation of the cell (as fixSelectedCells does) */
  maxVariance: number;
  /** distance-to-centre weighting (RTDataStat flag +0x1ef) */
  weighted: boolean;
}

export const DEFAULT_STAT_OPTIONS: VeStatOptions = { varianceMultiplier: 2, minData: 10, maxVariance: 5, weighted: true };

export interface VeStatSample {
  rpm: number;
  load: number;
  /** filter result > 0 */
  pass: boolean;
  /** expression value (corrected VE) */
  value: number;
}

export interface VeCellStat {
  /** values kept after outlier filtering */
  n: number;
  dropped: number;
  outliers: number;
  min: number;
  max: number;
  /** weighted mean of the kept values */
  mean: number;
  /** weighted standard deviation of the kept values */
  sd: number;
  /** every value that passed the filter (before outlier filtering) — for the histogram */
  values: number[];
}

export interface VeStatResult {
  cells: (VeCellStat | undefined)[];
  total: number;
  dropped: number;
  outliers: number;
  outOfRange: number;
}

/** LogHistoryMgr::findPacketByDelay — times in ms, delay in ms. */
export function findPacketByDelay(times: number[], i: number, delayMs: number): number {
  if (!delayMs) return i;
  if (i < 0 || i >= times.length) return -1;
  const target = times[i]! + delayMs;
  let j = i;
  let best = Math.abs(times[i]! - target);
  if (delayMs > 0) {
    for (;;) {
      if (j + 1 >= times.length) return -1;
      const d = Math.abs(times[j + 1]! - target);
      const passed = times[j + 1]! >= target;
      if (passed) return d < best ? j + 1 : j;
      j++;
      best = d;
    }
  }
  for (;;) {
    if (j === 0) return -1;
    const d = Math.abs(times[j - 1]! - target);
    const passed = times[j - 1]! <= target;
    if (passed) return d < best ? j - 1 : j;
    j--;
    best = d;
  }
}

function axis(bins: number[]) {
  const b = bins.map(Math.round);
  const n = b.length;
  const mids: number[] = [];
  for (let i = 0; i < n - 1; i++) mids.push(Math.trunc((b[i]! + b[i + 1]!) / 2));
  return { b, mids, min: n > 1 ? 2 * b[0]! - b[1]! : b[0]!, max: n > 1 ? 2 * b[n - 1]! - b[n - 2]! : b[0]! };
}

/** Per-cell statistics of a log (RTDataStat evaluate). Cells are indexed y*xlen + x. */
export function veStatistics(xBins: number[], yBins: number[], samples: VeStatSample[], opt: VeStatOptions): VeStatResult {
  const X = axis(xBins);
  const Y = axis(yBins);
  const xlen = xBins.length;
  const raw: { v: number; w: number }[][] = Array.from({ length: xlen * yBins.length }, () => []);
  const dropped = new Array<number>(raw.length).fill(0);
  let outOfRange = 0;
  const weight = (ax: ReturnType<typeof axis>, i: number, v: number) => {
    const c = ax.b[i]!;
    const border = i === 0 ? ax.min : ax.mids[i - 1]!;
    const half = Math.abs(c - border);
    // VemsTune measures only against the lower border, so with uneven bins a sample above the
    // centre can get a negative weight; clamp at 0 (deviation, see LIVE-VE-ANALYZER.md)
    return half ? Math.max(0, 0.5 + (1 - Math.abs(v - c) / half) / 2) : 1;
  };

  for (const s of samples) {
    const rpm = Math.round(s.rpm);
    const load = s.load;
    if (rpm > X.max || rpm < X.min || load > Y.max || load < Y.min) {
      outOfRange++;
      continue;
    }
    let x = X.mids.findIndex((m) => rpm < m);
    if (x < 0) x = xlen - 1;
    let y = 0;
    for (const m of Y.mids) if (m < load) y++;
    const i = y * xlen + x;
    if (!s.pass) {
      dropped[i]!++;
      continue;
    }
    raw[i]!.push({ v: s.value, w: opt.weighted ? weight(X, x, rpm) * weight(Y, y, load) : 1 });
  }

  let totalDropped = 0;
  let totalOutliers = 0;
  const cells = raw.map((vals, i) => {
    totalDropped += dropped[i]!;
    if (!vals.length) return dropped[i] ? { n: 0, dropped: dropped[i]!, outliers: 0, min: NaN, max: NaN, mean: NaN, sd: NaN, values: [] } : undefined;
    const n = vals.length;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const { v } of vals) {
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const mean = sum / n;
    let ss = 0;
    for (const { v } of vals) ss += (v - mean) ** 2;
    const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
    const m = opt.varianceMultiplier;
    const kept = m > 0 ? vals.filter(({ v }) => v >= mean - m * sd && v <= mean + m * sd) : vals;
    const outliers = n - kept.length;
    totalOutliers += outliers;
    let sw = 0;
    let swv = 0;
    for (const { v, w } of kept) {
      sw += w;
      swv += w * v;
    }
    // all weights 0 (every sample on the far side of uneven bins) → plain mean
    const ws = sw > 0 ? kept : kept.map(({ v }) => ({ v, w: 1 }));
    if (sw <= 0) {
      sw = ws.length;
      swv = ws.reduce((a, { v }) => a + v, 0);
    }
    const wmean = sw ? swv / sw : NaN;
    let swd = 0;
    for (const { v, w } of ws) swd += w * (v - wmean) ** 2;
    return {
      n: kept.length,
      dropped: dropped[i]!,
      outliers,
      min,
      max,
      mean: wmean,
      sd: sw ? Math.sqrt(swd / sw) : NaN,
      values: vals.map(({ v }) => v),
    };
  });
  return { cells, total: samples.length, dropped: totalDropped + totalOutliers, outliers: totalOutliers, outOfRange };
}

/** fixSelectedCells: cells (indices) that qualify and their new value (rounded to `digits`). */
export function cellsToFix(res: VeStatResult, indices: number[], opt: VeStatOptions, digits = 0): { i: number; value: number }[] {
  const k = 10 ** digits;
  return indices.flatMap((i) => {
    const c = res.cells[i];
    if (!c || c.n < Math.max(1, opt.minData) || !(c.sd <= opt.maxVariance) || !Number.isFinite(c.mean)) return [];
    return [{ i, value: Math.round(c.mean * k) / k }];
  });
}
