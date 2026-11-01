import { crc16Sipr, crc16SiprStep } from './crc.js';

/** Frame constants — SIPRPacket::SIPR_SIGN / SIPR_FRAME_SIZE / SIPR_MAX_DATA_SIZE. */
export const SIPR_SIGN = 0x0a;
export const SIPR_FRAME_SIZE = 6;
export const SIPR_MAX_DATA_SIZE = 255;

export interface SiprPacket {
  sequence: number;
  type: number;
  payload: Uint8Array;
}

/**
 * Encode a frame: [0x0A, seq, type, len, payload..., crcLo, crcHi].
 * CRC-16/MODBUS over seq..payload (SIPRPacket::init @0x00bb991c, setCRC @0x00bb9afc).
 */
export function encodeSipr(p: SiprPacket): Uint8Array {
  const len = p.payload.length;
  if (len > SIPR_MAX_DATA_SIZE) throw new RangeError(`SIPR payload too long: ${len}`);
  const out = new Uint8Array(len + SIPR_FRAME_SIZE);
  out[0] = SIPR_SIGN;
  out[1] = p.sequence & 0xff;
  out[2] = p.type & 0xff;
  out[3] = len;
  out.set(p.payload, 4);
  const crc = crc16Sipr(out.subarray(1, 4 + len));
  out[4 + len] = crc & 0xff;
  out[5 + len] = crc >>> 8;
  return out;
}

export type FeedResult =
  | { kind: 'packet'; packet: SiprPacket }
  | { kind: 'crc-error'; packet: SiprPacket; expected: number; received: number };

/**
 * Byte-wise stream parser mirroring SIPRParser::feed @0x00bbb232.
 * Resyncs on 0x0A only while idle; no byte stuffing.
 */
export class SiprParser {
  private state = 0;
  private crc = 0xffff;
  private seq = 0;
  private type = 0;
  private len = 0;
  private idx = 0;
  private data = new Uint8Array(SIPR_MAX_DATA_SIZE);
  private rxCrc = 0;

  reset(): void {
    this.state = 0;
    this.idx = 0;
    this.crc = 0xffff;
  }

  feed(b: number): FeedResult | undefined {
    switch (this.state) {
      case 0:
        if (b === SIPR_SIGN) {
          this.reset();
          this.state = 1;
        }
        return undefined;
      case 1:
        this.seq = b;
        this.crc = crc16SiprStep(0xffff, b);
        this.state = 2;
        return undefined;
      case 2:
        this.type = b;
        this.crc = crc16SiprStep(this.crc, b);
        this.state = 3;
        return undefined;
      case 3:
        this.len = b;
        this.crc = crc16SiprStep(this.crc, b);
        this.state = b === 0 ? 5 : 4;
        return undefined;
      case 4:
        this.data[this.idx++] = b;
        this.crc = crc16SiprStep(this.crc, b);
        if (this.idx === this.len) this.state = 5;
        return undefined;
      case 5:
        this.rxCrc = b;
        this.state = 6;
        return undefined;
      case 6: {
        this.rxCrc |= b << 8;
        this.state = 0;
        const packet: SiprPacket = {
          sequence: this.seq,
          type: this.type,
          payload: this.data.slice(0, this.len),
        };
        return this.crc === this.rxCrc
          ? { kind: 'packet', packet }
          : { kind: 'crc-error', packet, expected: this.crc, received: this.rxCrc };
      }
    }
    return undefined;
  }

  *feedAll(bytes: Uint8Array): Generator<FeedResult> {
    for (const b of bytes) {
      const r = this.feed(b);
      if (r) yield r;
    }
  }
}
