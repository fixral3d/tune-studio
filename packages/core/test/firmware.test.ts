import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFirmware, parseIHex } from '../src/index.js';

const TARGET = join(__dirname, '../../../re/target/vemstune-1.5.46');
const read = (p: string) => readFileSync(join(TARGET, p), 'latin1');

describe('plain .hex (Intel HEX)', () => {
  const img = loadFirmware(read('vemsprojects/firmware_1.1.94/vems.hex'));
  it('detects intel-hex and verifies every record checksum', () => {
    expect(img.kind).toBe('intel-hex');
    expect(img.checksumOk).toBe(true);
    expect(img.pages.length).toBeGreaterThan(0);
  });
  it('groups bytes into 256-byte pages', () => {
    for (const p of img.pages) expect(p.address).toBe(p.index * 256);
  });
});

describe('crypto .uhex / .chex', () => {
  it('.uhex detects crypto-chex, keeps ciphertext, no decrypt needed', () => {
    const img = loadFirmware(read('vemsprojects/firmware_1.1.94/vems.uhex'));
    expect(img.kind).toBe('crypto-chex');
    expect(img.checksumOk).toBe(true);
    expect(img.pages.length).toBeGreaterThan(0);
  });
  it('.chex / .chex2 carry a per-page 32-bit tag on the first record', () => {
    const chex = parseIHex(read('config/fw/markerword_erase.chex'));
    const first = chex.records.find((r) => r.type === 'data');
    expect(chex.crypto).toBe(true);
    expect(first?.tag).toBe(0xa66e23c6);
    const chex2 = parseIHex(read('config/fw/markerword_erase.chex2'));
    expect(chex2.records.find((r) => r.type === 'data')?.tag).toBe(0x3af83b80);
  });
  it('handles ext-segment (type 02) base addressing in markerword_erase.uhex', () => {
    const p = parseIHex(read('config/fw/markerword_erase.uhex'));
    // :02000002 1000 → base 0x10000, then 10F70000 → 0x1F700 (V3 marker page region)
    const data = p.records.filter((r) => r.type === 'data');
    expect(data[0]?.address).toBe(0x1f700);
  });
});

describe('every firmware/patch file shipped with VemsTune opens cleanly', () => {
  const EXT: Record<string, boolean> = {
    hex: false, clt: false, air: false, uhex: true, chex: true, chex2: true, uclt: true, uair: true,
  };
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.split('.').pop()!.toLowerCase() in EXT) files.push(p);
    }
  };
  walk(TARGET);
  const imgs = new Map(files.map((f) => [f, loadFirmware(readFileSync(f, 'latin1'))]));

  it('finds the full set (5 hex, 4 uhex, 2 chex, 162 clt/uclt, 316 air/uair)', () => {
    expect(files.length).toBe(489);
  });
  it('checksums verify, kind matches extension, crypto pages all tagged', () => {
    for (const [f, img] of imgs) {
      const crypto = EXT[f.split('.').pop()!.toLowerCase()];
      expect(img.checksumOk, f).toBe(true);
      expect(img.kind === 'crypto-chex', f).toBe(crypto);
      expect(img.pages.length, f).toBeGreaterThan(0);
      if (crypto) expect(img.pages.filter((p) => p.tag === undefined).length, f).toBe(0);
    }
  });
  it('plain and crypto twins cover the same flash pages', () => {
    const twin: Record<string, string> = { hex: 'uhex', clt: 'uclt', air: 'uair' };
    let pairs = 0;
    for (const [f, img] of imgs) {
      const ext = f.split('.').pop()!;
      const u = twin[ext.toLowerCase()] && imgs.get(f.slice(0, -ext.length) + twin[ext.toLowerCase()]);
      if (!u) continue;
      pairs++;
      expect(u.pages.map((p) => p.index), f).toEqual(img.pages.map((p) => p.index));
    }
    expect(pairs).toBe(242);
  });
});
