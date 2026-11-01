#!/usr/bin/env node
/**
 * VEMS ECU emulator over a real serial port — for validating the protocol
 * against the genuine VemsTune via a com0com virtual null-modem pair.
 *
 * Usage:
 *   node src/emu.mjs --port COM10 [--baud 19200] [--ve <file.vtune|json>] [--serial v3.3_u001453]
 *     --serial: ECU serial; the letter after '_' is the bootloader type VemsTune assumes
 *               (n = plain .hex upload, u = encrypted .uhex upload).
 *     --reply-delay <ms>: wait before each reply, like a real ECU's latency.
 *   node src/emu.mjs --list            # list available serial ports
 *
 * Setup (Windows):
 *   1. Install com0com (null-modem emulator). Create a pair, e.g. COM10<->COM11.
 *   2. Run this harness on one end:   node src/emu.mjs --port COM10
 *   3. In genuine VemsTune, open the other end (COM11) at 19200 and connect.
 *      Our emulator answers detection, ECU details, page reads, realtime, write, burn.
 */
import { SerialPort } from 'serialport';
import { EcuEmulator } from '../../../packages/core/dist/index.js';

function parseArgs(argv) {
  const a = { baud: 19200 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--list') a.list = true;
    else if (k === '--port') a.port = argv[++i];
    else if (k === '--baud') a.baud = Number(argv[++i]);
    else if (k === '--ve') a.ve = argv[++i];
    else if (k === '--trace') a.trace = true;
    else if (k === '--serial') a.serial = argv[++i];
    else if (k === '--reply-delay') a.replyDelay = Number(argv[++i]);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.list || !args.port) {
    const ports = await SerialPort.list();
    console.log('Serial ports:');
    for (const p of ports) console.log(`  ${p.path}  ${p.manufacturer ?? ''} ${p.friendlyName ?? ''}`);
    if (!args.port) console.log('\nRun with: node src/emu.mjs --port <COMx> [--baud 19200]');
    return;
  }

  const port = new SerialPort({ path: args.port, baudRate: args.baud }, (err) => {
    if (err) {
      console.error(`Could not open ${args.port}: ${err.message}`);
      process.exit(1);
    }
    // Assert DTR/RTS like a real cable/ECU would: on a null-modem pair our DTR is the
    // host's DSR/DCD, and a host that opens its port with DSR sensitivity discards
    // every received byte while DSR is low.
    port.set({ dtr: true, rts: true }, (e) => e && console.error(`set DTR/RTS: ${e.message}`));
    if (args.trace) {
      let last = '';
      setInterval(() => port.get((e, s) => {
        const now = e ? `err ${e.message}` : `CTS=${+s.cts} DSR=${+s.dsr} DCD=${+s.dcd}`;
        if (now !== last) console.log(`${String(Date.now() - t0).padStart(7)}ms LINES ${now}`);
        last = now;
      }), 250);
    }
  });

  // --trace: timestamped hex dump of every chunk (RX = from VemsTune, TX = emulator reply)
  const t0 = Date.now();
  const trace = (dir, bytes) => {
    if (!args.trace) return;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`${String(Date.now() - t0).padStart(7)}ms ${dir} ${hex}`);
  };

  // Adapt node-serialport to the core SerialTransport interface.
  const listeners = new Set();
  const transport = {
    isOpen: true,
    async open() {},
    async close() { port.close(); },
    async write(data) {
      if (args.replyDelay) await new Promise((r) => setTimeout(r, args.replyDelay));
      trace('TX', data);
      await new Promise((res, rej) => port.write(Buffer.from(data), (e) => (e ? rej(e) : res())));
    },
    async setBaudRate(b) { await new Promise((r) => port.update({ baudRate: b }, r)); },
    onData(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
  port.on('data', (buf) => {
    trace('RX', buf);
    for (const cb of listeners) cb(new Uint8Array(buf));
  });

  // Seed pages (0..17) so page reads return data; VE (ecu 10) gets a pattern.
  const pages = new Map();
  for (let ecu = 0; ecu <= 17; ecu++)
    pages.set(ecu, Uint8Array.from({ length: 255 }, (_, i) => 50 + ((i * 5 + ecu * 13) % 150)));

  const rt = new Uint8Array(80);
  const emu = new EcuEmulator(transport, {
    details: {
      serialNumber: args.serial ?? 'v3.3_n001453',
      compilationTime: '2016-06-05 00:00',
      signature: 'VEMS Genboard v3, 1.2.34',
      mtCodeVer: 'VEMS v1.2.34 16x14 kpa=2,1',
    },
    pages,
    realtimeBlock: rt,
    bootSerial: args.serial ?? 'v3.3_n001453',
  });
  emu.start();

  let t = 0;
  setInterval(() => {
    t++;
    const rpm = 800 + Math.round(3000 * (0.5 + 0.5 * Math.sin(t / 10)));
    rt[14] = (rpm >> 8) & 0xff; rt[15] = rpm & 0xff;
    emu.setRealtimeBlock(rt);
  }, 100);

  console.log(`VEMS emulator listening on ${args.port} @ ${args.baud}. Point genuine VemsTune at the paired COM port.`);
  console.log('Ctrl+C to stop.');
}

main().catch((e) => { console.error(e); process.exit(1); });
