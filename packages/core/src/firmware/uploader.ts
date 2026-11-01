/**
 * Firmware uploader for the VEMS V3 bootloader — the same raw-byte protocol
 * VemsTune's FirmwareUploader / FirmwareVerifier use (re/specs/BOOTLOADER.md):
 *
 *   enter:  TF frame FE F6 (GO_BOOTLOADER), then 'S' until "AVR3"+serial(12)
 *   plain:  'e' → 0D, then per page 'A' wordAddr → 0D, 'D' 'k' 'k' data cs4 → 0D
 *   crypto: marker page first, then per page 'A' pageNo → 0D, 'D' 'c' 'c' data tag4 → 0D
 *   verify: per page 'A' … → 0D, 'D' 'l' 'l' / 'D' 'C' 'C' → 4-byte BE checksum
 *   leave:  "E."
 *
 * Encrypted (.uhex) pages go out as-is with their per-page tag; the bootloader
 * decrypts. Plain pages carry FirmwareData::getPageCheckSum.
 */
import type { SerialTransport } from '../transport/serial.js';
import { encodeTfBody } from '../tf/frame.js';
import { pageChecksum } from '../emulator/bootloader.js';
import type { FirmwareImage, FirmwarePage } from './firmware.js';

export interface UploadProgress {
  phase: 'enter' | 'erase' | 'marker' | 'upload' | 'verify' | 'done';
  page: number;
  total: number;
}

export interface UploadOptions {
  /** markerword_erase.uhex image, uploaded first for encrypted firmware. */
  marker?: FirmwareImage;
  /** ECU currently runs TriggerFrame firmware (send FE F6 first). Default true. */
  fromTriggerFrame?: boolean;
  /** per-reply timeout in ms (VemsTune default 200; erase-all gets 3000). */
  timeoutMs?: number;
  /** retries per page on a non-0D reply. Default 3. */
  retries?: number;
  verify?: boolean;
  onProgress?: (p: UploadProgress) => void;
}

export interface UploadResult {
  serial: string;
  pagesWritten: number;
  /** pages whose read-back checksum differed (empty = identical). */
  mismatches: number[];
}

const ACK = 0x0d;
/** V3 flash pages the bootloader accepts (0..0x1F7). */
const V3_LAST_PAGE = 0x1f7;

/** Byte queue over a SerialTransport with timed reads. */
class ByteReader {
  private buf: number[] = [];
  private wake: (() => void) | undefined;
  private unsub: () => void;
  constructor(t: SerialTransport) {
    this.unsub = t.onData((d) => {
      this.buf.push(...d);
      this.wake?.();
    });
  }
  dispose(): void {
    this.unsub();
  }
  clear(): void {
    this.buf = [];
  }
  async read(n: number, timeoutMs: number): Promise<number[] | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (this.buf.length < n) {
      const left = deadline - Date.now();
      if (left <= 0) return undefined;
      await new Promise<void>((res) => {
        const timer = setTimeout(res, left);
        this.wake = () => {
          clearTimeout(timer);
          res();
        };
      });
      this.wake = undefined;
    }
    return this.buf.splice(0, n);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const be32 = (v: number) => [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];

export async function uploadFirmware(
  t: SerialTransport,
  img: FirmwareImage,
  opts: UploadOptions = {},
): Promise<UploadResult> {
  const timeout = opts.timeoutMs ?? 200;
  const retries = opts.retries ?? 3;
  const crypto = img.kind === 'crypto-chex';
  const progress = opts.onProgress ?? (() => {});
  const pages = img.pages.filter((p) => p.index <= V3_LAST_PAGE);
  const rx = new ByteReader(t);
  const send = (bytes: number[]) => t.write(Uint8Array.from(bytes));

  const expectAck = async (ms = timeout) => (await rx.read(1, ms))?.[0] === ACK;
  const address = (p: FirmwarePage, isCrypto: boolean) => {
    const a = isCrypto ? p.index : p.address >> 1;
    return [0x41, (a >> 8) & 0xff, a & 0xff];
  };
  const tagOf = (p: FirmwarePage, isCrypto: boolean) =>
    isCrypto ? p.tag! : pageChecksum(p.data, p.address >> 1);

  const writePage = async (p: FirmwarePage, isCrypto: boolean) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      rx.clear();
      await send(address(p, isCrypto));
      if (!(await expectAck())) continue;
      const op = isCrypto ? 0x63 : 0x6b; // 'cc' / 'kk'
      await send([0x44, op, op, ...p.data, ...be32(tagOf(p, isCrypto))]);
      if (await expectAck(timeout + p.data.length * 2)) return;
    }
    throw new Error(`page 0x${p.index.toString(16)} not acknowledged`);
  };

  try {
    // enter bootloader
    progress({ phase: 'enter', page: 0, total: pages.length });
    if (opts.fromTriggerFrame ?? true) {
      await t.write(encodeTfBody(Uint8Array.of(0xfe, 0xf6)));
      await sleep(30);
    }
    let serial: string | undefined;
    for (let i = 0; i < 10 && !serial; i++) {
      rx.clear();
      await send([0x53]); // 'S'
      const id = await rx.read(16, timeout + 256);
      const s = id && String.fromCharCode(...id);
      if (s?.startsWith('AVR3')) serial = s.slice(4);
    }
    if (!serial) throw new Error('bootloader not found (no "AVR3" reply)');
    await sleep(50);
    rx.clear();

    if (crypto) {
      if (opts.marker) {
        progress({ phase: 'marker', page: 0, total: opts.marker.pages.length });
        for (const p of opts.marker.pages) await writePage(p, true);
      }
    } else {
      progress({ phase: 'erase', page: 0, total: pages.length });
      await send([0x65]); // 'e'
      if (!(await expectAck(3000))) throw new Error('erase-all not acknowledged');
    }

    let n = 0;
    for (const p of pages) {
      await writePage(p, crypto);
      progress({ phase: 'upload', page: ++n, total: pages.length });
    }

    const mismatches: number[] = [];
    if (opts.verify ?? true) {
      n = 0;
      const op = crypto ? 0x43 : 0x6c; // 'CC' / 'll'
      for (const p of pages) {
        rx.clear();
        await send(address(p, crypto));
        if (!(await expectAck())) throw new Error(`verify: address 0x${p.index.toString(16)} not acknowledged`);
        await send([0x44, op, op]);
        const cs = await rx.read(4, timeout);
        if (!cs) throw new Error(`verify: no checksum for page 0x${p.index.toString(16)}`);
        const got = ((cs[0]! << 24) | (cs[1]! << 16) | (cs[2]! << 8) | cs[3]!) >>> 0;
        if (got !== tagOf(p, crypto)) mismatches.push(p.index);
        progress({ phase: 'verify', page: ++n, total: pages.length });
      }
    }

    await send([0x45, 0x2e]); // "E." — leave the bootloader
    progress({ phase: 'done', page: pages.length, total: pages.length });
    return { serial, pagesWritten: pages.length, mismatches };
  } finally {
    rx.dispose();
  }
}
