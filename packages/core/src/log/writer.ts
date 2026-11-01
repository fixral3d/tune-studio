/**
 * .vemslog LogVersion 2 writer (SIPRFileLogger @0xbb8e28 + RawLogHelper::getVemslogHeader @0x70a87c).
 *
 *  - header: text padded to one block; block byte[blockSize-1] = 0x0A (fillBuffer @0xbb9198)
 *  - packets are appended to the current block while `cur + size <= blockSize`,
 *    otherwise the block is flushed first (Flush @0xbb90d8) — packets never straddle blocks
 *  - page packets (types 5/13/14) are written right after the header (logPages order)
 *
 * Online realtime (RealtimeHandler::onReceiveTriggerFrame @0x81227a) emits, per TF
 * realtime frame, an RT_TIME packet then a READ_SENSORS packet.
 */
import { crc16Sipr } from '../sipr/crc.js';
import { encodeSipr } from '../sipr/packet.js';
import { SiprType } from '../sipr/types.js';
import type { SiprDescriptor } from '../sipr/descriptor.js';

/** SIPRDescriptor::getTableType @0xbb7c8e — SIPR_TABLE_* name → table id (GET_TABLEDATA payload[0]). */
export const SIPR_TABLE_IDS: Record<string, number> = {
  SIPR_TABLE_RPM: 1,
  SIPR_TABLE_KPA: 2,
  SIPR_TABLE_IGN: 3,
  SIPR_TABLE_EGOC: 4,
  SIPR_TABLE_VE: 5,
  SIPR_TABLE_LAMBDA: 6,
  SIPR_TABLE_CONFIG1: 7,
  SIPR_TABLE_CONFIG2: 8,
  SIPR_TABLE_H: 10,
  SIPR_TABLE_BOOST_DC: 0x0b,
  SIPR_TABLE_BOOST_TPS: 0x0c,
  SIPR_TABLE_TEMPERATURE: 0x0d,
  SIPR_TABLE_MAPCORR: 0x0e,
  SIPR_TABLE_ALT_KNOCK: 0x0f,
  SIPR_TABLE_A340E: 0x10,
  SIPR_TABLE_VVTI: 0x11,
  SIPR_TABLE_MAT_TPS_RETARD: 0x12,
  SIPR_TABLE_CONFIG1_EXT: 0x13,
  SIPR_TABLE_LAUNCH_RPM: 0x14,
  SIPR_TABLE_CONFIG_SHARED: 0x15,
  SIPR_TABLE_CONFIG_EEPROM: 0x1e,
};

/** SIPRDescriptor::getConfigType @0xbb7fec. */
const CONFIG_TYPES: Record<string, number> = { SIPR_GET_CONFIG_1: 0x0d, SIPR_GET_CONFIG_2: 0x0e };

export interface LogHeaderInfo {
  version?: string;
  serialNumber?: string;
  compilationTime?: string;
  signature?: string;
  compileOptions?: string;
  creator?: string;
  time?: Date;
  /** "# Vems Trigger Log Header" variant. */
  trigger?: boolean;
}

const two = (n: number) => String(n).padStart(2, '0');
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;

/** Header text exactly as getVemslogHeader builds it (CompileOptions only when non-empty). */
export function vemslogHeader(h: LogHeaderInfo): string {
  let s = h.trigger ? '# Vems Trigger Log Header, 512 byte\n' : '# Vems Log Header, 512 byte\n';
  s += 'BlockSize=512\n';
  s += 'LogVersion=2\n';
  s += `CurrentTime: ${isoLocal(h.time ?? new Date())}\n`;
  s += `Creator=${h.creator ?? 'VEMS Tuner 0.1'}\n`;
  s += `Version=${h.version ?? ''}\n`;
  s += `SerialNumber=${h.serialNumber ?? ''}\n`;
  s += `CompilationTime=${h.compilationTime ?? ''}\n`;
  s += `Signature=${h.signature ?? ''}\n`;
  if (h.compileOptions) s += `CompileOptions=${h.compileOptions}\n`;
  return s;
}

/** `<SerialNumber>-YYYY.MM.DD-HH.MM.SS.vemslog` (FILE-FORMATS §1). */
export function vemslogFileName(serial: string, d = new Date()): string {
  return `${serial}-${d.getFullYear()}.${two(d.getMonth() + 1)}.${two(d.getDate())}-${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}.vemslog`;
}

/**
 * READ_SENSORS frame from a realtime block (TF body without its type byte).
 * SIPRPacket(seq, type, p4, len, IntArray) @0xbb9680 lays the payload out as
 * `00 00 p4 data[len]` with header len = len+3; RealtimeHandler passes p4 = 1.
 */
export function encodeRealtimePacket(rt: Uint8Array): Uint8Array {
  const n = rt.length & 0xff;
  const out = new Uint8Array(n + 9);
  out[0] = 0x0a;
  out[1] = 0;
  out[2] = SiprType.READ_SENSORS;
  out[3] = (n + 3) & 0xff;
  out[6] = 1;
  out.set(rt.subarray(0, n), 7);
  const crc = crc16Sipr(out.subarray(1, n + 7));
  out[n + 7] = crc & 0xff;
  out[n + 8] = crc >>> 8;
  return out;
}

/** Realtime block back out of a READ_SENSORS payload (inverse of encodeRealtimePacket). */
export function realtimeFromPayload(payload: Uint8Array): Uint8Array {
  return payload.subarray(3);
}

/** RT_TIME: ms since the realtime handler started, 4 bytes big-endian (Math::getBytes @0xbf9346). */
export function encodeRtTimePacket(ms: number): Uint8Array {
  const v = ms >>> 0;
  return encodeSipr({ sequence: 0, type: SiprType.RT_TIME, payload: Uint8Array.of(v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff) });
}

/** User marker (MainFrame::OnVemsLogAddMarker @0x6ab0c4): LOG_MARKER, empty payload. */
export function encodeMarkerPacket(): Uint8Array {
  return encodeSipr({ sequence: 0, type: SiprType.LOG_MARKER, payload: new Uint8Array(0) });
}

/**
 * SIPRPacketFactory::create @0xbb9e70 for one vt page:
 *  - SIPR_GET_TABLEDATA: one GET_TABLEDATA per table, payload = [tableId, data[offset..+size]]
 *  - SIPR_GET_CONFIG_1/2: one packet of that type, payload = data[0..sipr_config size]
 */
export function pagePackets(desc: SiprDescriptor, vtPage: number, data: Uint8Array): Uint8Array[] {
  const page = desc.pages.find((p) => p.pageNo === vtPage);
  if (!page) return [];
  const cfgType = CONFIG_TYPES[page.configType];
  if (cfgType !== undefined) {
    const size = desc.configs.get(page.configType)?.size;
    if (size === undefined) return [];
    return [encodeSipr({ sequence: 0, type: cfgType, payload: data.slice(0, size) })];
  }
  if (page.configType !== 'SIPR_GET_TABLEDATA') return [];
  const out: Uint8Array[] = [];
  for (const name of page.tableIds) {
    const t = desc.tables.get(name);
    const id = SIPR_TABLE_IDS[name];
    if (!t || id === undefined) continue;
    const payload = new Uint8Array(t.size + 1);
    payload[0] = id;
    payload.set(data.subarray(t.offset, t.offset + t.size), 1);
    out.push(encodeSipr({ sequence: 0, type: SiprType.GET_TABLEDATA, payload }));
  }
  return out;
}

/** Inverse of pagePackets: rebuild vt page buffers from a log's page snapshot packets. */
export function pagesFromPackets(desc: SiprDescriptor, packets: { type: number; payload: Uint8Array }[]): Map<number, Uint8Array> {
  const idToName = new Map(Object.entries(SIPR_TABLE_IDS).map(([k, v]) => [v, k]));
  const store = new Map<number, Uint8Array>();
  const buf = (vt: number) => store.get(vt) ?? store.set(vt, new Uint8Array(256)).get(vt)!;
  for (const p of packets) {
    if (p.type === SiprType.GET_TABLEDATA) {
      const name = idToName.get(p.payload[0]!);
      const page = name && desc.pages.find((pg) => pg.tableIds.includes(name));
      const t = name && desc.tables.get(name);
      if (page && t) buf(page.pageNo).set(p.payload.subarray(1, 1 + t.size), t.offset);
    } else {
      const ct = Object.keys(CONFIG_TYPES).find((k) => CONFIG_TYPES[k] === p.type);
      const page = ct && desc.pages.find((pg) => pg.configType === ct);
      if (page) buf(page.pageNo).set(p.payload.subarray(0, 256));
    }
  }
  return store;
}

export interface LogSample {
  /** RT_TIME of the sample (ms); falls back to the sample index × 100 when a log has none. */
  ms: number;
  data: Uint8Array;
}

/** Realtime samples (RT_TIME + READ_SENSORS pairs) and marker positions (as sample indices). */
export function logSamples(packets: { type: number; payload: Uint8Array }[]): { samples: LogSample[]; markers: number[] } {
  const samples: LogSample[] = [];
  const markers: number[] = [];
  let ms: number | undefined;
  for (const p of packets) {
    if (p.type === SiprType.RT_TIME && p.payload.length >= 4) {
      ms = ((p.payload[0]! << 24) | (p.payload[1]! << 16) | (p.payload[2]! << 8) | p.payload[3]!) >>> 0;
    } else if (p.type === SiprType.READ_SENSORS) {
      samples.push({ ms: ms ?? samples.length * 100, data: realtimeFromPayload(p.payload) });
    } else if (p.type === SiprType.LOG_MARKER) {
      markers.push(Math.max(0, samples.length - 1));
    }
  }
  return { samples, markers };
}

export class VemsLogWriter {
  private chunks: Uint8Array[] = [];
  private block: Uint8Array;
  private cur = 0;

  constructor(
    header: string,
    private blockSize = 512,
  ) {
    this.block = this.empty();
    const h = new TextEncoder().encode(header).subarray(0, blockSize - 1);
    this.block.set(h);
    this.flush();
  }

  private empty(): Uint8Array {
    const b = new Uint8Array(this.blockSize);
    b[this.blockSize - 1] = 0x0a;
    return b;
  }

  private flush(): void {
    this.chunks.push(this.block);
    this.block = this.empty();
    this.cur = 0;
  }

  /** Append one encoded SIPR frame. */
  add(frame: Uint8Array): void {
    if (this.cur + frame.length > this.blockSize) this.flush();
    this.block.set(frame, this.cur);
    this.cur += frame.length;
  }

  /** Header + every complete block, plus the current one if it holds data. */
  bytes(): Uint8Array {
    const parts = this.cur > 0 ? [...this.chunks, this.block] : this.chunks;
    const out = new Uint8Array(parts.length * this.blockSize);
    parts.forEach((p, i) => out.set(p, i * this.blockSize));
    return out;
  }
}
