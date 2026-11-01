/**
 * `.triggerlog` (TRIG-01): 512-byte "# Vems Trigger Log Header" + the raw escaped TF stream the ECU sends
 * after `40 03 F7`. Decoding follows TriggerLog::fillTRDataArray → TriggerFrame::addFrame / convertFrame2Time,
 * the result table TriggerLogResults::buildGUI, the CSV TriggerLogResults::OnSaveCSV (FILE-FORMATS §10, PROTOCOL §7.4).
 */
import { encodeTfBody, TfParser } from '../tf/frame.js';

const HEADER_MAGIC = '# Vems Trigger Log Header';
const HEADER_SIZE = 512;
/** timestamp unit: 4 µs ticks → ms */
const TICK_MS = 4 / 1000;

export interface TriggerLogInfo {
  version?: string;
  serialNumber?: string;
  currentTime?: string;
}

/** Event id = frame type (graphcolors.xml: 1 primary, 2 secondary, 8 spark, 9 TOOTH CNT = 0, 17.. errors, 64.. data). */
export interface TriggerTimeline {
  /** event times in ms */
  t: number[];
  /** 0x40–0x4E frames carry one data byte per event */
  data?: number[];
}

export interface TriggerLog {
  info: TriggerLogInfo;
  hasHeader: boolean;
  /** stream bytes after the header */
  stream: Uint8Array;
  timelines: Map<number, TriggerTimeline>;
  stats: {
    bytes: number;
    frames: number;
    crcErrors: number;
    /** addFrame result per frame type (0x101 unknown, 0x102 too short, 0x103 CRC) */
    byResult: Map<number, number>;
  };
}

interface DecodedFrame {
  type: number;
  primaries: number[];
  event?: number;
  data?: number;
}

/** TriggerFrame::addFrame on a de-stuffed body (CRC already removed); returns a code ≥ 0x100 on failure. */
export function decodeTriggerFrame(body: Uint8Array): DecodedFrame | number {
  const n = body.length + 2; // addFrame counts the two CRC bytes
  if (n === 2) return 0x104;
  if (n <= 4) return 0x102;
  const type = body[body.length - 1]!;
  let k: number; // bytes of primary timestamps
  let event: number | undefined;
  let data: number | undefined;
  if (type === 0x01) k = n - 3;
  else if ((type >= 0x02 && type <= 0x1f) || (type >= 0x50 && type <= 0x57) || (type >= 0x5a && type <= 0x61)) {
    k = n - 5;
    event = (body[n - 5]! << 8) | body[n - 4]!;
  } else if (type >= 0x40 && type <= 0x4e) {
    if (n < 6) return 0x102;
    k = n - 6;
    event = (body[n - 5]! << 8) | body[n - 4]!;
    data = body[n - 6]!;
  } else if (type === 0x20) return { type, primaries: [] };
  else return 0x101;
  const primaries: number[] = [];
  for (let i = 0; i < (k & ~1); i += 2) primaries.push((body[i]! << 8) | body[i + 1]!);
  return { type, primaries, event, data };
}

function parseHeader(text: string): TriggerLogInfo {
  const info: TriggerLogInfo = {};
  for (const line of text.split('\n')) {
    const m = /^(\w+)\s*[=:]\s?(.*)$/.exec(line.replace(/\0/g, '').trimEnd());
    if (!m) continue;
    if (m[1] === 'Version') info.version = m[2];
    else if (m[1] === 'SerialNumber') info.serialNumber = m[2];
    else if (m[1] === 'CurrentTime') info.currentTime = m[2];
  }
  return info;
}

/** Parse a .triggerlog file (or a header-less raw stream, "use log as raw byte stream"). */
export function parseTriggerLog(bytes: Uint8Array): TriggerLog {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(HEADER_SIZE, bytes.length)));
  const hasHeader = head.startsWith(HEADER_MAGIC) && bytes.length >= HEADER_SIZE;
  const stream = hasHeader ? bytes.subarray(HEADER_SIZE) : bytes;
  const log: TriggerLog = {
    info: hasHeader ? parseHeader(head) : {},
    hasHeader,
    stream,
    timelines: new Map(),
    stats: { bytes: stream.length, frames: 0, crcErrors: 0, byResult: new Map() },
  };
  appendTriggerStream(log, stream, new TriggerTimeBase());
  return log;
}

/** Running 16-bit unwrap state of convertFrame2Time (base adds 0x10000 on wrap, `last` = latest tick). */
export class TriggerTimeBase {
  base = 0;
  last = 0;
  parser = new TfParser();
}

const timeline = (log: TriggerLog, id: number) => {
  let t = log.timelines.get(id);
  if (!t) log.timelines.set(id, (t = { t: [] }));
  return t;
};

/** Decode more stream bytes into `log` (used for files and for live recording). */
export function appendTriggerStream(log: TriggerLog, bytes: Uint8Array, tb: TriggerTimeBase): void {
  for (const f of tb.parser.feedAll(bytes)) {
    log.stats.frames++;
    const d = f.crcOk ? decodeTriggerFrame(f.body) : 0x103;
    const code = typeof d === 'number' ? d : d.type;
    log.stats.byResult.set(code, (log.stats.byResult.get(code) ?? 0) + 1);
    if (code === 0x103) log.stats.crcErrors++;
    // 0x20 (a realtime answer in the stream) carries no trigger timing; skipped
    if (typeof d === 'number' || d.type === 0x20) continue;
    for (const p of d.primaries) {
      let t = tb.base + p;
      if (t < tb.last) {
        tb.base += 0x10000;
        t = tb.base + p;
      }
      timeline(log, 1).t.push(t * TICK_MS);
      if (t > tb.last) tb.last = t;
    }
    if (d.type !== 0x01 && d.event !== undefined) {
      let t = tb.base + d.event;
      // an event may lag the last primary a little; only a big step back is a wrap
      if (t < tb.last - 0xfa) {
        tb.base += 0x10000;
        t = tb.base + d.event;
      }
      const tl = timeline(log, d.type);
      tl.t.push(t * TICK_MS);
      if (d.data !== undefined) (tl.data ??= []).push(d.data);
      if (t > tb.last) tb.last = t;
    }
  }
}

export function emptyTriggerLog(info: TriggerLogInfo = {}): TriggerLog {
  return { info, hasHeader: true, stream: new Uint8Array(0), timelines: new Map(), stats: { bytes: 0, frames: 0, crcErrors: 0, byResult: new Map() } };
}

/** Header (vemslogHeader with trigger: true) padded with NULs to 512 bytes, followed by the raw stream. */
export function writeTriggerLog(header: string, stream: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER_SIZE + stream.length);
  const h = new TextEncoder().encode(header);
  out.set(h.subarray(0, HEADER_SIZE));
  out.set(stream, HEADER_SIZE);
  return out;
}

/** `<serial>-YYYY.MM.DD-HH.MM.SS.triggerlog`, same pattern as .vemslog names. */
export function triggerLogFileName(serial: string, d = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${serial}-${d.getFullYear()}.${two(d.getMonth() + 1)}.${two(d.getDate())}-${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}.triggerlog`;
}

export interface TriggerResultRow {
  primary?: { t: number; idx: number; diff: number; ratio: number };
  secondary?: { t: number; idx: number; diff: number };
  comment?: string;
}

/**
 * TriggerLogResults::buildGUI: primary and secondary times merged in time order. A primary diff ratio
 * (diff / previous diff, 1.0 when there is none) above 1.5 marks "MISSING TOOTH: round(ratio)−1, cycle=<teeth since last gap>".
 * (VemsTune leaves rows empty for primaries after the last secondary; we keep them.)
 */
export function triggerLogResults(log: TriggerLog): TriggerResultRow[] {
  const pr = log.timelines.get(1)?.t ?? [];
  const sec = log.timelines.get(2)?.t ?? [];
  const rows: TriggerResultRow[] = [];
  let i = 0;
  let j = 0;
  let prevP = 0;
  let prevDiff = 0;
  let prevS = 0;
  let cycle = 0;
  while (i < pr.length || j < sec.length) {
    if (i < pr.length && (j >= sec.length || pr[i]! < sec[j]!)) {
      const t = pr[i]!;
      const diff = t - prevP;
      const ratio = prevDiff > 0 ? diff / prevDiff : 1;
      const row: TriggerResultRow = { primary: { t, idx: i, diff, ratio } };
      if (ratio > 1.5) {
        row.comment = `MISSING TOOTH: ${Math.floor(0.5 + ratio) - 1}, cycle=${cycle}`;
        cycle = 0;
      }
      rows.push(row);
      prevP = t;
      prevDiff = diff;
      cycle++;
      i++;
    } else {
      const t = sec[j]!;
      rows.push({ secondary: { t, idx: j, diff: t - prevS } });
      prevS = t;
      j++;
    }
  }
  return rows;
}

const csvCell = (s: string) => (s.includes(',') ? `"${s}"` : s);

/** TriggerLogResults::OnSaveCSV text (cells as the grid shows them). */
export function triggerLogCsv(rows: TriggerResultRow[], info: TriggerLogInfo): string {
  const lines = [
    '; This is a csv-formatted version of a vems trigger log file',
    `; Created on: ${info.currentTime || '(unknown)'} - Serial number: ${info.serialNumber || '(unknown)'} - Firmware version: ${info.version || '(unknown)'}`,
    'id,Primary Time (ms),Primary Diff (ms),Primary Diff Ratio,Secondary Time (ms),Secondary Diff (ms),Comment',
  ];
  rows.forEach((r, id) => {
    const p = r.primary;
    const s = r.secondary;
    const cells = [
      p ? `${p.t.toFixed(3)}, (${p.idx})` : '',
      p ? p.diff.toFixed(3) : '',
      p ? p.ratio.toFixed(2) : '',
      s ? `${s.t.toFixed(3)}, (${s.idx})` : '',
      s ? s.diff.toFixed(3) : '',
      r.comment ?? '',
    ];
    lines.push(`${id},${cells.map(csvCell).join(',')}`);
  });
  return lines.join('\n') + '\n';
}

/** Event names/colours/offsets from graphcolors.xml (`<event id name voffset>#rrggbb</event>`). */
export interface TriggerEventStyle {
  id: number;
  name: string;
  voffset: number;
  color: string;
}

export function parseGraphColors(xml: string): { background?: string; scope?: string; text?: string; events: Map<number, TriggerEventStyle> } {
  const tag = (n: string) => new RegExp(`<${n}>\\s*([^<]+?)\\s*</${n}>`).exec(xml)?.[1];
  const events = new Map<number, TriggerEventStyle>();
  for (const m of xml.matchAll(/<event\s+id="(\d+)"\s+name="([^"]*)"\s+voffset="(-?\d+)"\s*>\s*([^<]+?)\s*<\/event>/g))
    events.set(Number(m[1]), { id: Number(m[1]), name: m[2]!, voffset: Number(m[3]), color: m[4]! });
  return { background: tag('background'), scope: tag('scope'), text: tag('textcolor'), events };
}

/** One escaped TF frame of trigger events (emulator / tests): primaries (ticks) + optional event of `type`. */
export function encodeTriggerFrame(type: number, primaries: number[], event?: number, data?: number): Uint8Array {
  const b: number[] = [];
  for (const p of primaries) b.push((p >> 8) & 0xff, p & 0xff);
  if (type >= 0x40 && type <= 0x4e) b.push((data ?? 0) & 0xff);
  if (type !== 0x01) b.push(((event ?? 0) >> 8) & 0xff, (event ?? 0) & 0xff);
  b.push(type);
  return encodeTfBody(Uint8Array.from(b));
}
