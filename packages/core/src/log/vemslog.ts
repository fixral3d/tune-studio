import { SiprParser, type FeedResult } from '../sipr/packet.js';

export interface VemsLog {
  header: Record<string, string>;
  rawHeader: string;
  blockSize: number;
  results: FeedResult[];
}

/**
 * .vemslog LogVersion 2: 512-byte text header ("# Vems Log Header, 512 byte"),
 * then BlockSize blocks of whole SIPR frames padded with 0x00 (see re/specs/FILE-FORMATS.md).
 */
export function parseVemsLog(buf: Uint8Array): VemsLog {
  const rawHeader = new TextDecoder('latin1').decode(buf.subarray(0, 512)).replace(/\0+/g, '');
  const header: Record<string, string> = {};
  for (const line of rawHeader.split(/\r?\n/)) {
    const m = /^([A-Za-z]+)\s*[=:]\s*(.*)$/.exec(line.trim());
    if (m?.[1] && m[2] !== undefined) header[m[1]] = m[2].trim();
  }
  const blockSize = Number(header.BlockSize ?? 512);
  const results: FeedResult[] = [];
  for (let off = 512; off < buf.length; off += blockSize) {
    const parser = new SiprParser();
    results.push(...parser.feedAll(buf.subarray(off, off + blockSize)));
  }
  return { header, rawHeader, blockSize, results };
}
