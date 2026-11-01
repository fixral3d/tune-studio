#!/usr/bin/env node
/**
 * Upload a firmware file (.hex / .uhex) to a VEMS V3 bootloader over a serial port,
 * using @vems/core uploadFirmware (same wire protocol as VemsTune, re/specs/BOOTLOADER.md).
 *
 * Usage:
 *   node src/flash.mjs --port COM11 --file vems.uhex [--marker markerword_erase.uhex] [--baud 19200]
 *                      [--no-tf] [--no-verify]
 *   --marker: defaults to VemsTune's config/fw/markerword_erase.uhex for encrypted files.
 *   --no-tf:  ECU already sits in its bootloader (skip the TF FE F6 command).
 */
import { readFileSync } from 'node:fs';
import { SerialPort } from 'serialport';
import { loadFirmware, uploadFirmware } from '../../../packages/core/dist/index.js';

const DEFAULT_MARKER = new URL('../../../re/target/vemstune-1.5.46/config/fw/markerword_erase.uhex', import.meta.url);

function parseArgs(argv) {
  const a = { baud: 19200, tf: true, verify: true };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--port') a.port = argv[++i];
    else if (k === '--file') a.file = argv[++i];
    else if (k === '--marker') a.marker = argv[++i];
    else if (k === '--baud') a.baud = Number(argv[++i]);
    else if (k === '--no-tf') a.tf = false;
    else if (k === '--no-verify') a.verify = false;
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.port || !args.file) {
    console.log('Usage: node src/flash.mjs --port <COMx> --file <firmware.hex|.uhex> [--marker <file>]');
    process.exit(1);
  }
  const img = loadFirmware(readFileSync(args.file, 'latin1'));
  if (!img.checksumOk) throw new Error(`${args.file}: Intel HEX checksum error`);
  const crypto = img.kind === 'crypto-chex';
  const marker = crypto ? loadFirmware(readFileSync(args.marker ?? DEFAULT_MARKER, 'latin1')) : undefined;
  console.log(`${args.file}: ${img.kind}, ${img.pages.length} pages, ${img.totalBytes} bytes`);

  const port = await new Promise((res, rej) => {
    const p = new SerialPort({ path: args.port, baudRate: args.baud }, (e) => (e ? rej(e) : res(p)));
  });
  await new Promise((r) => port.set({ dtr: true, rts: true }, r));
  const listeners = new Set();
  port.on('data', (buf) => listeners.forEach((cb) => cb(new Uint8Array(buf))));
  const transport = {
    isOpen: true,
    async open() {},
    async close() { port.close(); },
    write: (d) => new Promise((res, rej) => port.write(Buffer.from(d), (e) => (e ? rej(e) : port.drain(res)))),
    async setBaudRate(b) { await new Promise((r) => port.update({ baudRate: b }, r)); },
    onData(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };

  const t0 = Date.now();
  let last = '';
  const res = await uploadFirmware(transport, img, {
    marker,
    fromTriggerFrame: args.tf,
    verify: args.verify,
    onProgress: (p) => {
      const line = `${p.phase} ${p.page}/${p.total}`;
      if (p.phase !== last || p.page % 50 === 0 || p.page === p.total) console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s ${line}`);
      last = p.phase;
    },
  });
  console.log(`ECU serial: ${res.serial}`);
  console.log(`pages written: ${res.pagesWritten}`);
  console.log(args.verify ? (res.mismatches.length ? `VERIFY FAILED on pages: ${res.mismatches.map((i) => '0x' + i.toString(16)).join(' ')}` : 'verify: firmware is identical') : 'verify skipped');
  port.close();
  process.exit(res.mismatches.length ? 2 : 0);
}

main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
