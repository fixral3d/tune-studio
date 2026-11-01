/**
 * Top-level INI config loader: preprocess → parse [Constants]/[OutputChannels]
 * into a field/channel model grouped by page, plus [TableEditor]/[CurveEditor]
 * descriptors and the [SIPR] vt-page → ecuPageId map. Expression fields keep
 * their source string for the (separate) expression engine.
 */
import { TokType, tokInt, tokNum, tokText, type Token } from './tokenizer.js';
import { preprocess, type PreprocessOptions } from './preprocess.js';
import { parseChannelLine, parseConstantLine, type Field } from './field.js';

/** A 3D table from [TableEditor]: zSym is the editable array, x/y are axis arrays. */
export interface TableDesc {
  id: string; // 2D id (t1)
  id3d: string; // 3D id (t2) — what [Menu] references
  title: string;
  xSym?: string;
  ySym?: string;
  zSym?: string;
  xChannel?: string;
  yChannel?: string;
  zChannel?: string;
}

/** A 2D curve from [CurveEditor]. */
export interface CurveDesc {
  id: string;
  title: string;
  xSym?: string;
  ySym?: string;
  xChannel?: string;
  yChannel?: string;
  gauge?: string;
  /** `columnLabel = "x", "y"` (VemsCurveDialogDesc +0x14 / +0x1c). */
  xLabel?: string;
  yLabel?: string;
  /** `xAxis`/`yAxis = min, max, divisions, "fmt"` (parseCurveEditor: getDouble 1,2 · getInt 3 · fmt 4). */
  xAxis?: CurveAxis;
  yAxis?: CurveAxis;
}
export interface CurveAxis {
  min: number;
  max: number;
  count: number;
  format: string;
}

/**
 * Bins of a curve whose `xBins = SEQUENCE, channel`: no array in the config, the axis is
 * `count` evenly spaced points from xAxis min..max (deadtime 8,16,5 → 8,10,12,14,16 V).
 */
export function curveSequenceBins(c: CurveDesc, n: number): number[] | undefined {
  if (c.xSym !== 'SEQUENCE' || !c.xAxis || n < 1) return undefined;
  const { min, max } = c.xAxis;
  return Array.from({ length: n }, (_, i) => (n === 1 ? min : min + ((max - min) * i) / (n - 1)));
}

/** [Menu] subMenu (parseMenu): t3 is getInt (always 0 in shipped files), t4 the enable expr. */
export interface MenuItem {
  target: string;
  label: string;
  page: number;
  cond?: string;
}
export interface MenuDesc {
  title: string;
  items: (MenuItem | 'separator')[];
}

/**
 * [UserDefined] field (parseUserDefined → UserEditField):
 *   field = "label", symbol, enable(t3), comboSymbol(t4), visible(t5)
 * label = t1.AfterFirst('#') or t1 when it has no '#'.
 */
export interface DialogField {
  label: string;
  /** 'header' = symbol-less '#…', 'text' = other symbol-less line, 'edit' = has a symbol. */
  kind: 'header' | 'text' | 'edit';
  symbol?: string;
  enable?: string;
  combo?: string;
  visible?: string;
}
export interface DialogDesc {
  id: string;
  title: string;
  layout: number;
  help?: string;
  fields: DialogField[];
}

/** [SuperTable]/[SuperCurve]: shows the first variant whose condition holds. */
export interface SuperDesc {
  id: string;
  id3d?: string;
  title: string;
  variants: { id: string; cond?: string }[];
}

export interface VemsConfig {
  constants: Field[];
  channels: Field[];
  pages: Map<number, Field[]>;
  byName: Map<string, Field>;
  ochGetCommand?: string;
  /** 3D tables keyed by id3d (falls back to id when no 3D id). */
  tables: Map<string, TableDesc>;
  /** 2D curves keyed by id. */
  curves: Map<string, CurveDesc>;
  /** vt page number → ecuPageId (from [SIPR] vt_2_ecu_id). */
  vt2ecu: Map<number, number>;
  burnCommand?: string;
  menus: MenuDesc[];
  dialogs: Map<string, DialogDesc>;
  /** supertables keyed by id and id3d; supercurves keyed by id. */
  superTables: Map<string, SuperDesc>;
  superCurves: Map<string, SuperDesc>;
  /** [SymbolAlias] `iniName = alias`: alias (firmware/old name, e.g. j_r) → INI name; first mapping wins. */
  aliases: Map<string, string>;
}

const txt = (t: Token | undefined) => tokText(t);

export function loadConfig(text: string, file: string, opts: PreprocessOptions): VemsConfig {
  const lines = preprocess(text, file, opts);
  const cfg: VemsConfig = {
    constants: [],
    channels: [],
    pages: new Map(),
    byName: new Map(),
    tables: new Map(),
    curves: new Map(),
    vt2ecu: new Map(),
    menus: [],
    dialogs: new Map(),
    superTables: new Map(),
    superCurves: new Map(),
    aliases: new Map(),
  };
  let page = 0;
  let curTable: TableDesc | undefined;
  let curCurve: CurveDesc | undefined;
  let curMenu: MenuDesc | undefined;
  let curDialog: DialogDesc | undefined;
  let curSuperT: SuperDesc | undefined;
  let curSuperC: SuperDesc | undefined;
  const menu = (title: string) => {
    let m = cfg.menus.find((x) => x.title === title);
    if (!m) cfg.menus.push((m = { title, items: [] }));
    return m;
  };

  for (const line of lines) {
    const { tokens, section } = line;
    const key = tokens[0]?.type === TokType.Ident ? tokens[0]!.text : '';

    if (section === 'Constants') {
      if (key === 'page' && tokens[1]) {
        page = tokInt(tokens[1]);
        continue;
      }
      const f = parseConstantLine(tokens, page);
      if (f) {
        cfg.constants.push(f);
        cfg.byName.set(f.name, f);
        if (f.kind !== 'computed') {
          const arr = cfg.pages.get(f.page) ?? [];
          arr.push(f);
          cfg.pages.set(f.page, arr);
        }
      }
    } else if (section === 'OutputChannels' || section === 'HiddenOutputChannels') {
      if (key.toLowerCase() === 'ochgetcommand' && tokens[1]) {
        cfg.ochGetCommand = tokens[1].text;
        continue;
      }
      const f = parseChannelLine(tokens);
      if (f) {
        cfg.channels.push(f);
        cfg.byName.set(f.name, f);
      }
    } else if (section === 'TableEditor') {
      if (key === 'table') {
        curTable = { id: txt(tokens[1]), id3d: txt(tokens[2]) || txt(tokens[1]), title: txt(tokens[3]) };
        cfg.tables.set(curTable.id3d, curTable);
      } else if (curTable && key === 'xBins') {
        curTable.xSym = txt(tokens[1]);
        curTable.xChannel = txt(tokens[2]);
      } else if (curTable && key === 'yBins') {
        curTable.ySym = txt(tokens[1]);
        curTable.yChannel = txt(tokens[2]);
      } else if (curTable && key === 'zBins') {
        curTable.zSym = txt(tokens[1]);
        curTable.zChannel = txt(tokens[2]);
      }
    } else if (section === 'CurveEditor') {
      if (key === 'curve') {
        curCurve = { id: txt(tokens[1]), title: txt(tokens[2]) };
        cfg.curves.set(curCurve.id, curCurve);
      } else if (curCurve && key === 'xBins') {
        curCurve.xSym = txt(tokens[1]);
        curCurve.xChannel = txt(tokens[2]);
      } else if (curCurve && key === 'yBins') {
        curCurve.ySym = txt(tokens[1]);
        curCurve.yChannel = txt(tokens[2]);
      } else if (curCurve && key === 'columnLabel') {
        curCurve.xLabel = txt(tokens[1]);
        curCurve.yLabel = txt(tokens[2]);
      } else if (curCurve && (key === 'xAxis' || key === 'yAxis')) {
        const ax = { min: tokNum(tokens[1]), max: tokNum(tokens[2]), count: tokInt(tokens[3]), format: txt(tokens[4]) };
        if (key === 'xAxis') curCurve.xAxis = ax;
        else curCurve.yAxis = ax;
      } else if (curCurve && key.toLowerCase() === 'gauge') {
        curCurve.gauge = txt(tokens[1]);
      }
    } else if (section === 'Menu') {
      // keys are case-sensitive: `submenu` and `plugIn` are ignored (INI-DIALECT §5.7)
      if (key === 'menu') {
        curMenu = menu(txt(tokens[1]));
      } else if (key === 'subMenu' && tokens[1]) {
        const m = curMenu ?? menu('default');
        const target = txt(tokens[1]);
        if (target === 'std_separator') m.items.push('separator');
        else m.items.push({ target, label: txt(tokens[2]) || target, page: tokInt(tokens[3]), cond: tokens[4]?.text });
      }
    } else if (section === 'UserDefined') {
      if (key === 'dialog') {
        curDialog = { id: txt(tokens[1]), title: txt(tokens[2]), layout: tokInt(tokens[3]), fields: [] };
        cfg.dialogs.set(curDialog.id, curDialog);
      } else if (curDialog && key.toLowerCase() === 'topichelp') {
        curDialog.help = txt(tokens[1]);
      } else if (curDialog && key === 'field') {
        const raw = txt(tokens[1]);
        const hash = raw.indexOf('#');
        const label = hash >= 0 ? raw.slice(hash + 1) : raw;
        const symbol = txt(tokens[2]) || undefined;
        curDialog.fields.push({
          label,
          kind: symbol ? 'edit' : raw.startsWith('#') ? 'header' : 'text',
          symbol,
          enable: tokens[3]?.text || undefined,
          combo: txt(tokens[4]) || undefined,
          visible: tokens[5]?.text || undefined,
        });
      }
    } else if (section === 'SuperTable') {
      if (key === 'supertable') {
        curSuperT = { id: txt(tokens[1]), id3d: txt(tokens[2]), title: txt(tokens[3]), variants: [] };
        cfg.superTables.set(curSuperT.id, curSuperT);
        if (curSuperT.id3d) cfg.superTables.set(curSuperT.id3d, curSuperT);
      } else if (curSuperT && key.toLowerCase() === 'table') {
        curSuperT.variants.push({ id: txt(tokens[1]), cond: tokens[2]?.text });
      }
    } else if (section === 'SuperCurve') {
      if (key === 'supercurve') {
        curSuperC = { id: txt(tokens[1]), title: txt(tokens[2]), variants: [] };
        cfg.superCurves.set(curSuperC.id, curSuperC);
      } else if (curSuperC && key.toLowerCase() === 'curve') {
        curSuperC.variants.push({ id: txt(tokens[1]), cond: tokens[2]?.text });
      }
    } else if (section === 'SymbolAlias') {
      const alias = txt(tokens[1]);
      if (key && alias && !cfg.aliases.has(alias)) cfg.aliases.set(alias, key);
    } else if (section === 'SIPR') {
      if (key.toLowerCase() === 'vt_2_ecu_id') {
        cfg.vt2ecu.set(tokInt(tokens[1]), tokInt(tokens[2]));
      } else if (key.toLowerCase() === 'burncommand' && tokens[1]) {
        cfg.burnCommand = tokens[1].text;
      }
    }
  }
  return cfg;
}

export type MenuTarget =
  | { kind: 'dialog'; dialog: DialogDesc }
  | { kind: 'table'; table: TableDesc }
  | { kind: 'curve'; curve: CurveDesc }
  | { kind: 'unknown'; id: string };

/**
 * Resolve a [Menu] target id across the dialog/table/curve namespaces.
 * SuperTable/SuperCurve ids resolve to their first variant for which `test(cond)` holds.
 */
export function resolveTarget(cfg: VemsConfig, id: string, test: (cond?: string) => boolean): MenuTarget {
  const st = cfg.superTables.get(id);
  if (st) id = (st.variants.find((v) => test(v.cond)) ?? st.variants[0])?.id ?? id;
  const sc = cfg.superCurves.get(id);
  if (sc) id = (sc.variants.find((v) => test(v.cond)) ?? sc.variants[0])?.id ?? id;
  const dialog = cfg.dialogs.get(id);
  if (dialog) return { kind: 'dialog', dialog };
  const table = cfg.tables.get(id) ?? [...cfg.tables.values()].find((t) => t.id === id);
  if (table) return { kind: 'table', table };
  const curve = cfg.curves.get(id);
  if (curve) return { kind: 'curve', curve };
  return { kind: 'unknown', id };
}

/** ecuPageId to use for reading/writing the page that holds `field`. */
export function ecuIdForField(cfg: VemsConfig, field: Field): number | undefined {
  return cfg.vt2ecu.get(field.page);
}
