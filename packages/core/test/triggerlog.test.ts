import { describe, expect, it } from 'vitest';
import {
  decodeTriggerFrame,
  EcuEmulator,
  encodeTriggerFrame,
  MemoryPipe,
  parseTriggerLog,
  triggerLogCsv,
  triggerLogResults,
  vemslogHeader,
  VemsClient,
  writeTriggerLog,
} from '../src/index.js';

const cat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

describe('trigger log (TriggerFrame::addFrame / convertFrame2Time)', () => {
  it('decodes primary, event and data frames', () => {
    const body = (w: Uint8Array) => w.subarray(0, w.length - 3); // drop CRC(2) + 7E (no stuffing in these)
    expect(decodeTriggerFrame(body(encodeTriggerFrame(1, [0x1234, 0x2345])))).toMatchObject({ type: 1, primaries: [0x1234, 0x2345] });
    expect(decodeTriggerFrame(body(encodeTriggerFrame(2, [0x1000], 0x1100)))).toMatchObject({ type: 2, primaries: [0x1000], event: 0x1100 });
    expect(decodeTriggerFrame(body(encodeTriggerFrame(0x41, [], 0x0abc, 9)))).toMatchObject({ type: 0x41, event: 0x0abc, data: 9 });
    expect(decodeTriggerFrame(Uint8Array.of(1, 2, 0x33))).toBe(0x101);
  });

  it('unwraps 16-bit ticks (4 µs) and finds the missing tooth', () => {
    // 6-1 wheel at 1 ms per tooth = 250 ticks, crossing the 0xFFFF wrap
    const ticks: number[] = [];
    for (let i = 0, t = 0xff00; i < 14; i++, t += 250) if (i % 6 !== 5) ticks.push(t & 0xffff);
    // the firmware sends events in time order: cam pulse between tooth 2 and 3
    const stream = cat([encodeTriggerFrame(1, ticks.slice(0, 3)), encodeTriggerFrame(2, [], (0xff00 + 2 * 250 + 100) & 0xffff), encodeTriggerFrame(1, ticks.slice(3))]);
    const file = writeTriggerLog(vemslogHeader({ trigger: true, version: '1.2.34', serialNumber: 'v3.3_n001453' }), stream);
    const log = parseTriggerLog(file);
    expect(log.hasHeader).toBe(true);
    expect(log.info).toMatchObject({ version: '1.2.34', serialNumber: 'v3.3_n001453' });
    const pr = log.timelines.get(1)!.t;
    expect(pr).toHaveLength(12);
    for (let i = 1; i < pr.length; i++) expect(pr[i]! - pr[i - 1]!).toBeGreaterThan(0);
    const rows = triggerLogResults(log);
    const gaps = rows.filter((r) => r.comment).map((r) => r.comment);
    expect(gaps).toEqual(['MISSING TOOTH: 1, cycle=5', 'MISSING TOOTH: 1, cycle=5']);
    expect(rows.filter((r) => r.secondary)).toHaveLength(1);
    const csv = triggerLogCsv(rows, log.info).split('\n');
    expect(csv[2]).toBe('id,Primary Time (ms),Primary Diff (ms),Primary Diff Ratio,Secondary Time (ms),Secondary Diff (ms),Comment');
    expect(csv.some((l) => l.endsWith(',"MISSING TOOTH: 1, cycle=5"'))).toBe(true);
  });

  it('reads a header-less file as a raw stream and counts CRC errors', () => {
    const good = encodeTriggerFrame(1, [100, 200]);
    const bad = good.slice();
    bad[1] ^= 0xff;
    const log = parseTriggerLog(cat([good, bad]));
    expect(log.hasHeader).toBe(false);
    expect(log.stats).toMatchObject({ frames: 2, crcErrors: 1 });
  });

  it('records the emulator stream between 40 03 F7 and 00 03 F7', async () => {
    const pipe = new MemoryPipe(19200);
    const ecu = new EcuEmulator(pipe.b, { triggerWheel: { teeth: 36, missing: 1, rpm: 3000, secondaryTooth: 5 } });
    const client = new VemsClient(pipe.a);
    pipe.a.open();
    pipe.b.open();
    ecu.start();
    client.start();
    const raw: Uint8Array[] = [];
    const off = client.onRawData((b) => raw.push(b.slice()));
    client.startTriggerLog();
    await new Promise((r) => setTimeout(r, 200));
    await client.stopTriggerLog();
    off();
    const log = parseTriggerLog(cat(raw));
    const rows = triggerLogResults(log);
    const gaps = rows.filter((r) => r.comment);
    expect(log.timelines.get(1)!.t.length).toBeGreaterThan(100); // 3000 rpm = 1800 teeth/s
    expect(gaps.length).toBeGreaterThan(2);
    expect(gaps.slice(1).every((r) => r.comment === 'MISSING TOOTH: 1, cycle=35')).toBe(true);
    expect(log.timelines.get(2)!.t.length).toBeGreaterThan(0);
  });
});
