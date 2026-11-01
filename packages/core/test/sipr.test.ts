import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc16Sipr, encodeSipr, parseVemsLog, SiprParser, SiprType, siprTypeName } from '../src/index.js';

const SAMPLES = join(__dirname, '../../../re/evidence/formats/vemslog_samples');

describe('crc16Sipr', () => {
  it('matches CRC-16/MODBUS check value', () => {
    expect(crc16Sipr(new TextEncoder().encode('123456789'))).toBe(0x4b37);
  });
});

describe('SIPR codec', () => {
  it('round-trips encode → parser', () => {
    const payload = Uint8Array.from([1, 2, 3, 0x0a, 0xff]);
    const frame = encodeSipr({ sequence: 7, type: SiprType.GET_TABLEDATA, payload });
    expect(frame[0]).toBe(0x0a);
    const res = [...new SiprParser().feedAll(frame)];
    expect(res).toHaveLength(1);
    expect(res[0]?.kind).toBe('packet');
    expect(res[0]?.packet).toEqual({ sequence: 7, type: 5, payload });
  });

  it('detects CRC errors', () => {
    const frame = encodeSipr({ sequence: 0, type: SiprType.ACK, payload: new Uint8Array() });
    frame[frame.length - 1] ^= 0xff;
    expect([...new SiprParser().feedAll(frame)][0]?.kind).toBe('crc-error');
  });
});

describe('.vemslog samples from real ECU (fw 1.2.16, v3.3_n001453)', () => {
  const files = readdirSync(SAMPLES).filter((f) => f.endsWith('.vemslog'));
  it.each(files)('%s: every packet passes CRC and re-encodes byte-exact', (f) => {
    const buf = new Uint8Array(readFileSync(join(SAMPLES, f)));
    const log = parseVemsLog(buf);
    expect(log.header.LogVersion).toBe('2');
    expect(log.results.length).toBeGreaterThan(0);
    for (const r of log.results) {
      expect(r.kind).toBe('packet');
      expect(siprTypeName(r.packet.type)).not.toBe('INVALID');
      const enc = encodeSipr(r.packet);
      const at = Buffer.from(buf).indexOf(Buffer.from(enc), 512);
      expect(at).toBeGreaterThanOrEqual(512);
    }
  });
});
