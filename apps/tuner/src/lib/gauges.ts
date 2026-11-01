import { useEffect, useState } from 'react';
import { ConfigEvaluator, type VemsConfig } from '@vems/core';
import type { RealtimeFeed } from './realtime';

/** Live ECU feed or a log replay (which also carries the log's config pages). */
export type RtSource = Pick<RealtimeFeed, 'subscribe'> & { pages?: Map<number, Uint8Array> };

/** VemsTune GaugeDescriptors.xml entry (exported by re/tools/export_gauges.py). */
export interface GaugeDesc {
  name: string;
  channel: string;
  unit: string;
  lo: number;
  hi: number;
  major: number;
  minor: number;
  /** degrees, 0 = 3 o'clock, clockwise (VemsTune: 135 → 405) */
  start: number;
  end: number;
  digits: number;
  labelDigits: number;
  areas: { min: number; max: number; color: string }[];
}
export interface FlagDesc {
  name: string;
  states: { value: number; text: string; fg: string; bg: string }[];
}
export interface GaugeTheme {
  name: string;
  text: string;
  pointer: string;
  border: string;
  div: string;
  colors: Record<string, string>;
}
export interface GaugeDb {
  default: string;
  gauges: GaugeDesc[];
  flags: FlagDesc[];
  themes: GaugeTheme[];
}

let dbPromise: Promise<GaugeDb> | undefined;
export function loadGaugeDb(): Promise<GaugeDb> {
  dbPromise ??= fetch(`${import.meta.env.BASE_URL}config/gauges.json`).then((r) => {
    if (!r.ok) throw new Error(`gauges.json: HTTP ${r.status}`);
    return r.json() as Promise<GaugeDb>;
  });
  return dbPromise;
}

export function useGaugeDb(): GaugeDb | undefined {
  const [db, setDb] = useState<GaugeDb>();
  useEffect(() => {
    void loadGaugeDb().then(setDb);
  }, []);
  return db;
}

export interface ChannelSnapshot {
  values: Record<string, number>;
  /** last `historyLen` samples per channel, oldest first */
  hist: Record<string, number[]>;
}

/** Evaluates the named output channels on every realtime frame (live ECU or replay). */
export function useChannels(
  feed: RtSource | undefined,
  config: VemsConfig | undefined,
  names: string[],
  historyLen = 300,
): ChannelSnapshot {
  const [snap, setSnap] = useState<ChannelSnapshot>({ values: {}, hist: {} });
  const key = [...new Set(names)].join(',');
  useEffect(() => {
    setSnap({ values: {}, hist: {} });
    if (!feed || !config || !key) return;
    const ev = new ConfigEvaluator(config);
    const list = key.split(',');
    const hist: Record<string, number[]> = {};
    return feed.subscribe(({ data }) => {
      try {
        ev.reset({ realtime: data, pages: feed.pages, extra: { time: Date.now() / 1000 } });
      } catch {
        return;
      }
      const values: Record<string, number> = {};
      for (const n of list) {
        try {
          const v = ev.value(n);
          if (v === undefined || !Number.isFinite(v)) continue;
          values[n] = v;
          const h = (hist[n] ??= []);
          h.push(v);
          if (h.length > historyLen) h.shift();
        } catch {
          /* channel not evaluable for this firmware */
        }
      }
      setSnap({ values, hist: { ...hist } });
    });
  }, [feed, config, key, historyLen]);
  return snap;
}
