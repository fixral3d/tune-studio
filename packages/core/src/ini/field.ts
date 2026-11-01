/** Field/channel model parsed from [Constants] and [OutputChannels]. */
import { TokType, tokInt, tokNum, tokText, type Token } from './tokenizer.js';

export interface IniType {
  signed: boolean;
  size: 1 | 2 | 3 | 4;
  float: boolean;
}

/** parseTypeSpec @0x4dcdbc — (U|S|F)(08|16|24|32). Lenient: also accepts U8 etc. */
export function parseType(text: string): IniType | undefined {
  const m = /^([USF])(0?8|16|24|32)/.exec(text);
  if (!m) return undefined;
  const sz = { '8': 1, '08': 1, '16': 2, '24': 3, '32': 4 }[m[2]!] as 1 | 2 | 3 | 4;
  return { signed: m[1] !== 'U', size: sz, float: m[1] === 'F' };
}

export interface ArrayShape {
  order: number; // 1 = X-order (x fast), 0 = Y-order
  dims: [number] | [number, number];
}

export type Field =
  | ScalarField
  | ArrayField
  | BitsField
  | ComputedField;

export interface FieldBase {
  name: string;
  page: number;
  units: string;
  /** false for ECU constants (writable config), true for realtime channels. */
  realtime: boolean;
}
export interface ScalarField extends FieldBase {
  kind: 'scalar';
  type: IniType;
  offset: number;
  scale: number;
  translate: number;
  lo: number;
  hi: number;
  digits: number;
  fromRawExpr?: string;
  toRawExpr?: string;
}
export interface ArrayField extends FieldBase {
  kind: 'array';
  type: IniType;
  offset: number;
  shape: ArrayShape;
  scale: number;
  translate: number;
  lo: number;
  hi: number;
  digits: number;
  fromRawExpr?: string;
  toRawExpr?: string;
}
export interface BitsField extends FieldBase {
  kind: 'bits';
  type: IniType;
  offset: number;
  bitLo: number;
  bitHi: number;
  bitOfs: number;
  labels: string[];
  validationExpr?: string;
}
export interface ComputedField extends FieldBase {
  kind: 'computed';
  expr: string;
  reverseExpr?: string;
  target?: string;
  digits: number;
  gaugeType?: string;
  title?: string;
}

const isExpr = (t: Token | undefined) => t?.type === TokType.Expr;

/** parseArraySpec @0x4dd5c4 — ^(Y:|X:|)(\d+|(\d+)x(\d+)) ICASE, spaces stripped. */
export function parseArrayShape(text: string): ArrayShape | undefined {
  const s = text.replace(/\s+/g, '');
  const m = /^(Y:|X:|)(?:(\d+)x(\d+)|(\d+))/i.exec(s);
  if (!m) return undefined;
  const order = /^y:/i.test(m[1]!) ? 0 : 1;
  if (m[2] && m[3]) return { order, dims: [parseInt(m[2], 10), parseInt(m[3], 10)] };
  if (m[4]) return { order, dims: [parseInt(m[4], 10)] };
  return undefined;
}

/** parseBitSpec @0x4de15a — ^(\d+):(\d+)\+?(\d*) */
function parseBitSpec(text: string): { lo: number; hi: number; ofs: number } | undefined {
  const m = /^(\d+):(\d+)\+?(\d*)/.exec(text.trim());
  if (!m) return undefined;
  return { lo: parseInt(m[1]!, 10), hi: parseInt(m[2]!, 10), ofs: m[3] ? parseInt(m[3], 10) : 0 };
}

/** Parse one [Constants] line into a Field (or undefined to skip). */
export function parseConstantLine(toks: Token[], page: number): Field | undefined {
  const name = tokText(toks[0]);
  const t1 = toks[1];
  if (!name || !t1) return undefined;

  if (isExpr(t1)) {
    // computed constant: name = {expr}, {reverse}, target, "units", digits
    return {
      kind: 'computed',
      name,
      page: -1,
      units: tokText(toks[3]),
      realtime: false,
      expr: t1.text,
      reverseExpr: isExpr(toks[2]) ? toks[2]!.text : undefined,
      target: tokText(toks[2]) && !isExpr(toks[2]) ? undefined : tokText(toks[2]),
      digits: tokInt(toks[4]),
    };
  }

  const kind = t1.text;
  if (kind === 'scalar') {
    const type = parseType(tokText(toks[2]));
    if (!type) return undefined;
    const exprXform = isExpr(toks[4]) && isExpr(toks[5]);
    return {
      kind: 'scalar',
      name,
      page,
      type,
      offset: tokInt(toks[3]),
      units: tokText(toks[4]),
      scale: exprXform ? 0 : tokNum(toks[5]),
      translate: exprXform ? 0 : tokNum(toks[6]),
      lo: tokNum(toks[7]),
      hi: tokNum(toks[8]),
      digits: tokInt(toks[9]),
      fromRawExpr: exprXform ? toks[4]!.text : undefined,
      toRawExpr: exprXform ? toks[5]!.text : undefined,
      realtime: false,
    };
  }
  if (kind === 'array') {
    const type = parseType(tokText(toks[2]));
    const shape = parseArrayShape(tokText(toks[4]));
    if (!type || !shape) return undefined;
    const exprXform = isExpr(toks[5]) && isExpr(toks[6]);
    return {
      kind: 'array',
      name,
      page,
      type,
      offset: tokInt(toks[3]),
      shape,
      units: tokText(toks[5]),
      scale: exprXform ? 0 : tokNum(toks[6]),
      translate: exprXform ? 0 : tokNum(toks[7]),
      lo: tokNum(toks[8]),
      hi: tokNum(toks[9]),
      digits: tokInt(toks[10]),
      fromRawExpr: exprXform ? toks[5]!.text : undefined,
      toRawExpr: exprXform ? toks[6]!.text : undefined,
      realtime: false,
    };
  }
  if (kind === 'bits') {
    const type = parseType(tokText(toks[2]));
    const spec = parseBitSpec(tokText(toks[4]));
    if (!type || !spec) return undefined;
    const labels: string[] = [];
    let validationExpr: string | undefined;
    for (let i = 5; i < toks.length; i++) {
      if (toks[i]!.type === TokType.Expr) {
        validationExpr = toks[i]!.text;
        break;
      }
      labels.push(toks[i]!.text);
    }
    return {
      kind: 'bits',
      name,
      page,
      type,
      offset: tokInt(toks[3]),
      bitLo: spec.lo,
      bitHi: spec.hi,
      bitOfs: spec.ofs,
      labels,
      validationExpr,
      units: '',
      realtime: false,
    };
  }
  return undefined;
}

/** Parse one [OutputChannels] line into a Field (realtime channel). */
export function parseChannelLine(toks: Token[]): Field | undefined {
  const name = tokText(toks[0]);
  const t1 = toks[1];
  if (!name || !t1) return undefined;
  if (isExpr(t1)) {
    return {
      kind: 'computed',
      name,
      page: -1,
      units: '',
      realtime: true,
      expr: t1.text,
      gaugeType: tokText(toks[2]) || undefined,
      title: tokText(toks[3]) || undefined,
      digits: 0,
    };
  }
  if (t1.text === 'scalar') {
    const type = parseType(tokText(toks[2]));
    if (!type) return undefined;
    return {
      kind: 'scalar',
      name,
      page: 0,
      type,
      offset: tokInt(toks[3]),
      units: tokText(toks[4]),
      scale: tokNum(toks[5]),
      translate: tokNum(toks[6]),
      lo: tokNum(toks[7]),
      hi: tokNum(toks[8]),
      digits: tokInt(toks[9]),
      realtime: true,
    };
  }
  return undefined;
}
