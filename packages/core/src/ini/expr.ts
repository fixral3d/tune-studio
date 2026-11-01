/**
 * RPNParser expression engine (INI-DIALECT.md §6; RPNParser::parseInfix
 * @0xd88194, infixToRpn @0xd88ae2, evaluate @0xd894d6).
 *
 * Faithful quirks:
 *  - identifiers continue with [A-Za-z0-9_\[\]-]; '-' is PART of the identifier,
 *    so `pulseWidth-lagtime` is ONE name → "variable not found" (not a subtraction);
 *    but an identifier ends right after ']' (`h1[0]-h1[1]` = h1[0] − h1[1]).
 *  - no hex, no exponent; '%' is not an operator (dropped); `mod` is a word op.
 *  - empty expression → 1.0 (empty {} = true).
 *  - bitwise & | ^ << >> truncate operands to int; && || yield 0/1.
 *  - `name[-N]` = value N samples ago (history).
 */

export interface ExprContext {
  /** current engineering value of a symbol; throw/return undefined if unknown. */
  getValue(name: string): number | undefined;
  /** value N samples ago for history index name[-N]. */
  getHistory?(name: string, back: number): number | undefined;
  /** resolve a Constants array symbol (for interpolate2d/3d). */
  getArray?(name: string): number[] | undefined;
  /** table("file.inc") lookup. */
  tableLookup?(file: string, x: number): number | undefined;
}

type Tok =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string }
  | { k: 'lp' }
  | { k: 'rp' }
  | { k: 'comma' };

const OPS2 = new Set(['&&', '||', '==', '!=', '<<', '>>', '<=', '>=']);

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  const prevAllowsUnary = () => {
    const p = toks[toks.length - 1];
    return !p || p.k === 'op' || p.k === 'lp' || p.k === 'comma';
  };
  while (i < n) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '(') {
      toks.push({ k: 'lp' });
      i++;
      continue;
    }
    if (c === ')') {
      toks.push({ k: 'rp' });
      i++;
      continue;
    }
    if (c === ',') {
      toks.push({ k: 'comma' });
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') j++;
      toks.push({ k: 'str', v: src.slice(i + 1, j) });
      i = j < n ? j + 1 : j;
      continue;
    }
    // negative literal: '-' at unary position followed by digit/'.'
    if (c === '-' && prevAllowsUnary() && i + 1 < n && /[0-9.]/.test(src[i + 1]!)) {
      let j = i + 1;
      while (j < n && /[0-9.]/.test(src[j]!)) j++;
      toks.push({ k: 'num', v: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j]!)) j++;
      toks.push({ k: 'num', v: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      // the identifier ends right after a ']' (parseInfix @0xd88194), so `a[0]-b[1]` is a subtraction
      let j = i + 1;
      while (j < n && src[j - 1] !== ']' && /[A-Za-z0-9_[\]-]/.test(src[j]!)) j++;
      const id = src.slice(i, j);
      i = j;
      if (id === 'mod') toks.push({ k: 'op', v: 'mod' });
      else toks.push({ k: 'id', v: id });
      continue;
    }
    // operators
    const two = src.slice(i, i + 2);
    if (OPS2.has(two)) {
      toks.push({ k: 'op', v: two });
      i += 2;
      continue;
    }
    if ('!&*+/:=?|~<>-^'.includes(c)) {
      toks.push({ k: 'op', v: c });
      i++;
      continue;
    }
    i++; // drop '%' . and anything else
  }
  return toks;
}

// ---- AST ----
type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'var'; name: string }
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'tern'; c: Node; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[]; state?: { sum?: number; latch?: number[] } };

const PREC: Record<string, number> = {
  '*': 140, '/': 140, mod: 140,
  '+': 130, '-': 130,
  '<<': 120, '>>': 120,
  '<': 110, '<=': 110, '>': 110, '>=': 110,
  '==': 100, '!=': 100,
  '&': 90, '^': 80, '|': 70,
  '&&': 60, '||': 50,
};

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}
  private peek() {
    return this.toks[this.p];
  }
  private next() {
    return this.toks[this.p++];
  }
  parse(): Node | undefined {
    if (this.toks.length === 0) return undefined;
    const n = this.ternary();
    return n;
  }
  private ternary(): Node {
    let c = this.binary(0);
    // left-associative ?: loop (matches shunting-yard equal-precedence pop)
    while (this.peek()?.k === 'op' && (this.peek() as { v: string }).v === '?') {
      this.next();
      const a = this.binary(0);
      if (this.peek()?.k === 'op' && (this.peek() as { v: string }).v === ':') this.next();
      const b = this.binary(0);
      c = { t: 'tern', c, a, b };
    }
    return c;
  }
  private binary(minPrec: number): Node {
    let left = this.unary();
    for (;;) {
      const tk = this.peek();
      if (!tk || tk.k !== 'op') break;
      const prec = PREC[tk.v];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.binary(prec + 1); // left-assoc
      left = { t: 'bin', op: tk.v, a: left, b: right };
    }
    return left;
  }
  private unary(): Node {
    const tk = this.peek();
    if (tk?.k === 'op' && (tk.v === '!' || tk.v === '~')) {
      this.next();
      return { t: 'un', op: tk.v, a: this.unary() };
    }
    return this.primary();
  }
  private primary(): Node {
    const tk = this.next();
    if (!tk) return { t: 'num', v: 0 };
    if (tk.k === 'num') return { t: 'num', v: tk.v };
    if (tk.k === 'str') return { t: 'str', v: tk.v };
    if (tk.k === 'lp') {
      const e = this.ternary();
      if (this.peek()?.k === 'rp') this.next();
      return e;
    }
    if (tk.k === 'id') {
      if (this.peek()?.k === 'lp') {
        this.next();
        const args: Node[] = [];
        if (this.peek()?.k !== 'rp') {
          args.push(this.ternary());
          while (this.peek()?.k === 'comma') {
            this.next();
            args.push(this.ternary());
          }
        }
        if (this.peek()?.k === 'rp') this.next();
        return { t: 'call', name: tk.v, args, state: {} };
      }
      return { t: 'var', name: tk.v };
    }
    return { t: 'num', v: 0 };
  }
}

const toInt = (x: number) => Math.trunc(x) | 0;

function interp(x0: number, x1: number, y0: number, y1: number, x: number): number {
  if (x1 === x0) return y0;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}
function interp1d(bins: number[], vals: number[], x: number): number {
  const n = Math.min(bins.length, vals.length);
  if (n === 0) return 0;
  if (x <= bins[0]!) return vals[0]!;
  if (x >= bins[n - 1]!) return vals[n - 1]!;
  for (let i = 1; i < n; i++) if (x <= bins[i]!) return interp(bins[i - 1]!, bins[i]!, vals[i - 1]!, vals[i]!, x);
  return vals[n - 1]!;
}

class Evaluator {
  constructor(private ctx: ExprContext) {}
  private resolveVar(name: string): number {
    const m = /^([^[]*)\[(-?\d+)\]$/.exec(name);
    if (m) {
      const base = m[1]!;
      const idx = parseInt(m[2]!, 10);
      if (idx < 0 && this.ctx.getHistory) {
        const v = this.ctx.getHistory(base, -idx);
        if (v !== undefined) return v;
      }
    }
    const v = this.ctx.getValue(name);
    if (v === undefined) throw new Error(`variable not found : ${name}`);
    return v;
  }
  eval(n: Node): number {
    switch (n.t) {
      case 'num':
        return n.v;
      case 'str':
        return 0;
      case 'var':
        return this.resolveVar(n.name);
      case 'un':
        return n.op === '!' ? (this.eval(n.a) === 0 ? 1 : 0) : ~toInt(this.eval(n.a));
      case 'tern':
        return this.eval(n.c) !== 0 ? this.eval(n.a) : this.eval(n.b);
      case 'bin':
        return this.binop(n.op, n.a, n.b);
      case 'call':
        return this.call(n);
    }
  }
  private binop(op: string, an: Node, bn: Node): number {
    const a = this.eval(an);
    const b = this.eval(bn);
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return a / b;
      case 'mod':
        if (b === 0) throw new Error('division by zero');
        return a % b;
      case '<': return a < b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
      case '==': return a === b ? 1 : 0;
      case '!=': return a !== b ? 1 : 0;
      case '&&': return a !== 0 && b !== 0 ? 1 : 0;
      case '||': return a !== 0 || b !== 0 ? 1 : 0;
      case '&': return toInt(a) & toInt(b);
      case '|': return toInt(a) | toInt(b);
      case '^': return toInt(a) ^ toInt(b);
      case '<<': return toInt(a) << toInt(b);
      case '>>': return toInt(a) >> toInt(b);
      default: return 0;
    }
  }
  private call(n: Extract<Node, { t: 'call' }>): number {
    const a = n.args;
    const ev = (i: number) => this.eval(a[i]!);
    switch (n.name) {
      case 'interpolate':
        return interp(ev(0), ev(1), ev(2), ev(3), ev(4));
      case 'interpolate2d': {
        const bins = this.arrArg(a[0]);
        const vals = this.arrArg(a[1]);
        return interp1d(bins, vals, ev(2));
      }
      case 'interpolate3d': {
        const xb = this.arrArg(a[0]);
        const yb = this.arrArg(a[1]);
        const tbl = this.arrArg(a[2]);
        const x = ev(3);
        const y = ev(4);
        // bilinear over row-major table (xb fast)
        const row = interp1dIndex(yb, y);
        const col = interp1dIndex(xb, x);
        const v00 = tbl[row.i * xb.length + col.i] ?? 0;
        const v01 = tbl[row.i * xb.length + col.j] ?? 0;
        const v10 = tbl[row.j * xb.length + col.i] ?? 0;
        const v11 = tbl[row.j * xb.length + col.j] ?? 0;
        const top = v00 + (v01 - v00) * col.f;
        const bot = v10 + (v11 - v10) * col.f;
        return top + (bot - top) * row.f;
      }
      case 'table': {
        const x = ev(0);
        const file = a[1]?.t === 'str' ? a[1].v : '';
        const v = this.ctx.tableLookup?.(file, x);
        if (v === undefined) throw new Error('table not found!');
        return v;
      }
      case 'switchCase8': {
        const sel = toInt(ev(0));
        if (sel < 0 || sel > 7) throw new Error('switchCase8 selector out of range');
        return ev(1 + sel);
      }
      case 'latch32': {
        const ch = toInt(ev(0));
        const en = ev(1);
        const val = ev(2);
        n.state!.latch ??= new Array(32).fill(0);
        if (en !== 0) n.state!.latch![ch] = val;
        return n.state!.latch![ch] ?? 0;
      }
      case 'floor': return Math.floor(ev(0));
      case 'ln': {
        const x = ev(0);
        if (x <= 0) throw new Error('ln domain');
        return Math.log(x);
      }
      case 'log2': {
        const x = ev(0);
        if (x <= 0) throw new Error('log2 domain');
        return Math.log2(x);
      }
      case 'exp': return Math.exp(ev(0));
      case 'sum': {
        n.state!.sum = (n.state!.sum ?? 0) + ev(0);
        return n.state!.sum;
      }
      case 'getGpsDistance':
      case 'getGpsCourse':
        return 0; // stateful GPS; wired later
      default:
        throw new Error(`unknown function : ${n.name}`);
    }
  }
  private arrArg(node: Node | undefined): number[] {
    if (node?.t === 'str') return this.ctx.getArray?.(node.v) ?? [];
    return [];
  }
}

function interp1dIndex(bins: number[], x: number): { i: number; j: number; f: number } {
  const n = bins.length;
  if (n === 0) return { i: 0, j: 0, f: 0 };
  if (x <= bins[0]!) return { i: 0, j: 0, f: 0 };
  if (x >= bins[n - 1]!) return { i: n - 1, j: n - 1, f: 0 };
  for (let k = 1; k < n; k++) {
    if (x <= bins[k]!) {
      const span = bins[k]! - bins[k - 1]!;
      return { i: k - 1, j: k, f: span === 0 ? 0 : (x - bins[k - 1]!) / span };
    }
  }
  return { i: n - 1, j: n - 1, f: 0 };
}

/** A compiled expression; keeps per-instance state for sum/latch32/gps. */
export class CompiledExpr {
  private ast: Node | undefined;
  constructor(public readonly source: string) {
    this.ast = new Parser(lex(source)).parse();
  }
  evaluate(ctx: ExprContext): number {
    if (!this.ast) return 1.0; // empty {} = true
    return new Evaluator(ctx).eval(this.ast);
  }
}

const cache = new Map<string, CompiledExpr>();
/** Compile with caching (RPNCache analogue); stateful nodes persist per source. */
export function compileExpr(source: string): CompiledExpr {
  let c = cache.get(source);
  if (!c) {
    c = new CompiledExpr(source);
    cache.set(source, c);
  }
  return c;
}

export function evalExpr(source: string, ctx: ExprContext): number {
  return new CompiledExpr(source).evaluate(ctx);
}
