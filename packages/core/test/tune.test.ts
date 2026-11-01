import { describe, expect, it } from 'vitest';
import {
  deserializeTune,
  readAllPages,
  serializeTune,
  writeAllPages,
} from '../src/index.js';
// demo wiring helper is in the app; here we build a tiny emulator+client inline
import { EcuEmulator, MemoryPipe, VemsClient } from '../src/index.js';
import { loadConfig } from '../src/index.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CFG = join(__dirname, '../../../re/target/vemstune-1.5.46/config');
const resolveInclude = (p: string) => {
  try { return readFileSync(join(CFG, p), 'latin1'); } catch { return undefined; }
};
const cfg = loadConfig(readFileSync(join(CFG, 'vemsTune-v3-1.2.34.ini'), 'latin1'), 'vemsTune-v3-1.2.34.ini', {
  defines: new Set(['USE_RAW_LAMBDA_TABLE']), resolveInclude,
});

function wire() {
  const pipe = new MemoryPipe();
  const pages = new Map<number, Uint8Array>();
  for (const [, ecuId] of cfg.vt2ecu) pages.set(ecuId, Uint8Array.from({ length: 255 }, (_, i) => (i + ecuId) & 0xff));
  const ecu = new EcuEmulator(pipe.b, { pages });
  const client = new VemsClient(pipe.a);
  pipe.a.open(); pipe.b.open(); ecu.start(); client.start();
  return { client, ecu };
}

describe('tune read/serialize/deserialize/write round trip', () => {
  it('reads all pages, serializes, and re-reads identically', async () => {
    const { client } = wire();
    const store = await readAllPages(client, cfg);
    expect(store.size).toBeGreaterThan(5);
    const snap = serializeTune(store, { firmware: '1.2.34' });
    const restored = deserializeTune(snap);
    expect(restored.size).toBe(store.size);
    for (const [k, v] of store) expect([...restored.get(k)!]).toEqual([...v]);
  });

  it('writes a modified tune back and the device reflects it', async () => {
    const { client } = wire();
    const store = await readAllPages(client, cfg);
    const vePage = store.get(2)!;
    vePage[0] = 123;
    await writeAllPages(client, cfg, new Map([[2, vePage]]), { burn: false });
    const after = await client.readPage(cfg.vt2ecu.get(2)!);
    expect(after[0]).toBe(123);
  });
});
