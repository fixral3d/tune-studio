/**
 * Live VE Analyzer — RTLiveAnalyzer (VemsTune 1.5.46, Tools ▸ Live VE Analyzer, LOG-15).
 *
 * Re-implemented from the decompiles in re/ghidra/out/RTLiveAnalyzer.*:
 *  getBins       cell borders = integer midpoints of neighbouring bins; table edge
 *                = first/last bin mirrored (2·b0 − b1, 2·bN − bN−1).
 *  processData   sample outside the table edges or the Settings rectangle → outlier;
 *                cell = bin whose borders contain the sample; outside center ± tolerance%
 *                of the half-cell → outlier ("NOT IN CENTER!"); filter ≤ 0 → filtered.
 *  updateMatrix  accumulate the expression value per cell; count < Min.data → "Collecting data";
 *                every Min.data-th sample: mean = round(mean of all values),
 *                diff = mean − original VE outside [−maxNeg, +maxPos] → "Too high difference!",
 *                else tuned VE = mean (written when AutoTune), TUNED when within
 *                Tuning precision % of the previous mean, else "Tuning in progress"; then tuneAhead.
 *  tuneAhead     Right / Up: two tuned cells → linear extrapolation into the next empty cell
 *                (same max-change limits).
 * Default expression/filter come from config/expressiondb.db (default_expression / default_filter).
 */

export const VE_EXPRESSION = '(veCurr * egoCorrection * lambda) / (lambdatarget * 100)';
export const VE_FILTER = '(pulseWidth > 0) && (lambda < 1.285) && (lambda > 0.1) && (coolant > 70)';

export interface LiveAnalyzerSettings {
  /** Settings rectangle; undefined = whole table (VemsTune stores -1). */
  minRpm?: number;
  maxRpm?: number;
  minLoad?: number;
  maxLoad?: number;
  /** % of the half-cell around the bin centre that is accepted. */
  rpmTolerance: number;
  loadTolerance: number;
  minData: number;
  /** % — consecutive means closer than this mark the cell TUNED. */
  precision: number;
  /** absolute VE change limits per cell */
  maxPos: number;
  maxNeg: number;
  aheadRight: boolean;
  aheadUp: boolean;
}

export const DEFAULT_ANALYZER_SETTINGS: LiveAnalyzerSettings = {
  rpmTolerance: 50,
  loadTolerance: 50,
  minData: 10,
  precision: 2,
  maxPos: 8,
  maxNeg: 4,
  aheadRight: false,
  aheadUp: false,
};

export type CellState = 'empty' | 'collecting' | 'progress' | 'tuned' | 'toohigh' | 'ahead';
export type AnalyzerMessage =
  | 'Filter failed!'
  | 'NOT IN CENTER!'
  | 'outside'
  | 'Collecting data'
  | 'Tuning in progress'
  | 'TUNED'
  | 'Too high difference!';

export interface AnalyzerStep {
  message: AnalyzerMessage;
  cell?: { x: number; y: number };
  /** cells whose tuned value changed in this step (to write when AutoTune is on) */
  changes: { x: number; y: number; value: number }[];
}

/** [lo, hi] border of every cell plus the centres, from ascending bins (getBins). */
function borders(bins: number[]) {
  const b = bins.map(Math.round);
  const n = b.length;
  const mids: number[] = [];
  for (let i = 0; i < n - 1; i++) mids.push(Math.trunc((b[i]! + b[i + 1]!) / 2));
  const min = n > 1 ? 2 * b[0]! - b[1]! : b[0]!;
  const max = n > 1 ? 2 * b[n - 1]! - b[n - 2]! : b[0]!;
  return { b, mids, min, max };
}

export class LiveVeAnalyzer {
  readonly xlen: number;
  readonly ylen: number;
  readonly tuned: number[];
  readonly count: number[];
  readonly state: CellState[];
  readonly skip: boolean[];
  readonly stats = { total: 0, outliers: 0, filtered: 0 };
  private sum: number[];
  private prev: number[];
  private altered: boolean[];
  private x;
  private y;

  constructor(
    xBins: number[],
    yBins: number[],
    /** original table, index y*xlen + x */
    readonly original: number[],
    public settings: LiveAnalyzerSettings = DEFAULT_ANALYZER_SETTINGS,
  ) {
    this.xlen = xBins.length;
    this.ylen = yBins.length;
    this.x = borders(xBins);
    this.y = borders(yBins);
    const n = this.xlen * this.ylen;
    this.tuned = original.slice(0, n);
    this.count = new Array(n).fill(0);
    this.sum = new Array(n).fill(0);
    this.prev = new Array(n).fill(-100); // RTLiveAnalyzer ctor: VemsMatrix_fill(prev, -100)
    this.altered = new Array(n).fill(false);
    this.state = new Array(n).fill('empty');
    this.skip = new Array(n).fill(false);
  }

  /** Cell index for a rounded rpm/load, or undefined when it is an outlier. */
  locate(rpm: number, load: number): { x: number; y: number } | 'outside' | 'off-center' {
    const r = Math.round(rpm);
    const l = Math.round(load);
    const s = this.settings;
    if (r < this.x.min || r > this.x.max || l < this.y.min || l > this.y.max) return 'outside';
    if ((s.minRpm !== undefined && r < s.minRpm) || (s.maxRpm !== undefined && r > s.maxRpm)) return 'outside';
    if ((s.minLoad !== undefined && l < s.minLoad) || (s.maxLoad !== undefined && l > s.maxLoad)) return 'outside';
    // rpm: first border greater than the value (rpm == border → next cell)
    let x = this.x.mids.findIndex((m) => r < m);
    if (x < 0) x = this.xlen - 1;
    // load (searched top-down in VemsTune): highest border strictly below the value
    let y = 0;
    for (const m of this.y.mids) if (m < l) y++;
    if (!this.inCenter(this.x, x, r, s.rpmTolerance) || !this.inCenter(this.y, y, l, s.loadTolerance)) return 'off-center';
    return { x, y };
  }

  private inCenter(ax: ReturnType<typeof borders>, i: number, v: number, tol: number): boolean {
    const n = ax.b.length;
    const c = ax.b[i]!;
    const lo = i === 0 ? ax.min : ax.mids[i - 1]!;
    const hi = i === n - 1 ? ax.max : ax.mids[i]!;
    const k = tol / 100;
    return v >= c - Math.round((c - lo) * k) && v <= c + Math.round((hi - c) * k);
  }

  /** One realtime sample: `filter` > 0 passes; `value` is the expression result (corrected VE). */
  process(rpm: number, load: number, filter: number, value: () => number): AnalyzerStep {
    this.stats.total++;
    const at = this.locate(rpm, load);
    if (at === 'outside' || at === 'off-center') {
      this.stats.outliers++;
      return { message: at === 'outside' ? 'outside' : 'NOT IN CENTER!', changes: [] };
    }
    if (!(filter > 0)) {
      this.stats.filtered++;
      return { message: 'Filter failed!', cell: at, changes: [] };
    }
    return this.update(at.x, at.y, value());
  }

  private update(x: number, y: number, v: number): AnalyzerStep {
    const i = y * this.xlen + x;
    const cell = { x, y };
    const changes: AnalyzerStep['changes'] = [];
    if (this.skip[i] || !Number.isFinite(v)) return { message: 'Collecting data', cell, changes };
    this.sum[i] = this.sum[i]! + v;
    const cnt = ++this.count[i]!;
    const min = Math.max(1, this.settings.minData);
    if (cnt < min) {
      this.state[i] = 'collecting';
      return { message: 'Collecting data', cell, changes };
    }
    if (cnt % min !== 0) return { message: this.state[i] === 'tuned' ? 'TUNED' : 'Tuning in progress', cell, changes };

    const mean = Math.round(this.sum[i]! / cnt);
    const diff = mean - this.original[i]!;
    if (diff > this.settings.maxPos || diff < -this.settings.maxNeg) {
      this.state[i] = 'toohigh';
      return { message: 'Too high difference!', cell, changes };
    }
    this.altered[i] = true;
    if (this.tuned[i] !== mean) changes.push({ x, y, value: mean });
    this.tuned[i] = mean;
    const prev = this.prev[i]!;
    const tol = Math.round((this.settings.precision * prev) / 100);
    let message: AnalyzerMessage = 'Tuning in progress';
    this.state[i] = 'progress';
    if (tol >= 0 && mean >= prev - tol && mean <= prev + tol) {
      this.state[i] = 'tuned';
      message = 'TUNED';
    }
    this.prev[i] = mean;
    changes.push(...this.tuneAhead(x, y));
    return { message, cell, changes };
  }

  /** Right: (x-1,y),(x,y) tuned → (x+1,y); Up: (x,y-1),(x,y) tuned → (x,y+1). Target must be empty. */
  private tuneAhead(x: number, y: number): AnalyzerStep['changes'] {
    const out: AnalyzerStep['changes'] = [];
    const s = this.settings;
    const tryAhead = (ax: number[], a: number, b: number, t: number, ia: number, ib: number, it: number) => {
      if (!this.altered[ia] || !this.altered[ib] || this.count[it] !== 0 || this.skip[it]) return;
      const x1 = ax[a]!;
      const x2 = ax[b]!;
      const v = x2 === x1 ? this.tuned[ib]! : this.tuned[ia]! + ((this.tuned[ib]! - this.tuned[ia]!) * (ax[t]! - x1)) / (x2 - x1);
      const val = Math.round(v);
      const diff = val - this.original[it]!;
      if (diff > s.maxPos || diff < -s.maxNeg) return;
      this.tuned[it] = val;
      this.state[it] = 'ahead';
      out.push({ x: it % this.xlen, y: Math.floor(it / this.xlen), value: val });
    };
    const w = this.xlen;
    if (s.aheadRight && x > 0 && x < w - 1) tryAhead(this.x.b, x - 1, x, x + 1, y * w + x - 1, y * w + x, y * w + x + 1);
    if (s.aheadUp && y > 0 && y < this.ylen - 1)
      tryAhead(this.y.b, y - 1, y, y + 1, (y - 1) * w + x, y * w + x, (y + 1) * w + x);
    return out;
  }

  /** Statistics tab: altered cells and their average / maximum change from the original. */
  summary() {
    let altered = 0;
    let sumAbs = 0;
    let maxAbs = 0;
    this.tuned.forEach((v, i) => {
      const d = Math.abs(v - this.original[i]!);
      if (d > 0) {
        altered++;
        sumAbs += d;
        maxAbs = Math.max(maxAbs, d);
      }
    });
    return { ...this.stats, altered, avgChange: altered ? sumAbs / altered : 0, maxChange: maxAbs };
  }

  toggleSkip(x: number, y: number): void {
    const i = y * this.xlen + x;
    this.skip[i] = !this.skip[i];
  }
}
