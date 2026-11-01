import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buttonState,
  fieldMarks,
  FwSymbols,
  loadConfig,
  parseConfigCriteria,
  parseSiprSection,
  pickLayoutVersion,
  validateConfig,
  type ChannelDb,
  type FwLayout,
} from '../src/index.js';

const CFG = join(__dirname, '../../../re/target/vemstune-1.5.46/config');
const PUB = join(__dirname, '../../../apps/tuner/public/config');
const read = (p: string) => {
  try {
    return readFileSync(join(CFG, p), 'latin1');
  } catch {
    return undefined;
  }
};
// VemsTune's condition table (MTConfigHelper::parseMTConfigData): USE_SUPER_TABLE + session CELSIUS + [Params]
const cfg = loadConfig(read('vemsTune-v3-1.2.34.ini')!, 'vemsTune-v3-1.2.34.ini', {
  defines: new Set(['USE_SUPER_TABLE', 'CELSIUS', 'USE_RAW_LAMBDA_TABLE']),
  resolveInclude: read,
});
const criteria = parseConfigCriteria(readFileSync(join(CFG, 'ConfigCriteria.xml'), 'utf8'));
const sipr = parseSiprSection(read('include/sipr-1.2.34.ini')!, new Set(['USE_RAW_LAMBDA_TABLE']));
const versions: string[] = JSON.parse(readFileSync(join(PUB, 'fw_layout/index.json'), 'utf8'));
const channels: ChannelDb = JSON.parse(readFileSync(join(PUB, 'outputchannels.json'), 'utf8'));

/** The emu-cli emulator's pages as VemsTune saw them (see fixture header). */
function emulatorPages() {
  const pages = new Map<number, Uint8Array>();
  for (const [vt, ecu] of cfg.vt2ecu) {
    const b = Uint8Array.from({ length: 255 }, (_, i) => 50 + ((i * 5 + ecu * 13) % 150));
    if (ecu === 10) b[0xd0] = 0xa8;
    pages.set(vt, b);
  }
  return pages;
}

const golden = readFileSync(join(__dirname, 'fixtures/vemstune-sanity-emulator.txt'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => /^\d\|/.test(l));

describe('Config Sanity Check vs VemsTune 1.5.46 (golden)', () => {
  const pages = emulatorPages();
  // no fw_desc for 1.2.33/1.2.34 → VemsTune uses the newest older header
  const ver = pickLayoutVersion(versions, '1.2.34');
  const layout: FwLayout = JSON.parse(readFileSync(join(PUB, `fw_layout/${ver}.json`), 'utf8'));
  const res = validateConfig(criteria, cfg, pages, { firmware: '1.2.34', fw: new FwSymbols(layout, sipr, pages), channels });
  const icon = { warning: 0, error: 1, info: 2 } as const;
  const ours = res.messages.map((m) => `${icon[m.severity]}|${m.key}|${m.message}`);

  it('uses the 1.2.32 global.h for firmware 1.2.34', () => expect(ver).toBe('1.2.32'));

  it('reproduces VemsTune\'s message list line for line (rules, summary, channels, bits)', () => {
    if (ours.join('\n') !== golden.join('\n')) {
      console.log('MISSING:\n ' + golden.filter((g) => !ours.includes(g)).join('\n '));
      console.log('EXTRA:\n ' + ours.filter((o) => !golden.includes(o)).join('\n '));
    }
    expect(ours).toEqual(golden);
  });

  it('counts: 90 rules, 49 passed, 29 warnings, 12 errors; 5 collisions, 12 invalid channels', () => {
    expect(res).toMatchObject({ rules: 90, passed: 49, warnings: 29, errors: 12, collisions: 5, invalidChannels: 12 });
    expect(res.skipped.length).toBe(9); // maxfw < 1.2.34
    expect(res.buttonState).toBe(3);
  });

  it('expands $MENU_LINK to the dialog menu path, as in VemsTune\'s details pane', () => {
    const m = res.messages.find((x) => x.key === 'wbo2_pump_pw_zero')!;
    expect(m.detail).toContain('Please check <b>wbo2_pump_pw_zero</b> in menu(s):<br><a href="calibration" target="wbo2_pump_pw_zero">Base Setup:ECU Calibrations</a>');
  });
});

describe('dialog field marks (VemsTune "Primary Trigger Settings Visual" on the same emulator)', () => {
  const pages = emulatorPages();
  const layout: FwLayout = JSON.parse(readFileSync(join(PUB, 'fw_layout/1.2.32.json'), 'utf8'));
  const marks = fieldMarks(criteria, cfg, pages, { firmware: '1.2.34', fw: new FwSymbols(layout, sipr, pages) });

  it('tooth_wheel carries the ConfigCriteria.xml warning detail (seen as the field tooltip)', () => {
    const m = marks.get('tooth_wheel')!;
    expect(m.severity).toBe('warning');
    expect(m.text).toMatch(/^Warning: +If trigger type is "Coil-type" and you have no Cam-Sync/);
  });

  it('a bits value on an INVALID label is "Error: INVALID value" (checkInvalidBits(StringHash&))', () => {
    // h20 is in the "Invalid values" list of the golden sanity check above
    expect(marks.get('h20')).toEqual({ severity: 'error', text: 'Error: INVALID value' });
  });
});

describe('parser quirks', () => {
  it('a whitespace node before CDATA blanks the expression (cranking_thres never fires)', () => {
    const r = criteria.rules.find((x) => x.key === 'cranking_thres')!;
    expect(r.items).toEqual([{ type: 'warning', expr: '' }]);
  });
  it('button state table', () => {
    expect([buttonState(0, 0), buttonState(1, 0), buttonState(2, 9), buttonState(0, 3), buttonState(0, 4), buttonState(0, 2)]).toEqual([1, 2, 3, 4, 5, 1]);
  });
});
