/**
 * CRC routines used by VemsTune 1.5.46.
 * - crc16Sipr: Math::crc16_sipr @0x00bf971c — CRC-16/MODBUS (reflected poly 0xA001, init 0xFFFF).
 * - crc16Ccitt: Math::crc16 @0x00bf96be — poly 0x1021, MSB-first (used by getCRC / SD card).
 */
export function crc16SiprStep(crc: number, byte: number): number {
  crc = (crc ^ byte) & 0xffff;
  for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  return crc;
}

export function crc16Sipr(data: Uint8Array, init = 0xffff): number {
  let crc = init;
  for (const b of data) crc = crc16SiprStep(crc, b);
  return crc;
}

export function crc16CcittStep(crc: number, byte: number): number {
  crc = (crc ^ (byte << 8)) & 0xffff;
  for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  return crc;
}

export function crc16Ccitt(data: Uint8Array, init = 0): number {
  let crc = init;
  for (const b of data) crc = crc16CcittStep(crc, b);
  return crc;
}
