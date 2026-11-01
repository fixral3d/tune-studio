import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyVemsCfg,
  firmwareDefines,
  loadConfig,
  optionsFromString,
  parseSiprSection,
  parseVemsCfg,
  pickLayoutVersion,
  vemsTuneDefines,
  writeVemsCfg,
  type FwLayout,
  type VemsCfgFile,
} from '../src/index.js';

const T = join(__dirname, '../../../re/target/vemstune-1.5.46');
const CFG = join(T, 'config');
const PUB = join(__dirname, '../../../apps/tuner/public/config');
const read = (p: string) => {
  try {
    return readFileSync(join(CFG, p), 'latin1');
  } catch {
    return undefined;
  }
};
const versions: string[] = JSON.parse(readFileSync(join(PUB, 'fw_layout/index.json'), 'utf8'));

/** Load the INI/SIPR/global.h set VemsTune would use for a .vemscfg's header. */
function contextFor(file: VemsCfgFile, ini: string, siprIni: string) {
  const defines = vemsTuneDefines({ signature: file.header.Signature, options: parseInt(file.header.CompileOptions ?? '', 16) || undefined });
  defines.add('USE_RAW_LAMBDA_TABLE'); // INI [Params]
  const cfg = loadConfig(read(ini)!, ini, { defines, resolveInclude: read });
  const sipr = parseSiprSection(read(siprIni)!, defines);
  const ver = pickLayoutVersion(versions, file.header.Version!)!;
  const layout: FwLayout = JSON.parse(readFileSync(join(PUB, `fw_layout/${ver}.json`), 'utf8'));
  return { cfg, sipr, layout, defines };
}

describe('firmware-detected defines', () => {
  it('CompileOptions 0xDE + "kpa=2,2" (config_1.2.34 header)', () => {
    expect([...firmwareDefines({ signature: 'VEMS v1.2.34 16x14 kpa=2,2', options: 0xde })].sort()).toEqual(
      ['EXPENSIVE_MISC1OUT', 'EXPENSIVE_MISC2OUT', 'HIGHBOOST', 'INJECTOR_TRIM', 'KNOCK_ALTERNATIVE', 'N2O_RETARD', 'WARNING_BEEP'].sort(),
    );
  });
  it('kpa unit / conf-res / 12x12 substrings', () => {
    expect([...firmwareDefines({ signature: 'VEMS v1.1.80 12x12 kpa=4,4' })].sort()).toEqual(['12X12', 'KPACONFRES_4', 'KPAUNIT_4']);
    expect([...firmwareDefines({ signature: 'VEMS v1.2.34 16x14 kpa=2,1' })]).toEqual([]);
  });
  it('TF options string: chars 24..25 when 26–29 long', () => {
    expect(optionsFromString('VEMS Genboard v3, 1.2.34')).toBeUndefined();
    expect(optionsFromString('VEMS Genboard v3, 1.2.34' + String.fromCharCode(0x00, 0xde))).toBe(0xde);
  });
});

const USER_CFG = 'C:/Users/erdem/3000GT-Vems/3000gt.vemscfg'; // the user's real ECU config (fw 1.2.16), outside the repo

describe('.vemscfg', () => {
  it('places every line of config_1.2.34 except the two mux_* fields missing from the 1.2.34 INI', () => {
    const file = parseVemsCfg(readFileSync(join(T, 'defaultfirmwareconfigs/config_1.2.34.vemscfg'), 'latin1'));
    const ctx = contextFor(file, 'vemsTune-v3-1.2.34.ini', 'include/sipr-1.2.34.ini');
    const r = applyVemsCfg(file, ctx, new Map());
    expect(file.entries.length).toBe(651);
    expect(r.unknown.map((e) => e.name)).toEqual(['mux_mcp_ch', 'mux_out0']);
    expect(r.eeprom?.length).toBe(64);
  });

  const cases: [string, string, string, string, boolean][] = [
    // [name, file, INI, SIPR ini, canonical order checkable (global.h for this exact version exists)]
    ['VemsTune default config_1.2.34', join(T, 'defaultfirmwareconfigs/config_1.2.34.vemscfg'), 'vemsTune-v3-1.2.34.ini', 'include/sipr-1.2.34.ini', false],
    ['VemsTune default config_1.2.32', join(T, 'defaultfirmwareconfigs/config_1.2.32.vemscfg'), 'vemsTune-v3-1.2.32.ini', 'include/sipr-1.2.32.ini', true],
  ];
  if (existsSync(USER_CFG)) cases.push(["user's 3000gt.vemscfg (fw 1.2.16)", USER_CFG, 'vemsTune-v3-1.2.15.ini', 'include/sipr-1.2.15.ini', false]);

  for (const [name, path, ini, siprIni, canonical] of cases) {
    it(`${name}: load → pages → write reproduces the file`, () => {
      const text = readFileSync(path, 'latin1');
      const file = parseVemsCfg(text);
      const ctx = contextFor(file, ini, siprIni);
      const pages = new Map<number, Uint8Array>();
      applyVemsCfg(file, ctx, pages);
      const out = writeVemsCfg(ctx, pages, { header: file.headerOrder.map((k) => ({ key: k, value: file.header[k]! })), template: file });
      const want = text.replace(/\r\n/g, '\n');
      if (out !== want) {
        const a = out.split('\n');
        const b = want.split('\n');
        const d = a.findIndex((l, i) => l !== b[i]);
        console.log(`${name}: line ${d}: ours ${JSON.stringify(a[d])} vs file ${JSON.stringify(b[d])} (ours ${a.length} lines, file ${b.length})`);
      }
      expect(out).toBe(want);
    });

    it.runIf(canonical)(`${name}: canonical order (no template) matches VemsTune's line order`, () => {
      const file = parseVemsCfg(readFileSync(path, 'latin1'));
      const ctx = contextFor(file, ini, siprIni);
      const pages = new Map<number, Uint8Array>();
      const r = applyVemsCfg(file, ctx, pages);
      const fresh = parseVemsCfg(writeVemsCfg(ctx, pages, { header: [], eeprom: r.eeprom }));
      const key = (e: { name: string; idx?: string }) => (e.idx === undefined ? e.name : `${e.name}[${e.idx}]`);
      const placed = file.entries.filter((e) => !r.unknown.includes(e)).map(key);
      const ours = fresh.entries.map(key);
      if (ours.join() !== placed.join()) {
        const d = ours.findIndex((k, i) => k !== placed[i]);
        console.log(`${name}: first difference at ${d}: ours ${ours.slice(d, d + 4)} vs file ${placed.slice(d, d + 4)}; ours ${ours.length} file ${placed.length}`);
        console.log(' only ours:', ours.filter((k) => !placed.includes(k)).slice(0, 20).join(' '));
        console.log(' only file:', placed.filter((k) => !ours.includes(k)).slice(0, 20).join(' '));
      }
      expect(ours).toEqual(placed);
    });
  }
});
