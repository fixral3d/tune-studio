/**
 * Config Sanity Check — ConfigValidatorHelper::validate @0x4f1b20 / ConfigValidatorMgr.
 *
 * Rules (ConfigCriteria.xml <Validate>):
 *  - fw gate: skip when fw < minfw or fw > maxfw (inclusive; defaults 0.0.0 / 9.9.99)
 *  - items are tried in file order; an item matches when its value is > 0 (or NaN);
 *    the FIRST match decides: ok → passed, warning/error → message; no match → passed
 *  - evaluation errors (incl. unknown names) make the whole expression read 0
 *  - <Variables> are evaluated once, in document order, and shadow symbols of the same name
 * Names resolve (verified against VemsTune output): Variables → firmware global.h struct field
 * (raw bytes) → INI symbol / [SymbolAlias] (raw) → <ReplaceRules> → 0.
 * Then: summary, checkChannelCollisions, checkInvalidChannels, checkInvalidBits, button state.
 */
import type { DialogDesc, VemsConfig } from '../ini/config.js';
import type { BitsField, Field } from '../ini/field.js';
import { compileExpr, type ExprContext } from '../ini/expr.js';
import { arrayLength, readBits, readRawInt } from '../ini/value.js';
import { ConfigEvaluator } from '../ini/evaluator.js';
import type { FwSymbols } from './fwlayout.js';
import type { ConfigCriteria, CriteriaRule } from './criteria.js';

/** 0 = warning, 1 = error, 2 = info (VemsMessage severity). */
export type Severity = 'warning' | 'error' | 'info';

export interface ValidationMessage {
  severity: Severity;
  key: string;
  message: string;
  /** HTML detail ($MENU_LINK / $n expanded). Links: href = dialog id, target = symbols. */
  detail?: string;
}

/** Output-channel metadata from VemsTune's config/outputchannels.s3db. */
export interface ChannelDb {
  validTypes: number[];
  symbols: { name: string; fullname: string; dualsymbol: string }[];
  /** [dual, h2x, type_id, channel_id] */
  ignitionmap: number[][];
}

export interface ValidationResult {
  /** rule messages, the summary, then channel/bits messages — the VemsTune list order. */
  messages: ValidationMessage[];
  /** summary counters (rules only, as VemsTune prints them). */
  rules: number;
  passed: number;
  warnings: number;
  errors: number;
  /** errors including channel/bits checks (drive the toolbar state). */
  totalErrors: number;
  collisions: number;
  invalidChannels: number;
  /** getButtonState: 1 green, 2/3 red (1 / ≥2 errors), 4/5 gold (3 / ≥4 warnings). */
  buttonState: 1 | 2 | 3 | 4 | 5;
  /** rules skipped by the firmware gate. */
  skipped: string[];
  /** INI diagnostics VemsTune builds but does not list ("Symbol bits check"). */
  diagnostics: ValidationMessage[];
}

export interface ValidateOptions {
  /** firmware version "1.2.34" for minfw/maxfw gating (no gating when absent). */
  firmware?: string;
  /** firmware global.h symbols (resolved before INI names). */
  fw?: FwSymbols;
  /** enables the channel collision / invalid channel checks. */
  channels?: ChannelDb;
}

const verNum = (v: string) => v.split('.').reduce((a, p) => a * 1000 + (parseInt(p, 10) || 0), 0);

/** Identifiers of an expression in first-appearance order (same char set as the RPN lexer). */
const exprVars = (expr: string) => {
  const out: string[] = [];
  for (const m of expr.matchAll(/[A-Za-z][A-Za-z0-9_-]*(?:\[[^\]]*\])?/g)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
};

class CriteriaContext implements ExprContext {
  private vars = new Map<string, number>();
  private replace = new Map<string, string>();
  private ev: ConfigEvaluator;
  private resolving = new Set<string>();

  constructor(
    private cfg: VemsConfig,
    private pages: Map<number, Uint8Array>,
    criteria: ConfigCriteria,
    private fw?: FwSymbols,
  ) {
    this.ev = new ConfigEvaluator(cfg, { pages });
    for (const r of criteria.replace) this.replace.set(r.key, r.expr);
    // setVariableData: sequential, each result visible to later Variables and all rules
    for (const v of criteria.variables) this.vars.set(v.key, this.calc(v.expr));
  }

  field(name: string): Field | undefined {
    return this.cfg.byName.get(name) ?? this.cfg.byName.get(this.cfg.aliases.get(name) ?? '');
  }

  /** Raw INI value: scalars as stored integers, bits as the extracted field, computed via the evaluator. */
  iniValue(f: Field, index?: number): number | undefined {
    if (f.kind === 'computed') return index === undefined ? safe(() => this.ev.value(f.name)) : undefined;
    const buf = this.pages.get(f.page);
    if (!buf) return undefined;
    if (f.kind === 'array') {
      if (index === undefined || index >= arrayLength(f)) return undefined;
      return readRawInt(buf, f.offset + index * f.type.size, f.type);
    }
    if (index !== undefined) return undefined;
    return f.kind === 'scalar' ? readRawInt(buf, f.offset, f.type) : readBits(buf, f);
  }

  getValue(name: string): number | undefined {
    const known = this.vars.get(name);
    if (known !== undefined) return known;
    const m = /^(.+)\[(\d+)\]$/.exec(name);
    const base = m ? m[1]! : name;
    const idx = m ? Number(m[2]) : undefined;
    let v: number | undefined;
    if (this.fw?.has(base)) v = this.fw.value(base, idx);
    else {
      const f = this.field(base);
      if (f) v = this.iniValue(f, idx);
    }
    const rep = this.replace.get(name);
    if (v === undefined && rep !== undefined && !this.resolving.has(name)) {
      this.resolving.add(name);
      try {
        v = this.calc(rep);
      } finally {
        this.resolving.delete(name);
      }
    }
    return v; // unknown → "variable not found" → the whole expression reads 0
  }

  getArray(name: string): number[] | undefined {
    const f = this.field(name);
    return f ? this.ev.getArray(f.name) : undefined;
  }

  /** RPNParser::calculate: errors (and blank expressions) give 0. */
  calc(expr: string): number {
    if (!expr.trim()) return 0;
    try {
      return compileExpr(expr).evaluate(this);
    } catch {
      return 0;
    }
  }
}

const safe = <T>(fn: () => T): T | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

/** "Menu:Label" of each menu item that opens `dialogId`. */
function menuNames(cfg: VemsConfig, dialogId: string): string[] {
  const out: string[] = [];
  for (const m of cfg.menus)
    for (const it of m.items)
      if (it !== 'separator' && it.target === dialogId) out.push(`${m.title}:${it.label}`.replace(/&/g, ''));
  return out;
}

function dialogsUsing(cfg: VemsConfig, symbol: string): DialogDesc[] {
  return [...cfg.dialogs.values()].filter((d) => d.fields.some((f) => f.symbol === symbol));
}

/** MenuLinkHelper: `Please check <b>VAR</b> in menu(s):<br>` + one link per dialog using it. */
function menuLinkHtml(cfg: VemsConfig, names: string[], fromSymbols: boolean): string {
  let html = '';
  for (const raw of names) {
    const name = cfg.byName.has(raw) ? raw : cfg.aliases.get(raw) ?? raw.replace(/\[\d+\]$/, '');
    if (!cfg.byName.has(name)) continue;
    const dialogs = dialogsUsing(cfg, name);
    if (!dialogs.length) continue;
    html += `Please check <b>${raw}</b> in menu(s):${fromSymbols ? ' ' : ''}<br>`;
    for (const d of dialogs) {
      const label = menuNames(cfg, d.id)[0] ?? d.title;
      html += `<a href="${d.id}" target="${name}">${label}</a><br>`;
    }
    html += '<br>';
  }
  return html;
}

/** VemsMessage template substitution: `$KEY ` → `VALUE ` (the trailing space is required). */
function applyTemplates(text: string, params: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(params)) out = out.split(`$${k} `).join(`${v} `);
  return out;
}

export function validateConfig(
  criteria: ConfigCriteria,
  cfg: VemsConfig,
  pages: Map<number, Uint8Array>,
  opts: ValidateOptions = {},
): ValidationResult {
  const ctx = new CriteriaContext(cfg, pages, criteria, opts.fw);
  const fw = opts.firmware ? verNum(opts.firmware) : undefined;
  const messages: ValidationMessage[] = [];
  const skipped: string[] = [];
  let passed = 0;
  let warnings = 0;
  let errors = 0;

  for (const rule of criteria.rules) {
    if (fw !== undefined && ((rule.minfw !== undefined && fw < verNum(rule.minfw)) || (rule.maxfw !== undefined && fw > verNum(rule.maxfw)))) {
      skipped.push(rule.key);
      continue;
    }
    const hit = rule.items.find((it) => {
      const v = ctx.calc(it.expr);
      return !(v <= 0);
    });
    if (!hit || hit.type === 'ok') {
      passed++;
      continue;
    }
    messages.push(ruleMessage(cfg, rule, hit.type, hit.expr));
    if (hit.type === 'error') errors++;
    else warnings++;
  }

  const rules = passed + warnings + errors;
  messages.push({
    severity: 'info',
    key: 'Validation summary',
    message: `Number of rules: ${rules}, Number of passed rules: ${passed}, Number of warning: ${warnings}, Number of error: ${errors}`,
  });

  let totalErrors = errors;
  let collisions = 0;
  let invalidChannels = 0;
  if (opts.channels) {
    const c = checkChannelCollisions(cfg, ctx, opts.channels);
    if (c) {
      collisions = c.count;
      totalErrors++;
      messages.push(c.message);
    }
    const ic = checkInvalidChannels(cfg, ctx, opts.channels);
    if (ic) {
      invalidChannels = ic.count;
      totalErrors++;
      messages.push(ic.message);
    }
  }
  const bits = checkInvalidBits(cfg, ctx, pages);
  totalErrors += bits.invalid;
  messages.push(...bits.messages);
  const diagnostics = bits.diagnostics;

  return {
    messages,
    rules,
    passed,
    warnings,
    errors,
    totalErrors,
    collisions,
    invalidChannels,
    buttonState: buttonState(totalErrors, warnings),
    skipped,
    diagnostics,
  };
}

export interface FieldMark {
  severity: 'warning' | 'error';
  /** "Warning: …" / "Error: …" (raw ErrorDetail HTML, as VemsTune's field tooltip). */
  text: string;
}

/**
 * Per-symbol marks for dialog fields — ConfigValidator::validate(model, file, flags 1|2):
 * ConfigValidatorMgr::validate(StringHash&) @0x4f2e22 then checkInvalidBits(StringHash&) @0x4f289a.
 *  - each fw-applicable rule's first match (warning/error) writes `Prefix + ErrorDetail` to every
 *    variable of the matched expression ('[' and ']' removed); later rules overwrite earlier ones
 *  - bits symbols: INVALID label → "Error: INVALID value"; beyond the labels →
 *    "Warning: allowed range is 0 - N" (skipped when the validation expression is 0)
 * Verified in VemsTune's Primary Trigger Settings Visual panel (tooth_wheel warning tooltip =
 * ConfigCriteria.xml detail text; Audi trigger divider "Error: INVALID value").
 */
export function fieldMarks(
  criteria: ConfigCriteria,
  cfg: VemsConfig,
  pages: Map<number, Uint8Array>,
  opts: Pick<ValidateOptions, 'firmware' | 'fw'> = {},
): Map<string, FieldMark> {
  const ctx = new CriteriaContext(cfg, pages, criteria, opts.fw);
  const fw = opts.firmware ? verNum(opts.firmware) : undefined;
  const marks = new Map<string, FieldMark>();
  for (const rule of criteria.rules) {
    if (fw !== undefined && ((rule.minfw !== undefined && fw < verNum(rule.minfw)) || (rule.maxfw !== undefined && fw > verNum(rule.maxfw)))) continue;
    const hit = rule.items.find((it) => !(ctx.calc(it.expr) <= 0));
    if (!hit || hit.type === 'ok') continue;
    const mark: FieldMark = { severity: hit.type, text: `${hit.type === 'error' ? 'Error: ' : 'Warning: '}${rule.detail ?? ''}` };
    for (const v of exprVars(hit.expr)) marks.set(v.replace(/[[\]]/g, ''), mark);
  }
  for (const f of cfg.constants) {
    if (f.kind !== 'bits') continue;
    const size = 1 << (f.bitHi - f.bitLo + 1);
    const labels = [...f.labels];
    while (labels.length < size) labels.push(String(labels.length));
    if (f.validationExpr !== undefined && ctx.calc(f.validationExpr) === 0) continue;
    const buf = pages.get(f.page);
    if (!buf) continue;
    const v = readBits(buf, { ...f, bitOfs: 0 });
    if (v < labels.length && labels[v] === 'INVALID') marks.set(f.name, { severity: 'error', text: 'Error: INVALID value' });
    else if (v >= labels.length) marks.set(f.name, { severity: 'warning', text: `Warning: allowed range is 0 - ${labels.length - 1}` });
  }
  return marks;
}

function ruleMessage(cfg: VemsConfig, rule: CriteriaRule, type: 'warning' | 'error', expr: string): ValidationMessage {
  const vars = exprVars(expr);
  const params: Record<string, string> = {
    MENU_LINK: rule.iniSymbols.length ? menuLinkHtml(cfg, rule.iniSymbols, true) : menuLinkHtml(cfg, vars, false),
  };
  vars.forEach((v, i) => (params[String(i + 1)] = v));
  return {
    severity: type,
    key: rule.key,
    message: applyTemplates((type === 'error' ? rule.errorMsg : rule.warningMsg) ?? '', params),
    detail: rule.detail !== undefined ? applyTemplates(rule.detail, params) : undefined,
  };
}

/** getButtonState @0x4f7d7c. */
export function buttonState(errors: number, warnings: number): 1 | 2 | 3 | 4 | 5 {
  if (errors + warnings === 0) return 1;
  if (errors >= 2) return 3;
  if (errors === 1) return 2;
  if (warnings >= 4) return 5;
  if (warnings === 3) return 4;
  return 1;
}

// ---------------------------------------------------------------- channel checks

/** Channel byte as ChannelCollision reads it: rounded to a byte; b > 0x80 has bit 7 flipped. */
function channelByte(ctx: CriteriaContext, name: string): number | undefined {
  const f = ctx.field(name);
  if (!f) return undefined;
  if (name === 'audi_hall_scope') {
    const g = ctx.field('isAudiHallScopeActive');
    const v = g ? ctx.iniValue(g) : undefined;
    return v === undefined ? 0xff : Math.round(v) & 0xff;
  }
  const v = ctx.iniValue(f);
  if (v === undefined) return undefined;
  let b = Math.round(v) & 0xff;
  if (b > 0x80) b = (b + 0x80) & 0xff;
  return b;
}

const isValidChannel = (db: ChannelDb, b: number) => (b & 0xf) === 0xf || db.validTypes.includes(b & 0xf);

function outputLink(display: string, targets: string): string {
  const id = display.startsWith('Injector') ? 'injOutVisual' : display.startsWith('Ignition') ? 'ignitionOutputsVisual' : 'outputChannels';
  return `<a href="${id}" target="${targets}">${id}</a>`;
}

function checkChannelCollisions(cfg: VemsConfig, ctx: CriteriaContext, db: ChannelDb) {
  const entries: { name: string; full: string; v: number }[] = [];
  for (const s of db.symbols) {
    const b = channelByte(ctx, s.name);
    if (b !== undefined && isValidChannel(db, b) && (b & 0xf) !== 0xf) entries.push({ name: s.name, full: s.fullname, v: b });
  }
  const val = (n: string) => {
    const f = ctx.field(n);
    return f ? Math.round(ctx.iniValue(f) ?? 0) : undefined;
  };
  if (val('camshaft_out_type') === 1) {
    const dual = (bitsName: string, namesName: string, name: string, full: string, ex: boolean) => {
      let bits = val(bitsName);
      const t = val(namesName);
      if (bits === undefined || t === undefined) return;
      if (ex && bits > 7) bits -= 8;
      if (bits < 7) entries.push({ name, full, v: ((bits + 1) * 16 + t) & 0xff });
    };
    dual('vvti_channel_bits', 'vvti_channel_names', 'vvti_channel_dual', 'Camshaft Intake channel (dual)', false);
    dual('camshaft_ex_channel_bits', 'camshaft_ex_channel_names', 'camshaft_ex_channel_dual', 'Camshaft Exhaust channel (dual)', true);
  }
  const found: string[] = [];
  // symbol vs symbol
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++)
      if (entries[i]!.name !== entries[j]!.name && entries[i]!.v === entries[j]!.v)
        found.push(`${entries[i]!.full}|${entries[j]!.full}|${entries[i]!.name}|${entries[j]!.name}`);
  // symbol vs injector outputs k*16+0, k = 0..alternateCyl
  const A = val('alternateCyl') ?? -1;
  for (let k = 0; k <= A; k++)
    for (const e of entries) if (e.v === k * 16) found.push(`${e.full}|Injector output ${k}|${e.name}|Injector output ${k}`);
  // symbol vs ignition outputs p = 0..ignchmax (h2p / h2dp → ignitionmap)
  const I = val('ignchmax') ?? -1;
  const dual = (val('ign_out_dual') ?? 0) !== 0 ? 1 : 0;
  for (let p = 0; p <= I; p++) {
    const h = val(dual ? `h2d${p}` : `h2${p}`);
    if (h === undefined) continue;
    const outs: number[] = [];
    for (const [d, h2x, type, ch] of db.ignitionmap)
      if (d === dual && h2x === h) {
        if (dual) outs.push((ch! - 1) * 16 + type!);
        outs.push(ch! * 16 + type!);
      }
    for (const e of entries) if (outs.includes(e.v)) found.push(`${e.full}|Ignition output ${p}|${e.name}|Ignition output ${p}`);
  }
  // IAC stepper sequence outputs
  if (val('iac_type') === 3) {
    const seq = [1, 2, 3, 4].map((s) => ((val(`iac_step_seq_${s}`) ?? 0) + 3) * 16 + 6);
    for (const e of entries) {
      const s = seq.indexOf(e.v);
      if (s >= 0) found.push(`${e.full}|iac_step_seq_${s + 1}|${e.name}|iac_step_seq_${s + 1}`);
    }
  }
  if (!found.length) return undefined;
  let html = "<font size='+2'><b>Following collisions are found:</b></font><br><br>";
  for (const f of found) {
    const [a, b, na, nb] = f.split('|') as [string, string, string, string];
    html += `<b>${a}</b> conflicts with <b>${b}</b><br>Check ${outputLink(a, `${na},${nb}`)}`;
    if (outputLink(b, '') !== outputLink(a, '')) html += ` and ${outputLink(b, `${na},${nb}`)}`;
    html += '<br><br>';
  }
  return {
    count: found.length,
    message: { severity: 'error' as const, key: 'Channel collisions', message: `${found.length} channels are in conflicting state`, detail: html },
  };
}

function checkInvalidChannels(cfg: VemsConfig, ctx: CriteriaContext, db: ChannelDb) {
  const bad: { name: string; full: string }[] = [];
  for (const s of db.symbols) {
    const b = channelByte(ctx, s.name);
    if (b !== undefined && !isValidChannel(db, b)) bad.push({ name: s.name, full: s.fullname });
  }
  if (!bad.length) return undefined;
  let html = "<font size='+2'><b>Following channels are invalid:</b></font><br><br>";
  for (const b of bad) html += `<b>${b.full}</b><br>`;
  html += `Check <a href='outputChannels' target='${bad.map((b) => b.name).join(',')}'>Output channels dialog</a><br>`;
  return {
    count: bad.length,
    message: { severity: 'error' as const, key: 'Invalid channels', message: `${bad.length} channels are not set correctly`, detail: html },
  };
}

// ---------------------------------------------------------------- bits check

function checkInvalidBits(cfg: VemsConfig, ctx: CriteriaContext, pages: Map<number, Uint8Array>) {
  let invalidHtml = '';
  let unusedHtml = '';
  let iniText = '';
  let invalid = 0;
  const dialogLine = (name: string) => {
    const ds = dialogsUsing(cfg, name);
    return ds.length
      ? `Following dialogs are usings this symbol: ${ds.map((d) => `<a href="${d.id}" target="${name}">${menuNames(cfg, d.id)[0] ?? d.title}</a>`).join(', ')}`
      : 'This symbol is not used by any dialog';
  };
  for (const f of cfg.constants) {
    if (f.kind !== 'bits') continue;
    const bf = f as BitsField;
    const size = 1 << (bf.bitHi - bf.bitLo + 1);
    const labels = [...bf.labels];
    if (labels.length < size) {
      iniText += `Some possible values of the <b>${bf.name}</b> symbol are not enumerated in the INI file<br>It should contain ${size} values but contains only ${labels.length}<br><br>`;
      while (labels.length < size) labels.push(String(labels.length));
    }
    if (bf.validationExpr !== undefined && ctx.calc(bf.validationExpr) === 0) continue;
    const buf = pages.get(bf.page);
    if (!buf) continue;
    const v = readBits(buf, { ...bf, bitOfs: 0 });
    if (v < labels.length && labels[v] === 'INVALID') {
      invalid++;
      invalidHtml += `<b>${bf.name}</b> has INVALID value (${v}) <br>${dialogLine(bf.name)}<br><br>`;
    } else if (v >= labels.length) {
      if (!dialogsUsing(cfg, bf.name).length) unusedHtml += `Unused symbol: <b>${bf.name}</b>, value of the symbol is ${v}<br><br>`;
      else invalidHtml += `<b>${bf.name}</b> is not in the allowed range<br>Current value is ${v}, allowed range is: 0 - ${labels.length - 1} <br>${dialogLine(bf.name)}<br><br>`;
    }
  }
  const messages: ValidationMessage[] = [];
  if (invalid)
    messages.push({ severity: 'error', key: 'Invalid values', message: 'Invalid values', detail: `<font size='+2'><b>Following symbols have invalid values</b></font><br><br>${invalidHtml}` });
  // checkInvalidBits also builds two "Symbol bits check" messages (unused symbols, INI label
  // gaps), but VemsTune's list does not show them: with the v3 1.2.34 INI (unlabelled bits
  // such as pps_input) the real sanity-check window had no such row. Kept as diagnostics.
  const diagnostics: ValidationMessage[] = [];
  if (unusedHtml)
    diagnostics.push({ severity: 'warning', key: 'Symbol bits check', message: 'Symbol bits check', detail: `<font size='+2'><b>None of the following symbols are used in any dialog</b></font><br><br>${unusedHtml}${iniText}<br><br>` });
  if (iniText)
    diagnostics.push({ severity: 'warning', key: 'Symbol bits check', message: 'Symbol bits check', detail: `<font size='+2'><b>Check INI file</b></font><br><br>${iniText}<br><br>` });
  return { invalid, messages, diagnostics };
}
