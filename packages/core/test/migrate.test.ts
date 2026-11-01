import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyVemsCfg,
  canonicalKeys,
  keysOf,
  loadConfig,
  migrateConfig,
  parseConfigCriteria,
  parseSiprSection,
  parseVemsCfg,
  pickDefaultConfig,
  vemsTuneDefines,
  type FwLayout,
} from '../src/index.js';

const T = join(__dirname, '../../../re/target/vemstune-1.5.46');
const CFG = join(T, 'config');
const DEF = join(T, 'defaultfirmwareconfigs');
const PUB = join(__dirname, '../../../apps/tuner/public/config');
const read = (p: string) => {
  try {
    return readFileSync(join(CFG, p), 'latin1');
  } catch {
    return undefined;
  }
};
const criteria = parseConfigCriteria(readFileSync(join(CFG, 'ConfigCriteria.xml'), 'utf8'));
const defaults: string[] = JSON.parse(readFileSync(join(PUB, 'defaultfirmwareconfigs/index.json'), 'utf8')).v3;
const vemscfg = (p: string) => parseVemsCfg(readFileSync(p, 'latin1'));

// target ECU: firmware 1.2.34 (signature kpa=2,2, CompileOptions 0xDE like VemsTune's own default)
const defines = vemsTuneDefines({ signature: 'VEMS v1.2.34 16x14 kpa=2,2', options: 0xde });
defines.add('USE_RAW_LAMBDA_TABLE');
const cfg = loadConfig(read('vemsTune-v3-1.2.34.ini')!, 'vemsTune-v3-1.2.34.ini', { defines, resolveInclude: read });
const sipr = parseSiprSection(read('include/sipr-1.2.34.ini')!, defines);
const layout: FwLayout = JSON.parse(readFileSync(join(PUB, 'fw_layout/1.2.32.json'), 'utf8'));
const ctx = { cfg, sipr, layout };
const ecuKeys = canonicalKeys(ctx);

const migrate = (path: string, ecuSerial = 'v3.3_n001453') => {
  const v = pickDefaultConfig(defaults, '1.2.34')!;
  return migrateConfig({
    file: vemscfg(path),
    ecu: { version: '1.2.34', serialNumber: ecuSerial },
    ecuKeys,
    criteria,
    filterKeys: keysOf(vemscfg(join(DEF, 'v3_configfilter.vemscfg'))),
    calibrationKeys: keysOf(vemscfg(join(DEF, 'calibrations.vemscfg'))),
    defaults: { version: v, file: vemscfg(join(DEF, `config_${v}.vemscfg`)) },
  });
};

describe('default config selection (FirmwareInfo::geDefaultConfigFile)', () => {
  it('exact, else the greatest older version in the same major.minor', () => {
    expect(pickDefaultConfig(defaults, '1.2.34')).toBe('1.2.34');
    expect(pickDefaultConfig(defaults, '1.2.40')).toBe('1.2.34');
    expect(pickDefaultConfig(defaults, '1.2.16')).toBe('1.2.15');
    expect(pickDefaultConfig(defaults, '1.2.1')).toBe('1.2.0');
    expect(pickDefaultConfig(defaults, '1.1.99')).toBe('1.1.98');
    expect(pickDefaultConfig(defaults, '1.3.0')).toBeUndefined();
  });
});

describe('firmware-upgrade migration: VemsTune default config_1.1.98 → ECU 1.2.34', () => {
  const src = vemscfg(join(DEF, 'config_1.1.98.vemscfg'));
  const { file, report } = migrate(join(DEF, 'config_1.1.98.vemscfg'), src.header.SerialNumber);
  const val = (f: typeof file, k: string) => f.entries.find((e) => (e.idx === undefined ? e.name : `${e.name}[${e.idx}]`) === k)?.bytes[0];

  it('applies the 1.2.1 and 1.2.32 FwRules buckets, skips the 1.1.x ones', () => {
    expect(report.fwRules).toContain('<i>1.1.97 rules skipped. ECU version: 1.2.34, config version: 1.1.98</i>');
    const c11 = val(src, 'config11')!;
    expect(val(file, 'config11')).toBe(c11 & 247);
    expect(report.fwRules).toContain(
      `<b>config11</b> has been updated from <b>${c11}</b> to <b>${c11 & 247}</b> by the rule <i>'config11 = (config11 & (255-8))'</i> (fw >= 1.2.32)`,
    );
    const ri = val(src, 'wbo2_ri_target')!;
    expect(val(file, 'wbo2_ri_target')).toBe(ri < 175 ? 180 : ri);
  });

  it('fills the symbols 1.1.98 lacks from config_1.2.34 and drops the filtered keys', () => {
    expect(report.defaultConfig).toBe('1.2.34');
    expect(report.missingScalars.length).toBeGreaterThan(20);
    expect(report.fromDefault.length).toBeGreaterThan(20);
    expect(report.filtered).toEqual(expect.arrayContaining(['config_switch']));
    expect(file.entries.some((e) => e.name === 'config_switch')).toBe(false);
  });

  it('sets prohibit_h/l for 1.2.34 when the iButton bit is clear', () => {
    // config_1.1.98 has prohibit_config=00 (iButton bit clear); 1.2.34 → (1<<10)|(2<<7)|34 = 0x0522
    expect(report.prohibit).toEqual([0x05, 0x22]);
    expect(val(file, 'prohibit_h')).toBe(0x05);
    expect(val(file, 'prohibit_l')).toBe(0x22);
  });

  it('the result loads into 1.2.34 pages', () => {
    const r = applyVemsCfg(file, ctx, new Map());
    expect(r.applied).toBeGreaterThan(600);
  });
});

describe.runIf(existsSync('C:/Users/erdem/3000GT-Vems/3000gt.vemscfg'))("user's 3000gt.vemscfg (fw 1.2.16) → ECU 1.2.34", () => {
  const path = 'C:/Users/erdem/3000GT-Vems/3000gt.vemscfg';
  const { file, report } = migrate(path);
  it('only the 1.2.32 bucket applies (config version 1.2.16)', () => {
    const applied = report.fwRules.filter((l) => l.includes('has been updated'));
    expect(applied.every((l) => l.includes('(fw >= 1.2.32)'))).toBe(true);
    expect(report.fwRules).toContain('<i>1.2.1 rules skipped. ECU version: 1.2.34, config version: 1.2.16</i>');
  });
  it('same ECU serial → calibrations kept; result loads into 1.2.34 pages', () => {
    expect(report.alien).toBe(false);
    const r = applyVemsCfg(file, ctx, new Map());
    console.log(`3000gt: missing ${report.missingScalars.length} scalars / ${report.missingTables.length} tables, from default ${report.fromDefault.length}, unplaced after migration ${r.unknown.length}`);
    expect(r.applied).toBeGreaterThan(550);
  });
});
