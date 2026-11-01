import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  encodeMarkerPacket,
  encodeRealtimePacket,
  encodeRtTimePacket,
  logSamples,
  pagePackets,
  pagesFromPackets,
  parseSiprSection,
  parseVemsLog,
  realtimeFromPayload,
  SIPR_TABLE_IDS,
  SiprParser,
  SiprType,
  vemslogFileName,
  vemslogHeader,
  VemsLogWriter,
} from '../src/index.js';

const SAMPLES = join(__dirname, '../../../re/evidence/formats/vemslog_samples');
const files = ['v3.3_n001453-2026.10.14-12.22.24.vemslog', 'v3.3_n001453-2026.10.14-12.22.29.vemslog'];
// firmware 1.2.16 → vemsTune-v3-1.2.15/17 INIs include sipr-1.2.15.ini
const desc = parseSiprSection(
  readFileSync(join(__dirname, '../../../re/target/vemstune-1.5.46/config/include/sipr-1.2.15.ini'), 'latin1'),
  new Set(['USE_RAW_LAMBDA_TABLE', 'KNOCK_ALTERNATIVE']),
);
/** Header text as written: bytes up to the first NUL. */
const headerText = (b: Uint8Array) => new TextDecoder('latin1').decode(b.subarray(0, b.indexOf(0)));

describe('.vemslog writer (golden: real VemsTune 1.5.46 logs)', () => {
  for (const f of files) {
    it(`regenerates ${f} byte-for-byte`, () => {
      const orig = new Uint8Array(readFileSync(join(SAMPLES, f)));
      const log = parseVemsLog(orig);
      expect(log.results.every((r) => r.kind === 'packet')).toBe(true);
      // every table id in the sample must be known to SIPR_TABLE_IDS
      const ids = new Set(Object.values(SIPR_TABLE_IDS));
      for (const r of log.results) if (r.packet.type === SiprType.GET_TABLEDATA) expect(ids.has(r.packet.payload[0]!)).toBe(true);
      const store = pagesFromPackets(desc, log.results.map((r) => r.packet));

      const w = new VemsLogWriter(headerText(orig));
      for (const page of desc.pages) {
        const data = store.get(page.pageNo);
        if (data) for (const pkt of pagePackets(desc, page.pageNo, data)) w.add(pkt);
      }
      expect(Buffer.from(w.bytes()).equals(Buffer.from(orig))).toBe(true);
    });
  }

  it('builds the same header text as getVemslogHeader', () => {
    const log = parseVemsLog(new Uint8Array(readFileSync(join(SAMPLES, files[0]!))));
    const h = log.header;
    expect(
      vemslogHeader({
        time: new Date(2026, 9, 14, 12, 22, 24),
        creator: h.Creator,
        version: h.Version,
        serialNumber: h.SerialNumber,
        compilationTime: h.CompilationTime,
        signature: h.Signature,
        compileOptions: h.CompileOptions,
      }),
    ).toBe(headerText(new Uint8Array(readFileSync(join(SAMPLES, files[0]!)))));
    expect(vemslogFileName(h.SerialNumber!, new Date(2026, 9, 14, 12, 22, 24))).toBe(files[0]);
  });
});

describe('realtime / time / marker packets', () => {
  it('READ_SENSORS carries `00 00 01` + realtime block and a valid CRC', () => {
    const rt = Uint8Array.from({ length: 100 }, (_, i) => (i * 7) & 0xff);
    const frame = encodeRealtimePacket(rt);
    expect([...frame.subarray(0, 7)]).toEqual([0x0a, 0, SiprType.READ_SENSORS, 103, 0, 0, 1]);
    const r = [...new SiprParser().feedAll(frame)][0]!;
    expect(r.kind).toBe('packet');
    expect([...realtimeFromPayload(r.packet.payload)]).toEqual([...rt]);
  });

  it('RT_TIME is 4-byte big-endian ms; marker is an empty LOG_MARKER', () => {
    const t = [...new SiprParser().feedAll(encodeRtTimePacket(0x01020304))][0]!;
    expect(t).toMatchObject({ kind: 'packet', packet: { type: SiprType.RT_TIME } });
    expect([...t.packet.payload]).toEqual([1, 2, 3, 4]);
    const m = [...new SiprParser().feedAll(encodeMarkerPacket())][0]!;
    expect(m).toMatchObject({ kind: 'packet', packet: { type: SiprType.LOG_MARKER } });
    expect(m.packet.payload.length).toBe(0);
  });

  it('a recorded session parses back: packets never straddle blocks, last byte 0x0A', () => {
    const w = new VemsLogWriter(vemslogHeader({ version: '1.2.34' }));
    for (let i = 0; i < 50; i++) {
      w.add(encodeRtTimePacket(i * 100));
      w.add(encodeRealtimePacket(Uint8Array.from({ length: 120 }, () => i)));
      if (i === 25) w.add(encodeMarkerPacket());
    }
    const bytes = w.bytes();
    expect(bytes.length % 512).toBe(0);
    for (let b = 511; b < bytes.length; b += 512) expect(bytes[b]).toBe(0x0a);
    const log = parseVemsLog(bytes);
    expect(log.header.Version).toBe('1.2.34');
    const rts = log.results.filter((r) => r.packet.type === SiprType.READ_SENSORS);
    expect(rts.length).toBe(50);
    expect(rts.every((r) => r.kind === 'packet')).toBe(true);
    expect(realtimeFromPayload(rts[49]!.packet.payload)[0]).toBe(49);
    expect(log.results.filter((r) => r.packet.type === SiprType.LOG_MARKER).length).toBe(1);

    // reader side: RT_TIME stamps each sample, marker points at the sample before it
    const { samples, markers } = logSamples(log.results.map((r) => r.packet));
    expect(samples.length).toBe(50);
    expect(samples[49]).toMatchObject({ ms: 4900 });
    expect(samples[49]!.data[0]).toBe(49);
    expect(markers).toEqual([25]);
  });
});
