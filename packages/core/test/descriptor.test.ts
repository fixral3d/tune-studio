import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pageByteSize, parseSiprSection } from '../src/index.js';

const SIPR = readFileSync(
  join(__dirname, '../../../re/target/vemstune-1.5.46/config/include/sipr-1.2.34.ini'),
  'latin1',
);

describe('SIPR descriptor (sipr-1.2.34.ini)', () => {
  const d = parseSiprSection(SIPR, new Set());
  it('reads burn + realtime pages', () => {
    expect(d.burnCommand).toBe('B');
    expect(d.realtimePages).toEqual([
      { command: 'A', type: 'SIPR_RT_MT_NORMAL' },
      { command: 'D', type: 'SIPR_RT_MT_EXT' },
    ]);
  });
  it('maps page → commands → tables → ecuId', () => {
    const ve = d.pages.find((p) => p.pageNo === 2)!;
    expect(ve.readCommand).toBe('j');
    expect(ve.writeCommand).toBe('J');
    expect(ve.configType).toBe('SIPR_GET_TABLEDATA');
    expect(ve.tableIds).toEqual(['SIPR_TABLE_VE']);
    expect(ve.ecuId).toBe(10);
  });
  it('config page 5 carries two tables', () => {
    const cfg = d.pages.find((p) => p.pageNo === 5)!;
    expect(cfg.configType).toBe('SIPR_GET_CONFIG_1');
    expect(cfg.tableIds).toEqual(['SIPR_TABLE_CONFIG1', 'SIPR_TABLE_CONFIG1_EXT']);
    expect(pageByteSize(d, cfg)).toBe(248 + 7);
  });
  it('page 16 uses hex command bytes', () => {
    const shared = d.pages.find((p) => p.pageNo === 16)!;
    expect(shared.readCommand).toBe('0x82');
    expect(shared.writeCommand).toBe('0x83');
  });
  it('honours #if USE_RAW_LAMBDA_TABLE (off → EGOC, on → LAMBDA)', () => {
    const off = parseSiprSection(SIPR, new Set());
    expect(off.pages.find((p) => p.pageNo === 3)!.tableIds).toEqual(['SIPR_TABLE_EGOC']);
    const on = parseSiprSection(SIPR, new Set(['USE_RAW_LAMBDA_TABLE']));
    expect(on.pages.find((p) => p.pageNo === 3)!.tableIds).toEqual(['SIPR_TABLE_LAMBDA']);
  });
  it('drops A340E page unless defined', () => {
    expect(parseSiprSection(SIPR, new Set()).pages.find((p) => p.pageNo === 13)).toBeUndefined();
    expect(
      parseSiprSection(SIPR, new Set(['A340E'])).pages.find((p) => p.pageNo === 13),
    ).toBeDefined();
  });
});
