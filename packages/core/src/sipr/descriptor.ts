/**
 * SIPR descriptor: the bridge between VemsTune page numbers, the ECU's
 * read/write command chars, SIPR config/table ids and their sizes.
 * Built from the [SIPR] section of a vems INI include (e.g.
 * config/include/sipr-1.2.34.ini). Mirrors SIPRDescriptor / SiprDescHelper.
 *
 * Grammar (one entry per line, comma- or space-separated, values may be quoted):
 *   burnCommand   = "B"
 *   realtime_page = "A", "SIPR_RT_MT_NORMAL"
 *   page          = <no>, "<read>", "<write>", "<configType>", "<table>"[, "<table2>"]
 *   vt_2_ecu_id   = <pageNo>, <ecuId>
 *   page_eeprom   = <no>, "<id-source>", "<configType>", "<table>"
 *   sipr_table    = "<name>", <offset>, <size>
 *   sipr_config   = "<name>", <offset>, <size>
 * A minimal #if/#else/#endif preprocessor (single upper-cased name, unknown=false)
 * matches VemsTune's own conditional handling.
 */
export interface SiprPage {
  pageNo: number;
  readCommand: string;
  writeCommand: string;
  configType: string; // SIPR_GET_TABLEDATA / SIPR_GET_CONFIG_1 / ...
  tableIds: string[];
  ecuId?: number; // from vt_2_ecu_id
  eeprom?: boolean;
}

export interface SiprTable {
  name: string;
  offset: number;
  size: number;
}

export interface SiprDescriptor {
  burnCommand: string;
  realtimePages: { command: string; type: string }[];
  pages: SiprPage[];
  tables: Map<string, SiprTable>;
  configs: Map<string, SiprTable>;
}

/** Split a value list on commas/whitespace, stripping quotes and inline comments. */
function tokenize(rhs: string): string[] {
  const noComment = rhs.replace(/;.*$/, '');
  const out: string[] = [];
  const re = /"([^"]*)"|([^,\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComment))) out.push(m[1] ?? m[2] ?? '');
  return out;
}

const numOf = (s: string | undefined): number =>
  s === undefined ? NaN : s.startsWith('0x') ? parseInt(s, 16) : parseInt(s, 10);

export function parseSiprSection(iniText: string, defines: Set<string> = new Set()): SiprDescriptor {
  const d: SiprDescriptor = {
    burnCommand: 'B',
    realtimePages: [],
    pages: [],
    tables: new Map(),
    configs: new Map(),
  };
  const byPage = new Map<number, SiprPage>();

  let inSection = false;
  const condStack: boolean[] = []; // active flags
  const active = () => condStack.every(Boolean);

  for (const raw of iniText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;

    if (line.startsWith('#if')) {
      const name = line.slice(3).trim().toUpperCase();
      condStack.push(defines.has(name));
      continue;
    }
    if (line.startsWith('#else')) {
      if (condStack.length) condStack[condStack.length - 1] = !condStack[condStack.length - 1];
      continue;
    }
    if (line.startsWith('#endif')) {
      condStack.pop();
      continue;
    }
    if (line.startsWith('[')) {
      inSection = /^\[SIPR\]/i.test(line);
      continue;
    }
    if (!inSection || !active()) continue;

    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const vals = tokenize(line.slice(eq + 1));

    switch (key) {
      case 'burnCommand':
        if (vals[0]) d.burnCommand = vals[0];
        break;
      case 'realtime_page':
        d.realtimePages.push({ command: vals[0] ?? '', type: vals[1] ?? '' });
        break;
      case 'page':
      case 'page_eeprom': {
        const pageNo = numOf(vals[0]);
        if (key === 'page_eeprom') {
          byPage.set(pageNo, {
            pageNo,
            readCommand: '',
            writeCommand: '',
            configType: vals[2] ?? '',
            tableIds: vals.slice(3).filter(Boolean),
            eeprom: true,
          });
        } else {
          byPage.set(pageNo, {
            pageNo,
            readCommand: vals[1] ?? '',
            writeCommand: vals[2] ?? '',
            configType: vals[3] ?? '',
            tableIds: vals.slice(4).filter(Boolean),
          });
        }
        break;
      }
      case 'vt_2_ecu_id': {
        const p = byPage.get(numOf(vals[0]));
        if (p) p.ecuId = numOf(vals[1]);
        break;
      }
      case 'sipr_table':
        d.tables.set(vals[0]!, { name: vals[0]!, offset: numOf(vals[1]), size: numOf(vals[2]) });
        break;
      case 'sipr_config':
        d.configs.set(vals[0]!, { name: vals[0]!, offset: numOf(vals[1]), size: numOf(vals[2]) });
        break;
    }
  }

  d.pages = [...byPage.values()].sort((a, b) => a.pageNo - b.pageNo);
  return d;
}

/** Total ECU-side byte size of a page = sum of its tables' sizes. */
export function pageByteSize(d: SiprDescriptor, page: SiprPage): number {
  return page.tableIds.reduce((sum, id) => sum + (d.tables.get(id)?.size ?? 0), 0);
}
