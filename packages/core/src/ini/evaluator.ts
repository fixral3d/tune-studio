/**
 * Config-driven value evaluator: ties the field model + value codec + RPN engine
 * together so computed channels/constants resolve by name, lazily (forward refs
 * and Hidden-channel deps are allowed; INI-DIALECT.md §5.4).
 *
 * Reads realtime channels from a realtime block and config constants from page
 * buffers, then evaluates any `{expr}` field on demand.
 */
import type { VemsConfig } from './config.js';
import type { Field } from './field.js';
import { compileExpr, type ExprContext } from './expr.js';
import { arrayLength, readArray, readBits, readScalar } from './value.js';

/**
 * Menu/dialog condition (`{expr}` or a bare token like `0`): non-zero = true.
 * Missing condition → true; an unresolvable one (e.g. unknown symbol) → true.
 */
export function testCond(cond: string | undefined, ctx: ExprContext): boolean {
  if (cond === undefined) return true;
  try {
    return compileExpr(cond).evaluate(ctx) !== 0;
  } catch {
    return true;
  }
}

export interface EvaluatorSources {
  /** realtime block (for OutputChannels scalar/bits fields). */
  realtime?: Uint8Array;
  /** page buffers by page number (for Constants fields). */
  pages?: Map<number, Uint8Array>;
  /** extra named values (e.g. time, fw_major). */
  extra?: Record<string, number>;
  /** history provider for name[-N]. */
  getHistory?(name: string, back: number): number | undefined;
}

export class ConfigEvaluator implements ExprContext {
  private computing = new Set<string>();
  private memo = new Map<string, number>();

  constructor(
    private cfg: VemsConfig,
    private src: EvaluatorSources = {},
  ) {}

  /** Clear per-frame memo (call once per realtime frame). */
  reset(src?: EvaluatorSources): void {
    if (src) this.src = src;
    this.memo.clear();
    this.computing.clear();
  }

  getHistory(name: string, back: number): number | undefined {
    return this.src.getHistory?.(name, back);
  }

  getArray(name: string): number[] | undefined {
    const f = this.cfg.byName.get(name);
    if (f?.kind === 'array') {
      const buf = this.bufFor(f);
      if (buf) return readArray(buf, f);
    }
    return undefined;
  }

  private bufFor(f: Field): Uint8Array | undefined {
    if (f.realtime) return this.src.realtime;
    return this.src.pages?.get(f.page);
  }

  getValue(name: string): number | undefined {
    if (this.src.extra && name in this.src.extra) return this.src.extra[name];
    if (this.memo.has(name)) return this.memo.get(name);
    const f = this.cfg.byName.get(name);
    if (!f) return undefined;
    if (this.computing.has(name)) return 0; // cycle guard
    this.computing.add(name);
    let v: number | undefined;
    try {
      if (f.kind === 'computed') {
        v = compileExpr(f.expr).evaluate(this);
      } else if (f.kind === 'scalar') {
        const buf = this.bufFor(f);
        if (buf) v = readScalar(buf, f);
      } else if (f.kind === 'bits') {
        const buf = this.bufFor(f);
        if (buf) v = readBits(buf, f);
      } else if (f.kind === 'array') {
        v = undefined; // arrays accessed via getArray / interpolate2d
      }
    } finally {
      this.computing.delete(name);
    }
    if (v !== undefined) this.memo.set(name, v);
    return v;
  }

  /** Evaluate a single named channel/constant. */
  value(name: string): number | undefined {
    return this.getValue(name);
  }

  /** Evaluate every realtime channel into a record (skips ones that throw). */
  allRealtime(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const ch of this.cfg.channels) {
      try {
        const v = this.getValue(ch.name);
        if (v !== undefined) out[ch.name] = v;
      } catch {
        /* unresolved (e.g. missing dep) — skip */
      }
    }
    return out;
  }

  /** Count array fields (helper for tests/tools). */
  arrayFieldCount(): number {
    let c = 0;
    for (const f of this.cfg.byName.values()) if (f.kind === 'array') c += arrayLength(f) > 0 ? 1 : 0;
    return c;
  }
}
