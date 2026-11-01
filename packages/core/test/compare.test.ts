import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareConfigs, differencesDetails, differencesSummary, isIdentical, parseVemsCfg } from '../src/index.js';

const DEF = join(__dirname, '../../../re/target/vemstune-1.5.46/defaultfirmwareconfigs');
const load = (n: string) => parseVemsCfg(readFileSync(join(DEF, n), 'latin1'));

describe('compare configs (FW-06)', () => {
  it('a config against itself is identical', () => {
    const a = load('config_1.2.34.vemscfg');
    const d = compareConfigs(a, a);
    expect(isIdentical(d)).toBe(true);
    expect(differencesSummary(d)).toBe('');
  });

  it('reports a changed scalar as "key: a != b" and a changed table row', () => {
    const a = load('config_1.2.34.vemscfg');
    const b = parseVemsCfg(readFileSync(join(DEF, 'config_1.2.34.vemscfg'), 'latin1'));
    b.entries.find((e) => e.name === 'cranking_thres')!.bytes = [9];
    b.entries.find((e) => e.name === 'j' && e.idx === '3')!.bytes[0] = 0;
    const d = compareConfigs(a, b);
    expect(d.differentScalars).toEqual(['cranking_thres: 2 != 9']);
    expect(d.differentTables).toEqual(['j']);
    expect(differencesSummary(d)).toBe('Found 1 different scalar value(s)!\nFound 1 different table value(s)!\n');
    expect(differencesDetails(d)).toBe('Different scalar value(s) found! \n  cranking_thres: 2 != 9\nDifferent table value(s) found! \n  j\n');
  });

  it('missing vs intentionally filtered vs extra (1.2.32 file against the 1.2.34 reference)', () => {
    const a = load('config_1.2.32.vemscfg');
    a.entries = a.entries.filter((e) => e.name !== 'config_switch');
    const b = load('config_1.2.34.vemscfg');
    const d = compareConfigs(a, b, ['config_switch']);
    // config_switch is gone from A: B has it → extra (filtering only qualifies A-side keys)
    expect(d.extraScalars).toContain('config_switch');
    expect(d.extraScalars).toEqual(expect.arrayContaining(['cam_refdc_i_down', 'cam_refdc_e_down']));
    expect(d.missingScalars.length + d.differentScalars.length).toBeGreaterThan(0);
    const d2 = compareConfigs(b, a, ['config_switch']);
    expect(d2.filteredScalars).toEqual(['config_switch']);
  });
});
