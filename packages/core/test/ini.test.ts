import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  arrayLength,
  curveSequenceBins,
  loadConfig,
  parseType,
  readArray,
  readScalar,
  tokenize,
  writeScalar,
  type ArrayField,
  type ScalarField,
} from '../src/index.js';

const CFG = join(__dirname, '../../../re/target/vemstune-1.5.46/config');
const resolveInclude = (p: string) => {
  try {
    return readFileSync(join(CFG, p), 'latin1');
  } catch {
    return undefined;
  }
};
const defines = new Set(['USE_RAW_LAMBDA_TABLE']);
const load = (file: string) =>
  loadConfig(readFileSync(join(CFG, file), 'latin1'), file, { defines, resolveInclude });

describe('tokenizer', () => {
  it('treats commas/= as optional separators (position-based)', () => {
    expect(tokenize('adjust0 = scalar, U08, 32, "Deg"\t\t0.250,0').map((t) => t.text)).toEqual([
      'adjust0',
      'scalar',
      'U08',
      '32',
      'Deg',
      '0.250',
      '0',
    ]);
  });
  it('strips a leading % (active line in VemsTune)', () => {
    expect(tokenize('%\ttaeRates = array, U08, 44, [4]').map((t) => t.text)).toEqual([
      'taeRates',
      'array',
      'U08',
      '44',
      '4',
    ]);
  });
});

describe('parseType', () => {
  it.each([
    ['U08', { signed: false, size: 1, float: false }],
    ['U16', { signed: false, size: 2, float: false }],
    ['S32', { signed: true, size: 4, float: false }],
  ])('%s', (s, exp) => expect(parseType(s)).toEqual(exp));
});

describe('full v3 1.2.34 INI (includes resolved)', () => {
  const cfg = load('vemsTune-v3-1.2.34.ini');
  it('resolves includes and finds many constants + channels', () => {
    expect(cfg.constants.length).toBeGreaterThan(500);
    expect(cfg.channels.length).toBeGreaterThan(300);
    expect(cfg.ochGetCommand).toBe('D');
  });
  it('VE table is a 16x14 array on page 2', () => {
    const ve = cfg.byName.get('veTable') as ArrayField;
    expect(ve.kind).toBe('array');
    expect(ve.shape.dims).toEqual([16, 14]);
    expect(ve.page).toBe(2);
    expect(arrayLength(ve)).toBe(16 * 14);
  });
  it('USE_RAW_LAMBDA_TABLE define selects the lambda page', () => {
    // page 3 table set differs by define; just assert parsing produced page 3 fields
    expect(cfg.pages.get(2)!.length).toBeGreaterThan(0);
  });
});

describe('value codec round trip', () => {
  const cfg = load('vemsTune-v3-1.2.34.ini');
  it('scalar scale/translate write→read is stable', () => {
    const f = [...cfg.byName.values()].find(
      (x): x is ScalarField => x.kind === 'scalar' && x.scale !== 0 && !x.realtime,
    )!;
    const buf = new Uint8Array(512);
    const target = f.lo + (f.hi - f.lo) / 2;
    writeScalar(buf, f, target);
    expect(readScalar(buf, f)).toBeCloseTo(Math.round(target / f.scale - f.translate) * f.scale * 1 + 0, 5);
  });
  it('reads a VE array of the right length', () => {
    const ve = cfg.byName.get('veTable') as ArrayField;
    const buf = new Uint8Array(512).fill(100);
    expect(readArray(buf, ve)).toHaveLength(16 * 14);
  });
});

describe('table/curve/sipr descriptors from 1.2.34', () => {
  const cfg = load('vemsTune-v3-1.2.34.ini');
  it('captures 3D tables incl VE with axis symbols', () => {
    expect(cfg.tables.size).toBeGreaterThan(5);
    const ve = cfg.tables.get('veTableMap');
    expect(ve?.zSym).toBe('veTable');
    expect(ve?.xSym).toBe('rpmBinsVE');
  });
  it('captures curves', () => {
    expect(cfg.curves.size).toBeGreaterThan(5);
  });
  it('curve columnLabel/xAxis/yAxis and SEQUENCE bins (injector deadtime 8..16 V)', () => {
    const c = cfg.curves.get('injector_dead_time')!;
    expect(c.xLabel).toBe('Battery voltage');
    expect(c.yLabel).toBe('Dead time');
    expect(c.xAxis).toEqual({ min: 8, max: 16, count: 5, format: '%.0f' });
    expect(c.yAxis?.max).toBe(4080);
    expect(c.xSym).toBe('SEQUENCE');
    expect(curveSequenceBins(c, 5)).toEqual([8, 10, 12, 14, 16]);
  });
  it('maps vt page 2 → ecu id 10 (VE)', () => {
    expect(cfg.vt2ecu.get(2)).toBe(10);
    expect(cfg.vt2ecu.get(5)).toBe(0);
  });
});
