import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, resolveTarget, testCond, type MenuItem } from '../src/index.js';

const CFG = join(__dirname, '../../../re/target/vemstune-1.5.46/config');
const resolveInclude = (p: string) => {
  try {
    return readFileSync(join(CFG, p), 'latin1');
  } catch {
    return undefined;
  }
};
const file = 'vemsTune-v3-1.2.34.ini';
const cfg = loadConfig(readFileSync(join(CFG, file), 'latin1'), file, {
  defines: new Set(['USE_RAW_LAMBDA_TABLE']),
  resolveInclude,
});
const items = () => cfg.menus.flatMap((m) => m.items.filter((i): i is MenuItem => i !== 'separator'));

describe('[Menu]', () => {
  it('builds the v3 1.2.34 menu bar in file order', () => {
    expect(cfg.menus.map((m) => m.title)).toEqual([
      'Base Setup',
      '&Tuning',
      '&Starting / Idle',
      'Boost Control',
      '&Outputs',
      '&Motorsports',
      '&ECU Logger',
      'Inputs',
    ]);
  });

  it('keeps subMenu t4 as the enable condition; lowercase `submenu` is ignored', () => {
    const ecuLog = cfg.menus.find((m) => m.title === '&ECU Logger')!.items[0] as MenuItem;
    expect(ecuLog).toMatchObject({ target: 'eculog', page: 0 });
    expect(ecuLog.cond?.trim()).toBe('!(enable_etc && mss6x_idle_etc)');
    // `submenu = std_separator` (vemsTune-v3-1.2.34.ini:161) adds no separator
    const inputs = cfg.menus.find((m) => m.title === 'Inputs')!.items;
    const i = inputs.findIndex((x) => x !== 'separator' && x.target === 'matSensorCurve');
    expect(inputs[i + 1]).toMatchObject({ target: 'customCurveDialog' });
  });

  it('resolves every target except the known-dangling cltignadjTbl_*', () => {
    const unknown = items()
      .map((it) => resolveTarget(cfg, it.target, () => true))
      .filter((r) => r.kind === 'unknown')
      .map((r) => (r as { id: string }).id);
    expect(unknown.sort()).toEqual(['cltignadjTbl_MAP', 'cltignadjTbl_TPS']);
  });

  it('picks SuperTable variants by condition (alphan → TPS table)', () => {
    const pick = (alphan: number) =>
      resolveTarget(cfg, 'veTable3D', (c) => testCond(c, { getValue: (n) => (n === 'alphan' ? alphan : 0) }));
    expect(pick(0)).toMatchObject({ kind: 'table', table: { id: 'veTableTbl' } });
    expect(pick(1)).toMatchObject({ kind: 'table', table: { id: 'veTableTblTPS' } });
  });
});

describe('[UserDefined]', () => {
  it('parses dialog title/layout/help and positional field tokens', () => {
    const d = cfg.dialogs.get('calibration')!;
    expect(d).toMatchObject({ title: 'ECU Calibration', layout: 5, help: 'ECU calibration' });
    expect(d.fields[0]).toMatchObject({ kind: 'header', label: 'Safety mode' });
    // "iButton ADC keepalive", sym, {1}, "", {prohibit_config_ibutton}
    expect(d.fields[2]).toMatchObject({
      kind: 'edit',
      symbol: 'prohibit_config_ibutton_keepalive',
      enable: '1',
      combo: undefined,
      visible: 'prohibit_config_ibutton',
    });
    // missing comma between label and symbol still parses (position-based)
    expect(d.fields[3]).toMatchObject({ symbol: 'prohibit_config_ibutton_keepalive', visible: '!prohibit_config_ibutton' });
    // bare `0` enable → always disabled
    const off = d.fields.find((f) => f.symbol === 'kpaoffs_calculated')!;
    expect(testCond(off.enable, { getValue: () => 1 })).toBe(false);
    // '!' labels keep their prefix, with or without a symbol
    expect(d.fields.find((f) => f.symbol === 'kpafac_unit')).toMatchObject({ kind: 'edit', label: '!MAP Range Unit' });
    expect(d.fields.find((f) => f.kind === 'text')!.label).toBe('!Restart VemsTune after changing these settings');
  });

  it('symbol-less "#…" lines with conditions are headers', () => {
    const f = cfg.dialogs.get('etcSettings')!.fields[0]!;
    expect(f).toMatchObject({ kind: 'header', label: 'Enabling will disable secondary PWM', visible: '!enable_etc' });
  });

  it('testCond: missing → true, unresolvable symbol → true', () => {
    expect(testCond(undefined, { getValue: () => undefined })).toBe(true);
    expect(testCond('nosuch', { getValue: () => undefined })).toBe(true);
    expect(testCond('a == 2', { getValue: () => 2 })).toBe(true);
  });
});
