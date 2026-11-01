/**
 * Intel HEX record parser covering both VemsTune container variants
 * (IHexParser @0x004cbbc8 and friends):
 *   - plain ".hex":              :LLAAAATT<data><cc>
 *   - crypto ".uhex/.chex/.chex2": C:<intel-hex-record>[:TAG8]
 * The "C:" prefix marks a crypto container (FirmwareData type 2 = "Crypto CHEX");
 * the optional :TAG8 (8 hex chars = one 32-bit tag per page) rides on the first
 * record of each flash page. Record data is stored verbatim — for crypto files it
 * is ciphertext; VemsTune does not decrypt on load.
 */
export type IHexRecordType =
  | 'data' // 00
  | 'eof' // 01
  | 'ext-segment' // 02
  | 'start-segment' // 03
  | 'ext-linear' // 04
  | 'start-linear'; // 05

export interface IHexRecord {
  /** Full resolved address (after applying ext-segment/ext-linear base). */
  address: number;
  type: IHexRecordType;
  data: Uint8Array;
  /** 32-bit per-page crypto tag when present (crypto containers only). */
  tag?: number;
  checksumOk: boolean;
  crypto: boolean;
  lineNo: number;
}

const REC_TYPE: Record<number, IHexRecordType> = {
  0: 'data',
  1: 'eof',
  2: 'ext-segment',
  3: 'start-segment',
  4: 'ext-linear',
  5: 'start-linear',
};

function hexToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

export interface ParsedIHex {
  records: IHexRecord[];
  crypto: boolean;
  /** true if every data record's Intel-HEX checksum byte verified. */
  checksumOk: boolean;
}

export function parseIHex(text: string): ParsedIHex {
  const records: IHexRecord[] = [];
  let base = 0; // upper address bits from type 02/04
  let crypto = false;
  let allOk = true;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!.trim();
    if (!line || line.startsWith('#')) continue;

    let isCrypto = false;
    let tag: number | undefined;
    if (line.startsWith('C:')) {
      isCrypto = true;
      crypto = true;
      const parts = line.slice(2).split(':'); // [record, tag?]
      line = parts[0]!;
      if (parts[1]) tag = parseInt(parts[1], 16) >>> 0;
    } else if (line.startsWith(':')) {
      line = line.slice(1);
    } else {
      continue;
    }
    if (line.length < 10) continue;

    const bytes = hexToBytes(line);
    const len = bytes[0]!;
    const addr16 = (bytes[1]! << 8) | bytes[2]!;
    const type = REC_TYPE[bytes[3]!];
    if (!type) continue;
    const data = bytes.subarray(4, 4 + len);

    const sum = bytes.subarray(0, 4 + len + 1).reduce((a, b) => (a + b) & 0xff, 0);
    const checksumOk = sum === 0;
    if (!checksumOk) allOk = false;

    if (type === 'ext-segment') {
      base = ((data[0]! << 8) | data[1]!) << 4;
    } else if (type === 'ext-linear') {
      base = ((data[0]! << 8) | data[1]!) << 16;
    }

    records.push({
      address: base + addr16,
      type,
      data: data.slice(),
      tag,
      checksumOk,
      crypto: isCrypto,
      lineNo: i + 1,
    });
  }
  return { records, crypto, checksumOk: allOk };
}
