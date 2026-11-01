import { parseIHex } from './ihex.js';

/**
 * Firmware image model mirroring FirmwareData (@0x00a094f4).
 * Data records are grouped into fixed-size flash pages keyed by page index
 * (address / pageSize), as in IHexParser::fillFirmwareData → setPageData.
 *
 * VemsTune page sizes (FirmwareData, hwdef): V3 = 256 bytes, Round = 128 bytes.
 * For a crypto container the page bytes are ciphertext and `tag` holds the
 * per-page 32-bit authentication tag; opening the file never decrypts it
 * (FirmwareData::crypto is only used by the session/upload flow, not on load).
 */
export type FirmwareKind = 'intel-hex' | 'crypto-chex';

export interface FirmwarePage {
  index: number;
  address: number;
  data: Uint8Array;
  tag?: number;
  /** byte count actually written (rest is 0xFF filler). */
  filledBytes: number;
}

export interface FirmwareImage {
  kind: FirmwareKind;
  pageSize: number;
  pages: FirmwarePage[];
  /** V3 marker word 0x5A 0xA5 found at page 0x1F7 offset 0xFE (setV3MarkerWord). */
  hasV3Marker: boolean;
  checksumOk: boolean;
  totalBytes: number;
}

export interface LoadFirmwareOptions {
  /** Flash page size. Default 256 (V3). Use 128 for Round. */
  pageSize?: number;
}

export function loadFirmware(text: string, opts: LoadFirmwareOptions = {}): FirmwareImage {
  const pageSize = opts.pageSize ?? 256;
  const parsed = parseIHex(text);
  const kind: FirmwareKind = parsed.crypto ? 'crypto-chex' : 'intel-hex';

  const pageMap = new Map<number, FirmwarePage>();
  let totalBytes = 0;

  for (const rec of parsed.records) {
    if (rec.type !== 'data') continue;
    let addr = rec.address;
    let data = rec.data;
    let tag = rec.tag;
    // a record can straddle a page boundary; split it the way setPageData does.
    while (data.length > 0) {
      const index = Math.floor(addr / pageSize);
      const offset = addr - index * pageSize;
      const take = Math.min(data.length, pageSize - offset);
      let page = pageMap.get(index);
      if (!page) {
        page = {
          index,
          address: index * pageSize,
          data: new Uint8Array(pageSize).fill(0xff),
          filledBytes: 0,
        };
        pageMap.set(index, page);
      }
      page.data.set(data.subarray(0, take), offset);
      page.filledBytes += take;
      totalBytes += take;
      if (tag !== undefined) {
        page.tag = tag;
        tag = undefined;
      }
      addr += take;
      data = data.subarray(take);
    }
  }

  const pages = [...pageMap.values()].sort((a, b) => a.index - b.index);

  const markerPage = pageMap.get(Math.floor(0x1f700 / pageSize));
  const markerOff = 0x1f700 % pageSize;
  const hasV3Marker =
    pageSize === 256 &&
    !!markerPage &&
    markerPage.data[markerOff + 0xfe] === 0x5a &&
    markerPage.data[markerOff + 0xff] === 0xa5;

  return { kind, pageSize, pages, hasV3Marker, checksumOk: parsed.checksumOk, totalBytes };
}
