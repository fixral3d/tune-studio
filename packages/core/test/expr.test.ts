import { describe, expect, it } from 'vitest';
import { CompiledExpr, evalExpr, type ExprContext } from '../src/index.js';

const ctx = (vars: Record<string, number>, extra: Partial<ExprContext> = {}): ExprContext => ({
  getValue: (n) => (n in vars ? vars[n] : undefined),
  ...extra,
});

describe('RPN expression engine', () => {
  it('arithmetic + precedence', () => {
    expect(evalExpr('1 + 2 * 3', ctx({}))).toBe(7);
    expect(evalExpr('(1 + 2) * 3', ctx({}))).toBe(9);
    expect(evalExpr('10 / 4', ctx({}))).toBe(2.5);
  });
  it('empty expression is true (1.0)', () => {
    expect(evalExpr('', ctx({}))).toBe(1);
    expect(evalExpr('   ', ctx({}))).toBe(1);
  });
  it('comparison, logical, bitwise', () => {
    expect(evalExpr('5 > 3 && 2 == 2', ctx({}))).toBe(1);
    expect(evalExpr('6 & 3', ctx({}))).toBe(2);
    expect(evalExpr('1 << 4', ctx({}))).toBe(16);
    expect(evalExpr('(boost_more_raw & 96) == 0', ctx({ boost_more_raw: 1 }))).toBe(1);
  });
  it('ternary (real distributed form)', () => {
    expect(evalExpr('rtdata == 1 ? -512 : rpmdiff0_raw', ctx({ rtdata: 1, rpmdiff0_raw: 7 }))).toBe(-512);
    expect(evalExpr('rtdata == 1 ? -512 : rpmdiff0_raw', ctx({ rtdata: 0, rpmdiff0_raw: 7 }))).toBe(7);
  });
  it('nested parenthesized ternary', () => {
    const e = '(a > 0) ? 1 : ((b > 0) ? 2 : 3)';
    expect(evalExpr(e, ctx({ a: 0, b: 5 }))).toBe(2);
    expect(evalExpr(e, ctx({ a: 0, b: 0 }))).toBe(3);
  });
  it('reads variables and resolves scale/translate style exprs', () => {
    expect(evalExpr('cltADC - 100', ctx({ cltADC: 120 }))).toBe(20);
    expect(evalExpr('engine_t_batt / 10.0', ctx({ engine_t_batt: 137 }))).toBeCloseTo(13.7);
  });

  it('TRAP: "boşluksuz eksi" makes one identifier → variable not found', () => {
    // pulseWidth-lagtime is ONE name in VemsTune, not a subtraction
    expect(() => evalExpr('pulseWidth-lagtime', ctx({ pulseWidth: 10, lagtime: 3 }))).toThrow(
      /variable not found/,
    );
    // with spaces it subtracts
    expect(evalExpr('pulseWidth - lagtime', ctx({ pulseWidth: 10, lagtime: 3 }))).toBe(7);
  });

  it('switchCase8 selects, throws out of range', () => {
    expect(evalExpr('switchCase8(2, 10,11,12,13,14,15,16,17)', ctx({}))).toBe(12);
    expect(() => evalExpr('switchCase8(9, 0,0,0,0,0,0,0,0)', ctx({}))).toThrow();
  });
  it('interpolate', () => {
    expect(evalExpr('interpolate(0, 10, 0, 100, 5)', ctx({}))).toBe(50);
  });
  it('interpolate2d uses named Constants arrays', () => {
    const c = ctx(
      { x: 15 },
      { getArray: (n) => (n === 'bins' ? [0, 10, 20] : n === 'vals' ? [0, 100, 200] : undefined) },
    );
    expect(evalExpr('interpolate2d("bins", "vals", x)', c)).toBe(150);
  });

  it('history index name[-1] via getHistory', () => {
    const c = ctx({ rpm: 3000 }, { getHistory: (n, back) => (n === 'rpm' && back === 1 ? 2800 : undefined) });
    expect(evalExpr('rpm - rpm[-1]', c)).toBe(200);
  });

  it('latch32 holds value while enable is 0 (stateful across evals)', () => {
    const e = new CompiledExpr('latch32(0, en, val)');
    expect(e.evaluate(ctx({ en: 1, val: 42 }))).toBe(42);
    expect(e.evaluate(ctx({ en: 0, val: 99 }))).toBe(42); // held
    expect(e.evaluate(ctx({ en: 1, val: 7 }))).toBe(7);
  });
});
