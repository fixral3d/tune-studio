/**
 * Raw ↔ engineering value codec (STDataModelSerial::getValue @0x7e4038).
 *   user = scale * (raw + translate)        raw = round(user/scale − translate)
 * Multi-byte integers are big-endian (AVR). Expression-based transforms
 * (fromRawExpr/toRawExpr) are deferred to the expression engine.
 */
import type { ArrayField, BitsField, IniType, ScalarField } from './field.js';

export function readRawInt(buf: Uint8Array, offset: number, type: IniType): number {
  let v = 0;
  for (let i = 0; i < type.size; i++) v = v * 256 + (buf[offset + i] ?? 0); // big-endian
  if (type.signed) {
    const bits = type.size * 8;
    const sign = 2 ** (bits - 1);
    if (v >= sign) v -= 2 ** bits;
  }
  return v;
}

export function writeRawInt(buf: Uint8Array, offset: number, type: IniType, raw: number): void {
  let v = Math.round(raw);
  if (v < 0) v += 2 ** (type.size * 8);
  for (let i = type.size - 1; i >= 0; i--) {
    buf[offset + i] = v & 0xff;
    v = Math.floor(v / 256);
  }
}

export function rawToUser(raw: number, scale: number, translate: number): number {
  return scale * (raw + translate);
}
export function userToRaw(user: number, scale: number, translate: number): number {
  return Math.round(user / scale - translate);
}

export function readScalar(buf: Uint8Array, f: ScalarField): number {
  return rawToUser(readRawInt(buf, f.offset, f.type), f.scale, f.translate);
}
export function writeScalar(buf: Uint8Array, f: ScalarField, user: number): void {
  writeRawInt(buf, f.offset, f.type, userToRaw(user, f.scale, f.translate));
}

/** Linear element count of an array field. */
export function arrayLength(f: ArrayField): number {
  return f.shape.dims.length === 1 ? f.shape.dims[0] : f.shape.dims[0] * f.shape.dims[1]!;
}

/** Element index for a 2D array (x fast when order=1): idx = y*xlen + x. */
export function array2dIndex(f: ArrayField, x: number, y: number): number {
  const xlen = f.shape.dims[0];
  return f.shape.order === 1 ? y * xlen + x : x * (f.shape.dims[1] ?? 1) + y;
}

export function readArray(buf: Uint8Array, f: ArrayField): number[] {
  const out: number[] = [];
  const len = arrayLength(f);
  for (let i = 0; i < len; i++) {
    const raw = readRawInt(buf, f.offset + i * f.type.size, f.type);
    out.push(rawToUser(raw, f.scale, f.translate));
  }
  return out;
}

export function writeArrayElement(buf: Uint8Array, f: ArrayField, index: number, user: number): void {
  writeRawInt(buf, f.offset + index * f.type.size, f.type, userToRaw(user, f.scale, f.translate));
}

/** Extract the bit field value (plus display offset) from the byte(s) at offset. */
export function readBits(buf: Uint8Array, f: BitsField): number {
  const raw = readRawInt(buf, f.offset, { ...f.type, signed: false });
  const width = f.bitHi - f.bitLo + 1;
  const mask = (1 << width) - 1;
  return ((raw >> f.bitLo) & mask) + f.bitOfs;
}

export function writeBits(buf: Uint8Array, f: BitsField, value: number): void {
  const raw = readRawInt(buf, f.offset, { ...f.type, signed: false });
  const width = f.bitHi - f.bitLo + 1;
  const mask = (1 << width) - 1;
  const v = (value - f.bitOfs) & mask;
  const cleared = raw & ~(mask << f.bitLo);
  writeRawInt(buf, f.offset, { ...f.type, signed: false }, cleared | (v << f.bitLo));
}
