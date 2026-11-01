/**
 * Firmware global.h layouts (v3) → raw bytes in VemsTune page buffers.
 *
 * VemsTune parses fw_desc/firmware_<ver>/global.h (HeaderParser) so validator rules can
 * address firmware struct fields by name (`strig_validation`, `clt_range[3]`), independent
 * of how the INI names them. Layouts come from re/tools/fwstruct/export_layout.py.
 * Struct → page slices follow FIRMWARE-MEMORY-MODEL §4.1 and are derived from the [SIPR]
 * table sizes, so they track per-version table sizes.
 */
import type { SiprDescriptor } from '../sipr/descriptor.js';
import { readRawInt } from '../ini/value.js';

/** [offset, size, elemSize, count, bitOffset, bitWidth, signed] */
export type FwField = [number, number, number, number, number | null, number | null, number];

export interface FwLayout {
  version: string;
  structs: Record<string, { size: number; fields: Record<string, FwField> }>;
}

/** Pick the layout VemsTune would use: the newest fw_desc version not newer than `fw`. */
export function pickLayoutVersion(available: string[], fw: string): string | undefined {
  const n = (v: string) => v.split('.').reduce((a, p) => a * 1000 + (parseInt(p, 10) || 0), 0);
  return available.filter((v) => n(v) <= n(fw)).sort((a, b) => n(b) - n(a))[0];
}

interface Slice {
  page: number;
  structOffset: number;
  size: number;
}

/** Struct → [vt page, struct offset, size] slices, from the [SIPR] page/table list. */
export function structSlices(desc: SiprDescriptor): Map<string, Slice[]> {
  const pageOf = (table: string) => desc.pages.find((p) => p.tableIds.includes(table))?.pageNo;
  const size = (table: string) => desc.tables.get(table)?.size ?? 0;
  const seq = (struct: string, tables: string[], out: Map<string, Slice[]>) => {
    let off = 0;
    const slices: Slice[] = [];
    for (const t of tables) {
      const page = pageOf(t);
      if (page !== undefined && size(t)) slices.push({ page, structOffset: off, size: size(t) });
      off += size(t);
    }
    out.set(struct, slices);
  };
  const out = new Map<string, Slice[]>();
  const cfg1 = desc.pages.find((p) => p.configType === 'SIPR_GET_CONFIG_1');
  const cfg2 = desc.pages.find((p) => p.configType === 'SIPR_GET_CONFIG_2');
  if (cfg1) out.set('config_t', [{ page: cfg1.pageNo, structOffset: 0, size: desc.configs.get('SIPR_GET_CONFIG_1')?.size ?? 255 }]);
  if (cfg2) out.set('config_ext_t', [{ page: cfg2.pageNo, structOffset: 0, size: desc.configs.get('SIPR_GET_CONFIG_2')?.size ?? 0 }]);
  seq('config_shared_t', ['SIPR_TABLE_CONFIG_SHARED'], out);
  seq('hwmap_t', ['SIPR_TABLE_H'], out);
  seq('ign_t', ['SIPR_TABLE_IGN'], out);
  seq('knock_noise_t', ['SIPR_TABLE_ALT_KNOCK'], out);
  seq('boost_t', ['SIPR_TABLE_BOOST_TPS', 'SIPR_TABLE_BOOST_DC'], out);
  const lambda = desc.tables.has('SIPR_TABLE_LAMBDA') ? 'SIPR_TABLE_LAMBDA' : 'SIPR_TABLE_EGOC';
  seq('ve_t', ['SIPR_TABLE_VE', lambda, 'SIPR_TABLE_MAT_TPS_RETARD', 'SIPR_TABLE_MAPCORR', 'SIPR_TABLE_TEMPERATURE', 'SIPR_TABLE_LAUNCH_RPM'], out);
  return out;
}

/** Name → raw value resolver over page buffers using a firmware layout. */
export class FwSymbols {
  private index = new Map<string, { struct: string; f: FwField }>();
  private slices: Map<string, Slice[]>;

  constructor(
    layout: FwLayout,
    desc: SiprDescriptor,
    private pages: Map<number, Uint8Array>,
  ) {
    this.slices = structSlices(desc);
    for (const [struct, s] of Object.entries(layout.structs))
      for (const [name, f] of Object.entries(s.fields)) if (!this.index.has(name)) this.index.set(name, { struct, f });
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  private byte(struct: string, off: number): [Uint8Array, number] | undefined {
    for (const s of this.slices.get(struct) ?? [])
      if (off >= s.structOffset && off < s.structOffset + s.size) {
        const buf = this.pages.get(s.page);
        return buf ? [buf, off - s.structOffset] : undefined;
      }
    return undefined;
  }

  /** Raw value of `name` (scalar/bitfield) or `name[i]` (array element); undefined if unknown/out of range. */
  value(name: string, index?: number): number | undefined {
    const e = this.index.get(name);
    if (!e) return undefined;
    const [off, size, elem, count, bitOff, bitW, signed] = e.f;
    if (index !== undefined && (index < 0 || index >= count)) return undefined;
    if (index === undefined && count > 1) return undefined;
    const at = off + (index ?? 0) * elem;
    const width = (index !== undefined ? elem : size) as 1 | 2 | 3 | 4;
    const loc = this.byte(e.struct, at);
    if (!loc) return undefined;
    let v = readRawInt(loc[0], loc[1], { signed: !!signed && bitW === null, size: width, float: false });
    if (bitW !== null && bitOff !== null) v = (v >> bitOff) & ((1 << bitW) - 1);
    return v;
  }
}
