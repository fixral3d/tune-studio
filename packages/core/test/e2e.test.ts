import { describe, expect, it } from 'vitest';
import { EcuEmulator, MemoryPipe, VemsClient } from '../src/index.js';

/**
 * End-to-end: VemsClient ↔ EcuEmulator over an in-memory serial pipe.
 * Validates the TF wire protocol round trip for the Phase-1 message set.
 * (Later the same client/emulator run over com0com against real VemsTune.)
 */
describe('client ↔ emulator over MemoryPipe', () => {
  function setup() {
    const pipe = new MemoryPipe(19200);
    const pages = new Map<number, Uint8Array>([
      [1, Uint8Array.from({ length: 48 }, (_, i) => i)], // H page (ecuId 1)
      [10, Uint8Array.from({ length: 255 }, (_, i) => (i * 3) & 0xff)], // VE page (ecuId 10)
    ]);
    const ecu = new EcuEmulator(pipe.b, {
      details: { serialNumber: 'v3.3_n001453', signature: 'VEMS Genboard v3, 1.2.16' },
      pages,
    });
    const client = new VemsClient(pipe.a);
    pipe.a.open();
    pipe.b.open();
    ecu.start();
    client.start();
    return { client, ecu, pages };
  }

  it('reads ECU details and parses firmware version', async () => {
    const { client } = setup();
    const d = await client.readDetails();
    expect(d.serialNumber).toBe('v3.3_n001453');
    expect(d.signature).toBe('VEMS Genboard v3, 1.2.16');
    expect(d.version).toBe('1.2.16');
  });

  it('reads a page byte-exact', async () => {
    const { client, pages } = setup();
    expect([...(await client.readPage(1))]).toEqual([...pages.get(1)!]);
    expect([...(await client.readPage(10))]).toEqual([...pages.get(10)!]);
  });

  it('writes a byte and reads it back', async () => {
    const { client } = setup();
    await client.writeByte(1, 5, 0xab);
    const page = await client.readPage(1);
    expect(page[5]).toBe(0xab);
  });

  it('polls realtime with an incrementing secl', async () => {
    const { client } = setup();
    const rt = await client.readRealtime();
    expect(rt.length).toBe(75);
    expect(typeof rt[0]).toBe('number');
  });

  it('completes a burn', async () => {
    const { client } = setup();
    await expect(client.burn()).resolves.toBeUndefined();
  });

  it('sends TEST_TOOLS ENA_FLAGS (WBO2 calibration start/stop)', async () => {
    const { client, ecu } = setup();
    await client.testTool(3, 0x02); // "Manmde02bye"
    expect(ecu.testTools.get(3)).toBe(0x02);
    await client.testTool(3, 0x00); // "Manmde00bye"
    expect(ecu.testTools.get(3)).toBe(0x00);
  });

  it('tracks unburned RAM writes until a burn', async () => {
    const { client } = setup();
    const seen: boolean[] = [];
    client.onUnburnedChange = (v) => seen.push(v);
    expect(client.unburned).toBe(false);
    await client.writeByte(1, 5, 0x11);
    await client.writeByte(1, 6, 0x22);
    expect(client.unburned).toBe(true);
    await client.burn();
    expect(client.unburned).toBe(false);
    expect(seen).toEqual([true, false]);
  });
});

describe('TfSession request queue (concurrent callers serialize)', () => {
  it('handles many concurrent requests without "in flight" errors', async () => {
    const { MemoryPipe, EcuEmulator, VemsClient } = await import('../src/index.js');
    const pipe = new MemoryPipe();
    const ecu = new EcuEmulator(pipe.b, { pages: new Map([[10, new Uint8Array(255).fill(7)]]) });
    const client = new VemsClient(pipe.a);
    pipe.a.open(); pipe.b.open(); ecu.start(); client.start();
    // fire reads + realtime + details concurrently
    const results = await Promise.all([
      client.readPage(10),
      client.readRealtime(),
      client.readDetails(),
      client.readPage(10),
    ]);
    expect((results[0] as Uint8Array).length).toBe(255);
    expect((results[3] as Uint8Array)[0]).toBe(7);
  });
});
