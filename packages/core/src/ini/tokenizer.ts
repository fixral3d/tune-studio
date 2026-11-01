/**
 * VemsTune INI tokenizer (Tokenizer::tokenize @0x4e2fcc, INI-DIALECT.md §2.3).
 * Position-based: commas and '=' are pure separators (optional); many stray
 * characters are silently dropped; '%'-prefixed lines are active.
 */
export const enum TokType {
  Hash = 0,
  Ident = 1,
  Number = 2,
  String = 3,
  Bracket = 4, // [...]
  Expr = 5, // {...}
  Colon = 6,
}

export interface Token {
  type: TokType;
  text: string;
}

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\v' || c === '\f';
const isAlpha = (c: string) => /[A-Za-z]/.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';

export function tokenize(line: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i]!;
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === ';') break; // comment to end of line (outside string/[]/{})
    if (c === ',' || c === '=') {
      i++;
      continue;
    }
    if (c === ':') {
      out.push({ type: TokType.Colon, text: ':' });
      i++;
      continue;
    }
    if (c === '#') {
      out.push({ type: TokType.Hash, text: '#' });
      i++;
      // rest of line split by whitespace only; each word raw type-1 (quotes kept)
      while (i < n) {
        while (i < n && isSpace(line[i]!)) i++;
        if (i >= n) break;
        let j = i;
        while (j < n && !isSpace(line[j]!)) j++;
        out.push({ type: TokType.Ident, text: line.slice(i, j) });
        i = j;
      }
      break;
    }
    if (isAlpha(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(line[j]!)) j++;
      out.push({ type: TokType.Ident, text: line.slice(i, j) });
      i = j;
      continue;
    }
    if (isDigit(c) || c === '-') {
      let j = i + 1;
      while (j < n && (isDigit(line[j]!) || line[j] === '.')) j++;
      out.push({ type: TokType.Number, text: line.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && line[j] !== '"') j++;
      out.push({ type: TokType.String, text: line.slice(i + 1, j) });
      i = j < n ? j + 1 : j;
      continue;
    }
    if (c === '[') {
      let j = i + 1;
      while (j < n && line[j] !== ']') j++;
      out.push({ type: TokType.Bracket, text: line.slice(i + 1, j) });
      i = j < n ? j + 1 : j;
      continue;
    }
    if (c === '{') {
      let j = i + 1;
      while (j < n && line[j] !== '}') j++;
      out.push({ type: TokType.Expr, text: line.slice(i + 1, j) });
      i = j < n ? j + 1 : j;
      continue;
    }
    i++; // silently skip everything else ( } ] ( ) ! $ % / . + * & | _ BOM non-ASCII )
  }
  return out;
}

export const tokInt = (t: Token | undefined): number => {
  if (!t) return 0;
  const v = parseFloat(t.text);
  return Number.isFinite(v) ? Math.trunc(v) : 0;
};
export const tokNum = (t: Token | undefined): number => {
  if (!t) return 0;
  const v = parseFloat(t.text);
  return Number.isFinite(v) ? v : 0;
};
export const tokText = (t: Token | undefined): string => t?.text ?? '';
