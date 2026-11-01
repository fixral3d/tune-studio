/**
 * ConfigCriteria.xml parser (ConfigCriteriaParser @0x4c769c): derived <Variables>,
 * <Validate> rules, <ReplaceRules> (old symbol name → expression over current INI names)
 * and <FwRules> (config migration on firmware upgrade; not part of the sanity check).
 * The file's schema is fixed and flat, so a small tag scanner is enough — no DOM needed
 * (the core runs in Node and the browser).
 */

export type CriteriaItemType = 'ok' | 'warning' | 'error';

export interface CriteriaItem {
  type: CriteriaItemType;
  expr: string;
}

export interface CriteriaRule {
  key: string;
  warningMsg?: string;
  errorMsg?: string;
  minfw?: string;
  maxfw?: string;
  /** symbols the rule depends on (comma separated in the file). */
  iniSymbols: string[];
  items: CriteriaItem[];
  /** HTML detail text, may contain $MENU_LINK. */
  detail?: string;
}

/** <FwRules><Item fw="V"><Rule key="SYM"><Upgrade>expr</Upgrade> — config migration buckets. */
export interface FwRuleBucket {
  fw: string;
  rules: { key: string; expr: string }[];
}

export interface ConfigCriteria {
  variables: { key: string; expr: string }[];
  replace: { key: string; expr: string }[];
  rules: CriteriaRule[];
  fwRules: FwRuleBucket[];
}

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Content of the element's FIRST child node, as VemsTune reads it: the XML is loaded with
 * whitespace nodes kept, so `<Item> <![CDATA[ x ]]>` yields the blank text node " ", not x
 * (ConfigCriteria.xml `cranking_thres`). Blank results come back as ''.
 */
const textOf = (inner: string) => {
  const cdataAt = inner.indexOf('<![CDATA[');
  if (cdataAt > 0) return decode(inner.slice(0, cdataAt)).trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>/.exec(inner);
  return (cdata ? cdata[1]! : decode(inner)).trim();
};

const attrs = (s: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) out[m[1]!] = decode(m[2]!);
  return out;
};

/** Contents of the first <tag>…</tag> block (non-nested tags only). */
const block = (xml: string, tag: string) => new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1] ?? '';

/** Every <Item key="…">expr</Item> in a block. */
const keyedItems = (xml: string) =>
  [...xml.matchAll(/<Item\b([^>]*)>([\s\S]*?)<\/Item>/g)]
    .map((m) => ({ key: attrs(m[1]!).key ?? '', expr: textOf(m[2]!) }))
    .filter((i) => i.key);

export function parseConfigCriteria(xmlText: string): ConfigCriteria {
  // drop comments first: several rules are disabled with <!-- … -->
  const xml = xmlText.replace(/<!--[\s\S]*?-->/g, '');
  const rules: CriteriaRule[] = [];
  for (const m of block(xml, 'Validate').matchAll(/<Rule\b([^>]*)>([\s\S]*?)<\/Rule>/g)) {
    const a = attrs(m[1]!);
    const body = m[2]!;
    const items: CriteriaItem[] = [];
    for (const it of body.matchAll(/<Item\b([^>]*)>([\s\S]*?)<\/Item>/g)) {
      const type = attrs(it[1]!).type as CriteriaItemType | undefined;
      if (type === 'ok' || type === 'warning' || type === 'error') items.push({ type, expr: textOf(it[2]!) });
    }
    const detail = /<ErrorDetail>([\s\S]*?)<\/ErrorDetail>/.exec(body);
    rules.push({
      key: a.key ?? '',
      warningMsg: a.warningMsg,
      errorMsg: a.errorMsg,
      minfw: a.minfw,
      maxfw: a.maxfw,
      iniSymbols: (a.inisymbols ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      items,
      detail: detail ? textOf(detail[1]!) : undefined,
    });
  }
  const fwRules: FwRuleBucket[] = [];
  for (const it of block(xml, 'FwRules').matchAll(/<Item\b([^>]*)>([\s\S]*?)<\/Item>/g)) {
    const fw = attrs(it[1]!).fw;
    if (!fw) continue;
    const bucketRules = [...it[2]!.matchAll(/<Rule\b([^>]*)>([\s\S]*?)<\/Rule>/g)]
      .map((r) => ({ key: attrs(r[1]!).key ?? '', expr: textOf(/<Upgrade>([\s\S]*?)<\/Upgrade>/.exec(r[2]!)?.[1] ?? '') }))
      .filter((r) => r.key);
    fwRules.push({ fw, rules: bucketRules });
  }
  return {
    variables: keyedItems(block(xml, 'Variables')),
    replace: keyedItems(block(xml, 'ReplaceRules')),
    rules,
    fwRules,
  };
}
