import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EcuEmulator, loadFirmware, MemoryPipe, pageChecksum, uploadFirmware } from '../src/index.js';

const TARGET = join(__dirname, '../../../re/target/vemstune-1.5.46');
const fw = (p: string) => loadFirmware(readFileSync(join(TARGET, p), 'latin1'));

async function rig(serial: string) {
  const pipe = new MemoryPipe();
  await pipe.a.open();
  await pipe.b.open();
  const ecu = new EcuEmulator(pipe.b, { bootSerial: serial });
  ecu.start();
  return { host: pipe.a, ecu };
}

describe('bootloader checksum (FirmwareData::getPageCheckSum)', () => {
  it('reproduces the two constants BootStateDetector expects for marker page 0x1F7', () => {
    const page = new Uint8Array(256).fill(0xff);
    expect(pageChecksum(page, (0x1f7 * 256) / 2)).toBe(0xfb00fb80); // "Bad marker (old)"
    page[0xfe] = 0x5a;
    page[0xff] = 0xa5;
    expect(pageChecksum(page, (0x1f7 * 256) / 2)).toBe(0xa05ba125); // "From Fw (old)"
  });
  it('low word equals the .uhex tag low word on every page (plain vs crypto twin)', () => {
    const plain = fw('vemsprojects/firmware_1.1.94/vems.hex');
    const tags = new Map(fw('vemsprojects/firmware_1.1.94/vems.uhex').pages.map((p) => [p.index, p.tag!]));
    for (const p of plain.pages) expect(pageChecksum(p.data, p.address >> 1) & 0xffff).toBe(tags.get(p.index)! & 0xffff);
  });
});

describe('uploadFirmware ↔ emulated V3 bootloader', () => {
  it('plain .hex: erase, Dkk pages, Dll verify, leaves boot mode', async () => {
    const { host, ecu } = await rig('v3.3_n001453');
    const img = fw('vemsprojects/firmware_1.1.94/vems.hex');
    const res = await uploadFirmware(host, img);
    expect(res.serial).toBe('v3.3_n001453');
    expect(res.pagesWritten).toBe(387);
    expect(res.mismatches).toEqual([]);
    expect(ecu.inBoot).toBe(false);
    for (const p of img.pages) expect(ecu.bootloader.flash.get(p.index)?.data).toEqual(p.data);
    expect(ecu.bootloader.flash.get(0x1f7)!.data.subarray(0xfe)).toEqual(Uint8Array.of(0x5a, 0xa5));
  });

  it('.uhex: marker page then Dcc ciphertext+tag pages, DCC verify', async () => {
    const { host, ecu } = await rig('v3.3_u001453');
    const img = fw('vemsprojects/firmware_1.1.94/vems.uhex');
    const marker = fw('config/fw/markerword_erase.uhex');
    const phases = new Set<string>();
    const res = await uploadFirmware(host, img, { marker, onProgress: (p) => phases.add(p.phase) });
    expect(res.mismatches).toEqual([]);
    expect([...phases]).toEqual(['enter', 'marker', 'upload', 'verify', 'done']);
    for (const p of img.pages) {
      const f = ecu.bootloader.flash.get(p.index)!;
      expect(f.crypto).toBe(true);
      expect(f.tag).toBe(p.tag);
      expect(f.data).toEqual(p.data);
    }
  });

  it('verify reports a page whose flash differs', async () => {
    const { host, ecu } = await rig('v3.3_n001453');
    const img = fw('vemsprojects/firmware_1.1.94/vems.hex');
    const res = await uploadFirmware(host, img, {
      // corrupt one flash byte after the last page is written, before verify starts
      onProgress: (p) => p.phase === 'upload' && p.page === p.total && (ecu.bootloader.flash.get(5)!.data[0] ^= 1),
    });
    expect(res.mismatches).toEqual([5]);
  });
});
