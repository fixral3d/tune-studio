import { describe, expect, it } from 'vitest';
import { buildTfBody, encodeTf, encodeTfBody, responseType, TfParser } from '../src/index.js';

const hex = (u: Uint8Array) =>
  [...u].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

/** Golden wire bytes from PROTOCOL.md §4.1 (decompile-derived, CRC verified). */
describe('TF wire encoding — golden frames', () => {
  const cases: [string, Parameters<typeof encodeTf>[0], string][] = [
    ['CRC error reply', { type: 0x7f, data: Uint8Array.of(0x02) }, '02 7F 41 30 7E'],
    ['realtime request', { type: 0xa0 }, 'A0 BF 38 7E'],
    ['ECU details sub 4', { type: 0xf2, subtype: 0x04 }, '04 F2 82 F5 7E'],
    ['burn', { type: 0xef, data: Uint8Array.of(0x04) }, '04 EF 42 FC 7E'],
    ['page read ecu id 1', { type: 0xf4, value: 0xff01 }, 'FF 01 F4 41 E7 7E'],
  ];
  it.each(cases)('%s', (_name, opts, wire) => {
    expect(hex(encodeTf(opts))).toBe(wire);
  });
});

describe('TF body builder', () => {
  it('encodes 0xF4/0xFB value as 16-bit big-endian', () => {
    expect(hex(buildTfBody({ type: 0xf4, value: 0xff01 }))).toBe('FF 01 F4');
  });
  it('encodes 0xF5 value as a single byte', () => {
    expect(hex(buildTfBody({ type: 0xf5, value: 0x0c }))).toBe('0C F5');
  });
  it('encodes a generic value as 4 bytes', () => {
    expect(hex(buildTfBody({ type: 0x30, value: 0x010203 }))).toBe('00 01 02 03 30');
  });
});

describe('TF parser', () => {
  it('round-trips and detects type + CRC', () => {
    const wire = encodeTf({ type: 0xf2, subtype: 4 });
    const frames = [...new TfParser().feedAll(wire)];
    expect(frames).toHaveLength(1);
    expect(frames[0]?.crcOk).toBe(true);
    expect(frames[0]?.type).toBe(0xf2);
    expect(hex(frames[0]!.body)).toBe('04 F2');
  });
  it('unescapes 0x7D/0x7E in payload', () => {
    const wire = encodeTf({ type: 0x74, data: Uint8Array.of(0x7e, 0x7d, 0x11) });
    const [f] = [...new TfParser().feedAll(wire)];
    expect(f?.crcOk).toBe(true);
    expect([...f!.body]).toEqual([0x7e, 0x7d, 0x11, 0x74]);
  });
  it('flags CRC errors', () => {
    const wire = encodeTf({ type: 0xa0 });
    wire[1] ^= 0xff; // corrupt a CRC byte
    const [f] = [...new TfParser().feedAll(wire)];
    expect(f?.crcOk).toBe(false);
  });
  it('response type = request − 0x80', () => {
    expect(responseType(0xf2)).toBe(0x72);
    expect(responseType(0xa0)).toBe(0x20);
    expect(responseType(0xfb)).toBe(0x7b);
  });
});
