/**
 * Tune model: the raw bytes of every config (constant) page, keyed by vt page
 * number. Reads from / writes to a device via the SIPR vt→ecu map, and
 * serializes to a portable JSON snapshot (.vtune).
 */
import type { VemsClient } from '../tf/client.js';
import type { VemsConfig } from './config.js';

export type PageStore = Map<number, Uint8Array>;

export interface TuneSnapshot {
  format: 'vtune';
  version: 1;
  firmware?: string;
  signature?: string;
  savedAt: string;
  /** vt page number → hex string of page bytes. */
  pages: Record<string, string>;
}

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string) => {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
};

/** Read every config page from the device into a PageStore (keyed by vt page). */
export async function readAllPages(client: VemsClient, cfg: VemsConfig): Promise<PageStore> {
  const store: PageStore = new Map();
  for (const [vtPage, ecuId] of cfg.vt2ecu) {
    try {
      store.set(vtPage, await client.readPage(ecuId));
    } catch {
      /* skip pages the device/emulator doesn't serve */
    }
  }
  return store;
}

export function serializeTune(store: PageStore, meta: { firmware?: string; signature?: string } = {}): TuneSnapshot {
  const pages: Record<string, string> = {};
  for (const [vtPage, buf] of store) pages[String(vtPage)] = toHex(buf);
  return {
    format: 'vtune',
    version: 1,
    firmware: meta.firmware,
    signature: meta.signature,
    savedAt: new Date().toISOString(),
    pages,
  };
}

export function deserializeTune(snap: TuneSnapshot): PageStore {
  const store: PageStore = new Map();
  for (const [k, hex] of Object.entries(snap.pages)) store.set(Number(k), fromHex(hex));
  return store;
}

/** Write a whole page store to the device byte-by-byte (SRAM write), then burn. */
export async function writeAllPages(
  client: VemsClient,
  cfg: VemsConfig,
  store: PageStore,
  opts: { burn?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
  let total = 0;
  for (const buf of store.values()) total += buf.length;
  let done = 0;
  for (const [vtPage, buf] of store) {
    const ecuId = cfg.vt2ecu.get(vtPage);
    if (ecuId === undefined) continue;
    for (let off = 0; off < buf.length; off++) {
      await client.writeByte(ecuId, off, buf[off]!);
      done++;
      if ((done & 0x1f) === 0) opts.onProgress?.(done, total);
    }
  }
  opts.onProgress?.(done, total);
  if (opts.burn) await client.burn();
}
