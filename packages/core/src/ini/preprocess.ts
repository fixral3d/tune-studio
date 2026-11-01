/**
 * INI preprocessor + section splitter (INI-DIALECT.md §2.2, §3).
 * Resolves #include (config-root-relative) and #if/#else/#endif (single
 * upper-cased name, unknown=false; #include always followed even in an
 * inactive branch; bracket section headers switch section even when inactive).
 *
 * Returns the active lines grouped by section, each with source location.
 */
import { TokType, tokenize, type Token } from './tokenizer.js';

export interface IniLine {
  tokens: Token[];
  section: string;
  file: string;
  lineNo: number; // 1-based
}

export interface PreprocessOptions {
  /** condition names that are true (from project params / [Params] / defaults). */
  defines: Set<string>;
  /** resolve an include path (relative to config root) to its text, or undefined. */
  resolveInclude?: (path: string) => string | undefined;
  /** firmware version symbols fw_major/fw_minor/fw_build (added as expr vars). */
}

const DIRECTIVES = new Set(['include', 'if', 'else', 'endif']);

export function preprocess(text: string, file: string, opts: PreprocessOptions): IniLine[] {
  const out: IniLine[] = [];
  const defines = opts.defines;

  function run(text: string, file: string, state: { section: string }, condStack: boolean[]): void {
    const active = () => condStack.every(Boolean);
    const lines = text.split(/\r?\n/);
    for (let ln = 0; ln < lines.length; ln++) {
      const toks = tokenize(lines[ln]!.replace(/^\s+/, ''));
      if (toks.length === 0) continue;

      // directive detection looks at token[1] text (token[0] is '#')
      const t0 = toks[0]!;
      const t1 = toks[1];
      if (t0.type === TokType.Hash && t1 && DIRECTIVES.has(t1.text)) {
        const dir = t1.text;
        if (dir === 'if') {
          const name = (toks[2]?.text ?? '').toUpperCase();
          condStack.push(defines.has(name));
        } else if (dir === 'else') {
          if (condStack.length) condStack[condStack.length - 1] = !condStack[condStack.length - 1];
        } else if (dir === 'endif') {
          condStack.pop();
        } else if (dir === 'include') {
          // always processed, even in an inactive branch
          const path = toks[2]?.text?.replace(/^"/, '').replace(/"$/, '') ?? '';
          const inc = opts.resolveInclude?.(path);
          if (inc !== undefined) run(inc, path, state, condStack);
        }
        continue;
      }

      // bracket section header switches section even when inactive
      if (t0.type === TokType.Bracket) {
        state.section = t0.text;
        continue;
      }

      if (!active()) continue;
      out.push({ tokens: toks, section: state.section, file, lineNo: ln + 1 });
    }
  }

  run(text, file, { section: '' }, []);
  return out;
}

/** Built-in default condition table (used only when no project params). */
export const DEFAULT_DEFINES = (): Set<string> => new Set(['12X12', 'HIGHBOOST', 'CELSIUS']);
