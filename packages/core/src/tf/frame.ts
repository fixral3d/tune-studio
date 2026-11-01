/**
 * TriggerFrame (TF) — the on-wire binary protocol for V3 firmware >= 1.1.98
 * (PROTOCOL.md §4). HDLC-like: body + CRC-16/MODBUS (LE), then byte-stuffed
 * and terminated with 0x7E.
 *
 *   body  = data[0..k)  [value: 0/1/2/4 B]  [subtype: 0/1 B]  type(1 B)
 *   wire  = escape(body ‖ crcLo ‖ crcHi) ‖ 0x7E
 *   escape: 0x7D→7D 5D, 0x7E→7D 5E, else verbatim
 *   type  = last body byte;  response type = request type − 0x80
 *
 * CRC is Math::crc16_sipr (CRC-16/MODBUS) — the same routine as SIPR.
 * Refs: TriggerFrameEx::create @0x0081eaf8, TriggerFrame::create @0x00e970e8,
 * escape @0x00e97248, TriggerFrameFSM::parse @0x0082056c, checkCRC @0x00820a22.
 */
import { crc16Sipr } from '../sipr/crc.js';

export const TF_FLAG = 0x7e;
export const TF_ESC = 0x7d;

export interface TfBuildOptions {
  type: number;
  /** prepended data bytes (e.g. error reason/category, burn subcommand). */
  data?: Uint8Array;
  /** non-negative scalar; encoded per type (see below). omit/<0 = none. */
  value?: number;
  /** non-negative subtype byte. omit/<0 = none. */
  subtype?: number;
}

/** Build the logical body (pre-CRC, pre-escape) exactly as TriggerFrameEx::create. */
export function buildTfBody(o: TfBuildOptions): Uint8Array {
  const bytes: number[] = [];
  if (o.data) bytes.push(...o.data);
  if (o.value !== undefined && o.value >= 0) {
    const v = o.value;
    if (o.type === 0xf5) {
      bytes.push(v & 0xff);
    } else if (o.type === 0xf4 || o.type === 0xf9 || o.type === 0xfb) {
      bytes.push((v >> 8) & 0xff, v & 0xff); // big-endian 16-bit
    } else {
      bytes.push(0, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff); // 4-byte
    }
  }
  if (o.subtype !== undefined && o.subtype >= 0) bytes.push(o.subtype & 0xff);
  bytes.push(o.type & 0xff);
  return Uint8Array.from(bytes);
}

function escapeInto(out: number[], b: number): void {
  if (b === TF_FLAG || b === TF_ESC) {
    out.push(TF_ESC, b ^ 0x20);
  } else {
    out.push(b);
  }
}

/** Encode a logical body to wire bytes (append CRC-16/MODBUS LE, stuff, add 0x7E). */
export function encodeTfBody(body: Uint8Array): Uint8Array {
  const crc = crc16Sipr(body);
  const out: number[] = [];
  for (const b of body) escapeInto(out, b);
  escapeInto(out, crc & 0xff);
  escapeInto(out, (crc >> 8) & 0xff);
  out.push(TF_FLAG);
  return Uint8Array.from(out);
}

/** Convenience: build + encode in one step. */
export function encodeTf(o: TfBuildOptions): Uint8Array {
  return encodeTfBody(buildTfBody(o));
}

export interface TfFrame {
  /** logical body with the trailing CRC removed. */
  body: Uint8Array;
  /** last body byte. */
  type: number;
  crcOk: boolean;
}

/**
 * Streaming TF parser: de-stuffs bytes, splits on 0x7E, checks CRC.
 * Mirrors TriggerFrameFSM::parse / TriggerFrameFSMCRC::checkCRC.
 */
export class TfParser {
  private buf: number[] = [];
  private escaped = false;

  reset(): void {
    this.buf = [];
    this.escaped = false;
  }

  feed(b: number): TfFrame | undefined {
    if (this.escaped) {
      this.buf.push(b ^ 0x20);
      this.escaped = false;
      return undefined;
    }
    if (b === TF_ESC) {
      this.escaped = true;
      return undefined;
    }
    if (b === TF_FLAG) {
      const raw = Uint8Array.from(this.buf);
      this.buf = [];
      if (raw.length < 3) return undefined; // too short to hold CRC
      const body = raw.subarray(0, raw.length - 2);
      const rxCrc = raw[raw.length - 2]! | (raw[raw.length - 1]! << 8);
      const crcOk = crc16Sipr(body) === rxCrc;
      return { body: body.slice(), type: body[body.length - 1]!, crcOk };
    }
    this.buf.push(b);
    return undefined;
  }

  *feedAll(bytes: Uint8Array): Generator<TfFrame> {
    for (const b of bytes) {
      const f = this.feed(b);
      if (f) yield f;
    }
  }
}

/** Response type for a request type: request − 0x80 (SynchronousHandler rule). */
export function responseType(requestType: number): number {
  return (requestType - 0x80) & 0xff;
}
