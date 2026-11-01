/**
 * Config upload / firmware-upgrade migration (FW-16/17) — FirmwareConfigCreator::createUploadConfig
 * @0x4f8750 → validateV3Config @0x4f8bd8 (see re/specs/FILE-FORMATS §2.5):
 *
 *  1. classify .vemscfg lines (FirmwareConfigParser::parseLine): 1-char base names (and
 *     eeprom_area) are table rows — t[r] → t_r, t[k] → t_k, h[i] → h<i>, b[i>11] → b<I>, else a row
 *     of matrix t; everything else is a scalar keyed by its full text (warmup_clt[0]).
 *  2. missing scalars / tables = ECU symbols absent from the file
 *  3. <ReplaceRules>: a missing NEW symbol computed from OLD names (0..255 only)
 *  4. <FwRules>: bucket V applies iff cfgVersion < V <= ecuVersion; results truncated, < 0 rejected
 *  5. drop v3_configfilter keys
 *  6. full configs (≥ 230 scalar lines): drop calibration keys if the file is from another ECU,
 *     fill missing from the default config, extend `b`, set prohibit_h/l from the ECU version
 */
import { compileExpr, type ExprContext } from '../ini/expr.js';
import type { ConfigCriteria } from '../validate/criteria.js';
import { rowIndex, type VemsCfgEntry, type VemsCfgFile } from './vemscfg.js';

const ver = (v: string) => {
  const p = v.split('.').map((x) => parseInt(x, 10) || 0);
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0] as const;
};
const cmp = (a: string, b: string) => {
  const x = ver(a);
  const y = ver(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** FirmwareInfo::geDefaultConfigFile: exact version, else the greatest older one in the same major.minor. */
export function pickDefaultConfig(available: string[], ecu: string): string | undefined {
  if (available.includes(ecu)) return ecu;
  const [ma, mi] = ver(ecu);
  return available.filter((v) => ver(v)[0] === ma && ver(v)[1] === mi && cmp(v, ecu) < 0).sort(cmp).at(-1);
}

const entryKey = (e: { name: string; idx?: string }) => (e.idx === undefined ? e.name : `${e.name}[${e.idx}]`);

/** Table (or scalar) group a line belongs to, per FirmwareConfigParser::parseTableLine. */
export function groupOf(e: { name: string; idx?: string }): { table: boolean; key: string } {
  if (e.name.length !== 1 && e.name !== 'eeprom_area') return { table: false, key: entryKey(e) };
  if (e.idx === 'r' || e.idx === 'k') return { table: true, key: `${e.name}_${e.idx}` };
  if (e.name === 'h' && e.idx !== undefined) return { table: true, key: `h${e.idx}` };
  if (e.name === 'b' && e.idx !== undefined && rowIndex(e.idx) > 11) return { table: true, key: `b${e.idx}` };
  return { table: true, key: e.name };
}

/** Big-endian value of a scalar line (hex2int over its bytes). */
const scalarValue = (bytes: number[]) => bytes.reduce((a, b) => a * 256 + b, 0);
const toBytes = (v: number, n: number) => Array.from({ length: n }, (_, i) => Math.trunc(v / 256 ** (n - 1 - i)) & 0xff);

export interface MigrationReport {
  cfgVersion: string;
  ecuVersion: string;
  missingScalars: string[];
  missingTables: string[];
  /** ConfigReplacerMgr::show text lines. */
  replace: string[];
  /** ConfigFwRulesMgr::replaceRules lines (deduplicated, like its StringSet). */
  fwRules: string[];
  filtered: string[];
  partial: boolean;
  alien: boolean;
  defaultConfig?: string;
  /** keys filled from the default config */
  fromDefault: string[];
  prohibit?: [number, number];
}

export interface MigrationInput {
  file: VemsCfgFile;
  ecu: { version: string; serialNumber?: string; isPs2?: boolean };
  /** ECU symbol keys in page/offset order (canonicalKeys of the ECU's INI + global.h). */
  ecuKeys: { name: string; idx?: string }[];
  criteria: ConfigCriteria;
  /** v3_configfilter.vemscfg keys */
  filterKeys?: string[];
  /** calibrations.vemscfg keys (dropped from another ECU's config) */
  calibrationKeys?: string[];
  /** default config for the ECU version (pickDefaultConfig) */
  defaults?: { version: string; file: VemsCfgFile };
}

/** Run VemsTune's upload-config pipeline; returns the migrated file (header kept) and the report. */
export function migrateConfig(input: MigrationInput): { file: VemsCfgFile; report: MigrationReport } {
  const { file, ecu, criteria } = input;
  const cfgVersion = file.header.Version || ecu.version;
  // ordered line map; scalar lines count for the "partial config" test
  const lines = new Map<string, VemsCfgEntry>();
  for (const e of file.entries) lines.set(entryKey(e), { ...e, bytes: [...e.bytes] });
  const scalarLines = file.entries.filter((e) => !groupOf(e).table).length;
  const tablesIn = (m: Map<string, VemsCfgEntry>) => new Set([...m.values()].filter((e) => groupOf(e).table).map((e) => groupOf(e).key));
  const scalarOf = (k: string) => {
    const e = lines.get(k);
    return e && !groupOf(e).table ? scalarValue(e.bytes) : undefined;
  };
  const setScalar = (k: string, v: number) => {
    const old = lines.get(k);
    const m = /^(.+?)(?:\[([^\]]+)\])?$/.exec(k)!;
    lines.set(k, { name: m[1]!, idx: m[2], bytes: toBytes(v, old?.bytes.length ?? 1) });
  };

  // 2. missing symbols
  const ecuScalars = input.ecuKeys.filter((k) => !groupOf(k).table).map(entryKey);
  const ecuTables = [...new Set(input.ecuKeys.filter((k) => groupOf(k).table).map((k) => groupOf(k).key))];
  const haveTables = tablesIn(lines);
  const missingScalars = ecuScalars.filter((k) => !lines.has(k));
  const missingTables = ecuTables.filter((t) => !haveTables.has(t));
  const report: MigrationReport = {
    cfgVersion,
    ecuVersion: ecu.version,
    missingScalars: [...missingScalars],
    missingTables,
    replace: [],
    fwRules: [],
    filtered: [],
    partial: scalarLines < 230,
    alien: !!(file.header.SerialNumber && ecu.serialNumber && file.header.SerialNumber.trim() !== ecu.serialNumber.trim()),
    fromDefault: [],
  };

  /** fillVariableData: scalars by full key + every table element t[i] (linear index). */
  const variables = (): Map<string, number> => {
    const vd = new Map<string, number>();
    const rows = new Map<string, number[]>();
    for (const e of lines.values()) {
      const g = groupOf(e);
      if (!g.table) vd.set(entryKey(e), scalarValue(e.bytes));
      else rows.set(g.key, [...(rows.get(g.key) ?? []), ...e.bytes]);
    }
    for (const [t, bytes] of rows) bytes.forEach((b, i) => vd.set(`${t}[${i}]`, b));
    return vd;
  };
  const calc = (expr: string, vd: Map<string, number>): number | undefined => {
    const ctx: ExprContext = { getValue: (n) => vd.get(n) };
    try {
      return compileExpr(expr).evaluate(ctx);
    } catch {
      return undefined;
    }
  };

  // 3. ReplaceRules — new symbols from old names
  if (missingScalars.length) {
    const vd = variables();
    for (const v of criteria.variables) vd.set(v.key, calc(v.expr, vd) ?? 0);
    const rules = new Map(criteria.replace.map((r) => [r.key, r.expr]));
    const done: string[] = [];
    const ignored: string[] = [];
    const noCalc: string[] = [];
    for (const k of [...missingScalars]) {
      const expr = rules.get(k);
      if (expr === undefined) {
        noCalc.push(`${k}<br>`);
        continue;
      }
      const r = calc(expr, vd);
      const v = r === undefined ? NaN : Math.trunc(r);
      if (r !== undefined && v >= 0 && v <= 255) {
        setScalar(k, v);
        missingScalars.splice(missingScalars.indexOf(k), 1);
        done.push(`${k}: ${v} (${expr})<br>`);
      } else ignored.push(`${k}: ${Number.isNaN(v) ? 'error' : v} (${expr})<br>`);
    }
    if (done.length) {
      report.replace.push('Config replace summary<br>', `Number of calculated variables: :${done.length}<br>`);
      if (noCalc.length) report.replace.push(`Number of missing calculation rules:${noCalc.length}<br>`);
      if (ignored.length) report.replace.push(`Number of ignored calculations:${ignored.length}<br>`);
      report.replace.push('Missing keys that there are calculations:<br>', ...done);
      if (ignored.length) report.replace.push('Missing keys that there are calculations but ignored (out of range):<br>', ...ignored);
      if (noCalc.length) report.replace.push('Missing keys that there are no calculations:<br>', ...noCalc);
    }
  }

  // 4. FwRules — cfgVersion < V <= ecuVersion; buckets with the same fw merge, first-seen order
  const buckets = new Map<string, { key: string; expr: string }[]>();
  for (const b of criteria.fwRules) buckets.set(b.fw, [...(buckets.get(b.fw) ?? []), ...b.rules]);
  const vd = variables();
  const fw = new Set<string>();
  for (const [V, rules] of buckets) {
    if (!(cmp(cfgVersion, V) < 0 && cmp(ecu.version, V) >= 0)) {
      fw.add(`<i>${V} rules skipped. ECU version: ${ecu.version}, config version: ${cfgVersion}</i>`);
      continue;
    }
    for (const { key, expr } of rules) {
      const old = scalarOf(key);
      if (old === undefined) {
        fw.add(`<b>${key}</b> has not been updated (not found in config)`);
        continue;
      }
      const r = calc(expr, vd);
      if (r === undefined || r < 0) {
        fw.add(`<b>${key}</b> has not been updated (not valid or result < 0)`);
        continue;
      }
      const v = Math.trunc(r);
      setScalar(key, v);
      vd.set(key, v);
      fw.add(`<b>${key}</b> has been updated from <b>${old}</b> to <b>${v}</b> by the rule <i>'${key} = ${expr}'</i> (fw >= ${V})`);
    }
  }
  report.fwRules = [...fw];

  // 5. v3_configfilter: drop present keys (missing ones may still come from the default)
  const dropScalars = (keys: string[] | undefined) => {
    for (const k of keys ?? []) if (lines.has(k) && !groupOf(lines.get(k)!).table && lines.delete(k)) report.filtered.push(k);
  };
  dropScalars(input.filterKeys);

  // 6. full configs: calibrations, defaults, b extension, prohibit
  if (!report.partial) {
    if (report.alien) dropScalars(input.calibrationKeys);
    const def = input.defaults;
    if (def && (missingScalars.length || missingTables.length)) {
      report.defaultConfig = def.version;
      const defLines = new Map(def.file.entries.map((e) => [entryKey(e), e]));
      for (const k of missingScalars) {
        const d = defLines.get(k);
        if (d) {
          lines.set(k, { ...d, bytes: [...d.bytes] });
          report.fromDefault.push(k);
        }
      }
      for (const t of missingTables)
        for (const d of def.file.entries)
          if (groupOf(d).table && groupOf(d).key === t) {
            lines.set(entryKey(d), { ...d, bytes: [...d.bytes] });
            if (!report.fromDefault.includes(t)) report.fromDefault.push(t);
          }
      // extendTable(b): default b with the user's b bytes copied over (row-major, min length)
      if (!missingTables.includes('b')) {
        const userRows = [...lines.values()].filter((e) => groupOf(e).table && groupOf(e).key === 'b');
        const defRows = def.file.entries.filter((e) => groupOf(e).table && groupOf(e).key === 'b');
        if (defRows.length && userRows.length) {
          const userBytes = userRows.flatMap((e) => e.bytes);
          let i = 0;
          for (const d of defRows) {
            const k = entryKey(d);
            const bytes = d.bytes.map((b) => (i < userBytes.length ? userBytes[i++]! : (i++, b)));
            lines.set(k, { ...d, bytes });
          }
        }
      }
    }
    const pc = scalarOf('prohibit_config');
    if (pc !== undefined && !(pc & 0x80)) {
      const [ma, mi, pa] = ver(ecu.version);
      const p = ((ma & 7) << 10) | ((mi & 7) << 7) | (pa & 0x7f) | (ecu.isPs2 ? 0x8000 : 0);
      report.prohibit = [(p >> 8) & 0xff, p & 0xff];
      setScalar('prohibit_h', report.prohibit[0]);
      setScalar('prohibit_l', report.prohibit[1]);
    }
  }

  return { file: { ...file, entries: [...lines.values()] }, report };
}

/** Keys of a filter-style .vemscfg (v3_configfilter, calibrations). */
export const keysOf = (f: VemsCfgFile) => f.entries.map((e) => entryKey(e));
