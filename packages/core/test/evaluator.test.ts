import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigEvaluator, loadConfig } from '../src/index.js';

const CFG = join(__dirname, '../../../re/target/vemstune-1.5.46/config');
const resolveInclude = (p: string) => {
  try {
    return readFileSync(join(CFG, p), 'latin1');
  } catch {
    return undefined;
  }
};
const cfg = loadConfig(readFileSync(join(CFG, 'vemsTune-v3-1.2.34.ini'), 'latin1'), 'vemsTune-v3-1.2.34.ini', {
  defines: new Set(['USE_RAW_LAMBDA_TABLE']),
  resolveInclude,
});

describe('ConfigEvaluator against real 1.2.34 config', () => {
  it('evaluates scalar realtime channels from a realtime block', () => {
    const rt = new Uint8Array(80);
    // secl is at output-channel offset 0 (scale 1), engine bits etc.
    rt[0] = 42;
    const ev = new ConfigEvaluator(cfg, { realtime: rt });
    expect(ev.value('secl')).toBe(42);
  });

  it('evaluates a large fraction of realtime channels without throwing', () => {
    const rt = new Uint8Array(256).fill(80);
    const ev = new ConfigEvaluator(cfg, { realtime: rt, extra: { time: 0 } });
    const all = ev.allRealtime();
    // thousands of channels exist; most computed ones should resolve given a full block
    expect(Object.keys(all).length).toBeGreaterThan(100);
  });

  it('handles forward references and Hidden-channel deps lazily', () => {
    const rt = new Uint8Array(256).fill(10);
    const ev = new ConfigEvaluator(cfg, { realtime: rt });
    // pick any computed channel referencing another; just ensure no crash & memoized
    ev.reset({ realtime: rt });
    expect(() => ev.allRealtime()).not.toThrow();
  });

  it('reads a VE table array via getArray', () => {
    const pages = new Map([[2, new Uint8Array(512).fill(90)]]);
    const ev = new ConfigEvaluator(cfg, { pages });
    const ve = ev.getArray('veTable');
    expect(ve).toHaveLength(16 * 14);
    expect(ve!.every((v) => v === 90)).toBe(true);
  });
});
