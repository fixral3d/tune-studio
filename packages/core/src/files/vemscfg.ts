/**
 * .vemscfg (FILE-02/03, FILE-FORMATS §2): VemsTune's text dump of the ECU config.
 *
 *   # Key: value              header
 *   name=HH                   firmware global.h field (config_t / config_ext_t / config_shared_t)
 *   name[i]=HH                array element (i decimal)
 *   t[R]=HH HH …              table row of letter table t (R = 0-9, A-Z), MegaTune heritage
 *   t[r]= / t[k]=             table axes  → [SymbolAlias] t_r / t_k
 *   eeprom_area[0]=64 bytes   EEPROM block
 *
 * Names resolve to page bytes through the firmware layout (global.h, raw bytes — names survive
 * firmware re-layouts, which is what makes config migration by name work) and the INI
 * ([SymbolAlias] letters: veTable = j, rpmBinsVE = j_r, rotary_trailing_spark = bC …).
 */
import type { VemsConfig } from '../ini/config.js';
import type { Field } from '../ini/field.js';
import { arrayLength } from '../ini/value.js';
import type { FwLayout } from '../validate/fwlayout.js';
import { structSlices } from '../validate/fwlayout.js';
import type { SiprDescriptor } from '../sipr/descriptor.js';

export interface VemsCfgEntry {
  name: string;
  /** raw index text: "3", "A", "r", "k" (undefined for plain names). */
  idx?: string;
  bytes: number[];
}

export interface VemsCfgFile {
  header: Record<string, string>;
  /** header keys in file order (for faithful rewrite). */
  headerOrder: string[];
  entries: VemsCfgEntry[];
}

export function parseVemsCfg(text: string): VemsCfgFile {
  const header: Record<string, string> = {};
  const headerOrder: string[] = [];
  const entries: VemsCfgEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      // header values keep trailing spaces (VemsTune writes "SerialNumber Raw: … 31 ")
      const m = /^#\s?([^:=]+?)\s*[:=]\s?(.*)$/.exec(raw.trimStart());
      if (m && !(m[1]! in header)) {
        header[m[1]!] = m[2]!;
        headerOrder.push(m[1]!);
      }
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]+)\])?=(.*)$/.exec(line);
    if (!m) continue;
    const bytes = m[3]!.trim().split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16));
    if (bytes.some((b) => Number.isNaN(b))) continue;
    entries.push({ name: m[1]!, idx: m[2], bytes });
  }
  return { header, headerOrder, entries };
}

/** Row index of a table line: 0-9, then A=10 … (base-36 digit). */
export const rowIndex = (idx: string) => parseInt(idx, 36);
export const rowLabel = (n: number) => n.toString(36).toUpperCase();

/** A resolved byte range inside a vt page. */
interface Target {
  page: number;
  offset: number;
  length: number;
}

export interface VemsCfgContext {
  cfg: VemsConfig;
  sipr: SiprDescriptor;
  layout?: FwLayout;
}

const fieldTarget = (f: Field | undefined, row?: number): Target | undefined => {
  if (!f || f.kind === 'computed') return undefined;
  if (f.kind === 'array') {
    const cols = f.shape.dims[0];
    if (row === undefined) return { page: f.page, offset: f.offset, length: arrayLength(f) * f.type.size };
    if (f.shape.dims.length < 2 || row >= f.shape.dims[1]!) return undefined;
    return { page: f.page, offset: f.offset + row * cols * f.type.size, length: cols * f.type.size };
  }
  if (row !== undefined) return undefined;
  return { page: f.page, offset: f.offset, length: f.type.size };
};

/** Where `name[idx]` lives in the page buffers (firmware struct first, then INI / aliases). */
export function resolveEntry(ctx: VemsCfgContext, name: string, idx?: string, expectLen?: number): Target | undefined {
  const { cfg, layout, sipr } = ctx;
  const ini = (n: string) => cfg.byName.get(n) ?? cfg.byName.get(cfg.aliases.get(n) ?? '');
  // firmware struct field
  if (layout) {
    const slices = structSlices(sipr);
    for (const [struct, s] of Object.entries(layout.structs)) {
      const f = s.fields[name];
      if (!f) continue;
      const [off, size, elem, count] = f;
      let at = off;
      let len = size;
      if (idx !== undefined) {
        const i = elemIndex(idx);
        if (i === undefined || i >= count) break;
        at = off + i * elem;
        len = elem;
      }
      for (const sl of slices.get(struct) ?? [])
        if (at >= sl.structOffset && at + len <= sl.structOffset + sl.size) return { page: sl.page, offset: at - sl.structOffset, length: len };
      break;
    }
  }
  if (idx === undefined) return fieldTarget(ini(name));
  // table axes and extra rows: t_r / t_k / tC …, hwmap rows h0..h5
  if (idx === 'r' || idx === 'k') return fieldTarget(ini(`${name}_${idx}`));
  const whole = ini(`${name}${idx}`);
  if (whole) return fieldTarget(whole);
  const t = ini(name);
  if (t?.kind === 'array' && t.shape.dims.length === 2) return fieldTarget(t, rowIndex(idx));
  if (t?.kind === 'array') {
    // one-row letter table (t[0] = whole boosttpsTable) or a plain array element (clt_curve[A])
    if (idx === '0' && expectLen === arrayLength(t) * t.type.size) return fieldTarget(t);
    const i = elemIndex(idx);
    return i !== undefined && i < arrayLength(t) ? { page: t.page, offset: t.offset + i * t.type.size, length: t.type.size } : undefined;
  }
  return undefined;
}

/** Array element index: decimal, or one base-36 digit (clt_curve[A] = 10 … [G] = 16). */
function elemIndex(idx: string): number | undefined {
  if (/^\d+$/.test(idx)) return Number(idx);
  if (/^[A-Z]$/.test(idx)) return rowIndex(idx);
  return undefined;
}

/** Letter tables in the order VemsTune writes them (STDataIOVemsCfg::saveArraysTo; observed). */
export const VEMSCFG_TABLES = ['h', 'j', 'l', 'z', 'n', 't', 'b', 'p', 'e', 'y', 'i', 'w', 's', 'f'];
const STRUCT_ORDER = ['config_t', 'config_ext_t', 'config_shared_t'];

/** Canonical entry keys (name, idx) for the loaded INI/firmware: struct fields, then letter tables. */
export function canonicalKeys(ctx: VemsCfgContext): { name: string; idx?: string; len?: number }[] {
  const { cfg, layout } = ctx;
  const keys: { name: string; idx?: string; len?: number }[] = [];
  const ini = (n: string) => cfg.byName.get(n) ?? cfg.byName.get(cfg.aliases.get(n) ?? '');
  for (const s of STRUCT_ORDER) {
    const fields = layout?.structs[s]?.fields ?? {};
    for (const [name, [off, size, elem, count]] of Object.entries(fields).sort((a, b) => a[1][0] - b[1][0])) {
      void off;
      void size;
      void elem;
      if (count > 1) for (let i = 0; i < count; i++) keys.push({ name, idx: count > 10 ? rowLabel(i) : String(i) });
      else keys.push({ name });
    }
  }
  for (const t of VEMSCFG_TABLES) {
    const main = ini(t);
    let rows = 0;
    if (main?.kind === 'array') rows = main.shape.dims.length === 2 ? main.shape.dims[1]! : 1;
    else while (ini(`${t}${rows}`)) rows++; // hwmap rows h0..h5
    const oneRow = main?.kind === 'array' && main.shape.dims.length === 1 ? arrayLength(main) * main.type.size : undefined;
    for (let r = 0; r < rows; r++) keys.push({ name: t, idx: rowLabel(r), len: oneRow });
    if (ini(`${t}_r`)) keys.push({ name: t, idx: 'r' });
    if (ini(`${t}_k`)) keys.push({ name: t, idx: 'k' });
    for (let r = rows; r < 36; r++) if (cfg.aliases.has(`${t}${rowLabel(r)}`)) keys.push({ name: t, idx: rowLabel(r) });
  }
  return keys;
}

const hex = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');
const keyOf = (e: { name: string; idx?: string }) => (e.idx === undefined ? e.name : `${e.name}[${e.idx}]`);

export interface WriteOptions {
  /** header lines (written in this order). */
  header: { key: string; value: string }[];
  /** a loaded file: its line order is kept and unresolvable lines are written back verbatim. */
  template?: VemsCfgFile;
  /** EEPROM block (`eeprom_area[0]`), written last when present. */
  eeprom?: number[];
}

/** Serialize page buffers as .vemscfg text (LF line ends, upper-case hex, like VemsTune). */
export function writeVemsCfg(ctx: VemsCfgContext, pages: Map<number, Uint8Array>, opts: WriteOptions): string {
  const lines = opts.header.map((h) => `# ${h.key}: ${h.value}`);
  lines.push('');
  const value = (name: string, idx: string | undefined, len?: number) => {
    const t = resolveEntry(ctx, name, idx, len);
    const buf = t && pages.get(t.page);
    return t && buf ? { t, bytes: Array.from(buf.subarray(t.offset, t.offset + t.length)) } : undefined;
  };
  const seen = new Set<string>();
  // page bytes already written under some name (old/new firmware names, aliases): never twice
  const covered = new Set<string>();
  const cover = (t: Target) => {
    for (let i = 0; i < t.length; i++) covered.add(`${t.page}:${t.offset + i}`);
  };
  const isCovered = (t: Target) => Array.from({ length: t.length }, (_, i) => `${t.page}:${t.offset + i}`).some((k) => covered.has(k));
  const emit = (name: string, idx: string | undefined, bytes: number[]) => {
    seen.add(keyOf({ name, idx }));
    lines.push(`${keyOf({ name, idx })}=${bytes.map(hex).join(' ')}`);
  };
  let eeprom = opts.eeprom;
  if (opts.template) {
    for (const e of opts.template.entries) {
      if (e.name === 'eeprom_area') {
        eeprom ??= e.bytes;
        continue;
      }
      const v = value(e.name, e.idx, e.bytes.length);
      if (v && v.bytes.length === e.bytes.length) cover(v.t);
      emit(e.name, e.idx, v && v.bytes.length === e.bytes.length ? v.bytes : e.bytes);
    }
  }
  for (const k of canonicalKeys(ctx)) {
    if (seen.has(keyOf(k))) continue;
    const v = value(k.name, k.idx, k.len);
    if (!v || isCovered(v.t)) continue;
    cover(v.t);
    emit(k.name, k.idx, v.bytes);
  }
  // writeEppromAreToFile emits "%02X " per byte → the line ends with a space
  if (eeprom) lines.push(`eeprom_area[0]=${eeprom.map((b) => `${hex(b)} `).join('')}`);
  return lines.join('\n') + '\n';
}

export interface ApplyResult {
  applied: number;
  /** entries that could not be placed (unknown name, size mismatch, missing page). */
  unknown: VemsCfgEntry[];
  /** EEPROM block (`eeprom_area`), kept verbatim. */
  eeprom?: number[];
}

/** Write a parsed .vemscfg into page buffers (missing pages are created zero-filled). */
export function applyVemsCfg(file: VemsCfgFile, ctx: VemsCfgContext, pages: Map<number, Uint8Array>): ApplyResult {
  const res: ApplyResult = { applied: 0, unknown: [] };
  for (const e of file.entries) {
    if (e.name === 'eeprom_area') {
      res.eeprom = e.bytes;
      continue;
    }
    const t = resolveEntry(ctx, e.name, e.idx, e.bytes.length);
    if (!t || t.length !== e.bytes.length) {
      res.unknown.push(e);
      continue;
    }
    const buf = pages.get(t.page) ?? pages.set(t.page, new Uint8Array(256)).get(t.page)!;
    buf.set(e.bytes, t.offset);
    res.applied++;
  }
  return res;
}
