/**
 * Compare two configs (FW-06) — FirmwareConfigData::{compareScalars @0x4fc4aa, compareTables
 * @0x4fcf30, searchExtra*}, FirmwareConfigDifferences::{summary @0x500002, details @0x500700}.
 * A is the reference (e.g. the ECU dump), B the config being checked (e.g. the upload config);
 * `filtered` are the keys B dropped on purpose (v3_configfilter / calibrations).
 *  - scalar in A and B with different values → "key: a != b"
 *  - scalar in A, not in B → missing, or "intentionally filtered" when B filtered it
 *  - in B only → extra; tables compare their concatenated row bytes the same way
 */
import type { VemsCfgEntry, VemsCfgFile } from './vemscfg.js';
import { groupOf } from './migrate.js';

export interface ConfigDifferences {
  missingScalars: string[];
  filteredScalars: string[];
  extraScalars: string[];
  differentScalars: string[];
  missingTables: string[];
  extraTables: string[];
  differentTables: string[];
}

const scalarValue = (bytes: number[]) => bytes.reduce((a, b) => a * 256 + b, 0);

function model(f: VemsCfgFile) {
  const scalars = new Map<string, number>();
  const tables = new Map<string, number[]>();
  for (const e of f.entries as VemsCfgEntry[]) {
    const g = groupOf(e);
    if (g.table) tables.set(g.key, [...(tables.get(g.key) ?? []), ...e.bytes]);
    else scalars.set(g.key, scalarValue(e.bytes));
  }
  return { scalars, tables };
}

export function compareConfigs(a: VemsCfgFile, b: VemsCfgFile, filtered: Iterable<string> = []): ConfigDifferences {
  const A = model(a);
  const B = model(b);
  const filt = new Set(filtered);
  const d: ConfigDifferences = {
    missingScalars: [],
    filteredScalars: [],
    extraScalars: [],
    differentScalars: [],
    missingTables: [],
    extraTables: [],
    differentTables: [],
  };
  for (const [k, v] of A.scalars) {
    const w = B.scalars.get(k);
    if (w === undefined) (filt.has(k) ? d.filteredScalars : d.missingScalars).push(k);
    else if (v !== w) d.differentScalars.push(`${k}: ${v} != ${w}`);
  }
  for (const k of B.scalars.keys()) if (!A.scalars.has(k)) d.extraScalars.push(k);
  for (const [t, bytes] of A.tables) {
    const o = B.tables.get(t);
    if (!o) d.missingTables.push(t);
    else if (o.length !== bytes.length || o.some((x, i) => x !== bytes[i])) d.differentTables.push(t);
  }
  for (const t of B.tables.keys()) if (!A.tables.has(t)) d.extraTables.push(t);
  return d;
}

export const isIdentical = (d: ConfigDifferences) => Object.values(d).every((l) => l.length === 0);

/** FirmwareConfigDifferences::summary — one "Found …" line per non-empty group. */
export function differencesSummary(d: ConfigDifferences, nl = '\n'): string {
  const lines: [number, string][] = [
    [d.missingScalars.length, `Found ${d.missingScalars.length} missing scalar(s)!`],
    [d.filteredScalars.length, `Found ${d.filteredScalars.length} intentionally filtered scalar(s)!`],
    [d.extraScalars.length, `Found ${d.extraScalars.length} extra scalar(s)!`],
    [d.differentScalars.length, `Found ${d.differentScalars.length} different scalar value(s)!`],
    [d.missingTables.length, `Found ${d.missingTables.length} missing tables(s)!`],
    [d.extraTables.length, `Found ${d.extraTables.length} extra tables(s)!`],
    [d.differentTables.length, `Found ${d.differentTables.length} different table value(s)!`],
  ];
  return lines.filter(([n]) => n > 0).map(([, s]) => s + nl).join('');
}

/** FirmwareConfigDifferences::details(prefix, newline): section header, then prefix+item per line. */
export function differencesDetails(d: ConfigDifferences, prefix = '  ', nl = '\n'): string {
  const sections: [string[], string][] = [
    [d.missingScalars, 'Missing scalar(s) found!'],
    [d.filteredScalars, 'Intentionally filtered scalar(s) found!'],
    [d.extraScalars, 'Extra scalar(s) found!'],
    [d.differentScalars, 'Different scalar value(s) found! '],
    [d.missingTables, 'Missing tables(s) found! '],
    [d.extraTables, 'Extra tables(s) found! '],
    [d.differentTables, 'Different table value(s) found! '],
  ];
  return sections
    .filter(([l]) => l.length)
    .map(([l, h]) => h + nl + l.map((x) => prefix + x + nl).join(''))
    .join('');
}
