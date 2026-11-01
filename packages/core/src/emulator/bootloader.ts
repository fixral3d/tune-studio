/**
 * V3 bootloader emulator — the raw-byte protocol VemsTune's FirmwareUploader /
 * FirmwareVerifier speak once the ECU is in boot mode (re/specs/BOOTLOADER.md §7).
 * No framing, no CRC; one ack byte per command, unknown bytes ignored.
 *
 *   'S'                 → "AVR3" + serial(12)  (serial[0]='v' doubles as boot state)
 *   'A' hi lo           → 0D   (crypto: page number, plain: word address; BE)
 *   'D' c c data tag4   → 0D   encrypted page + its 32-bit tag (BE)
 *   'D' k k data cs4    → 0D   plain page + checksum (BE)
 *   'D' C C / 'D' l l   → 4-byte BE tag / checksum of the addressed page
 *   'D' DE AD BE EF     → 0D   erase marker page
 *   'e'                 → 0D   erase all;  'E' → leave boot mode
 *
 * Ciphertext is stored as-is (real decryption needs the bootloader's key), so
 * 'DCC' answers with the uploaded tag — exactly what the host compares against.
 */
export interface BootloaderOptions {
  /** 12-char serial; letter after '_' selects VemsTune's boot type (u = UHEX). */
  serial?: string;
  pageSize?: number;
}

export interface FlashPage {
  data: Uint8Array;
  tag: number;
  crypto: boolean;
}

/** FirmwareData::getPageCheckSum — hi = aw + Σw, lo = aw ^ ⊕w over LE words. */
export function pageChecksum(data: Uint8Array, wordAddress: number): number {
  let hi = wordAddress & 0xffff;
  let lo = wordAddress & 0xffff;
  for (let i = 0; i < data.length; i += 2) {
    const w = data[i]! | (data[i + 1]! << 8);
    hi = (hi + w) & 0xffff;
    lo ^= w;
  }
  return ((hi << 16) | lo) >>> 0;
}

const be32 = (v: number) => Uint8Array.of(v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);

export class BootloaderEmulator {
  readonly serial: string;
  readonly pageSize: number;
  /** flash keyed by page index. */
  readonly flash = new Map<number, FlashPage>();
  /** set when 'E' arrives; owner switches back to application mode. */
  left = false;
  private addr = 0;
  private cmd: number[] = [];

  constructor(opts: BootloaderOptions = {}) {
    this.serial = opts.serial ?? 'v3.3_u001453';
    this.pageSize = opts.pageSize ?? 256;
  }

  /** Feed received bytes; returns the reply bytes (possibly empty). */
  feed(data: Uint8Array): Uint8Array {
    const out: number[] = [];
    for (const b of data) out.push(...this.byte(b));
    return Uint8Array.from(out);
  }

  private pageOf(crypto: boolean): number {
    return crypto ? this.addr : (this.addr * 2) / this.pageSize;
  }

  private byte(b: number): number[] {
    const c = this.cmd;
    if (c.length === 0) {
      switch (b) {
        case 0x53: // 'S'
          return [...new TextEncoder().encode('AVR3' + this.serial)];
        case 0x65: // 'e'
          this.flash.clear();
          return [0x0d];
        case 0x45: // 'E'
          this.left = true;
          return [];
        case 0x41: // 'A'
        case 0x44: // 'D'
          c.push(b);
          return [];
        default:
          return []; // probe leftovers etc.
      }
    }
    c.push(b);
    if (c[0] === 0x41) {
      if (c.length < 3) return [];
      this.addr = (c[1]! << 8) | c[2]!;
      this.cmd = [];
      return [0x0d];
    }
    // 'D' op op ...
    if (c.length < 3) return [];
    const op = String.fromCharCode(c[1]!, c[2]!);
    switch (op) {
      case 'cc':
      case 'kk': {
        if (c.length < 3 + this.pageSize + 4) return [];
        const data = Uint8Array.from(c.slice(3, 3 + this.pageSize));
        const t = c.slice(3 + this.pageSize);
        const tag = ((t[0]! << 24) | (t[1]! << 16) | (t[2]! << 8) | t[3]!) >>> 0;
        const crypto = op === 'cc';
        const page = this.pageOf(crypto);
        this.cmd = [];
        if (!crypto && pageChecksum(data, this.addr) !== tag) return [0x4e]; // 'N'
        this.flash.set(page, { data, tag, crypto });
        return [0x0d];
      }
      case 'CC':
      case 'll': {
        this.cmd = [];
        const crypto = op === 'CC';
        const page = this.pageOf(crypto);
        const p = this.flash.get(page);
        if (p?.crypto) return [...be32(p.tag)];
        const data = p?.data ?? new Uint8Array(this.pageSize).fill(0xff);
        return [...be32(pageChecksum(data, (page * this.pageSize) / 2))];
      }
      case '\xde\xad': {
        if (c.length < 5) return [];
        this.cmd = [];
        this.flash.delete(0x1f7);
        return [0x0d];
      }
      default:
        this.cmd = [];
        return [];
    }
  }
}
