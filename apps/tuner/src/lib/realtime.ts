import { readAllPages, type VemsClient, type VemsConfig } from '@vems/core';

export interface RtSample {
  /** ms since the feed started (RT_TIME semantics). */
  ms: number;
  data: Uint8Array;
}
type Listener = (s: RtSample) => void;

/**
 * One realtime poll loop per connection (RealtimeHandler analogue) that fans out
 * to gauges and the logger, and keeps an in-memory history (LogHistoryMgr, LOG-04).
 */
export class RealtimeFeed {
  readonly history: RtSample[] = [];
  /**
   * ECU config pages keyed by INI page (readAllPages shape), so computed channels evaluate
   * against the real config like a replay does. Filled by loadPages(); editors mirror writes.
   */
  readonly pages = new Map<number, Uint8Array>();
  private listeners = new Set<Listener>();
  private alive = false;
  /** bumped on every start(), so a loop still awaiting a frame after stop() can't keep running */
  private gen = 0;
  private t0?: number;

  constructor(
    private client: VemsClient,
    private periodMs = 100,
    /** ring buffer size: 1 h at 10 Hz. */
    private maxHistory = 36000,
  ) {}

  start(): void {
    if (this.alive) return;
    this.alive = true;
    // keep the time base across stop()/start() (trigger log pauses realtime): history stays monotonic
    this.t0 ??= performance.now();
    void this.loop(++this.gen);
  }

  stop(): void {
    this.alive = false;
  }

  /** Reads every config page once; the poll loop keeps running (requests share the session queue). */
  async loadPages(cfg: VemsConfig): Promise<void> {
    for (const [vtPage, buf] of await readAllPages(this.client, cfg)) this.pages.set(vtPage, buf);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private async loop(gen: number): Promise<void> {
    const running = () => this.alive && gen === this.gen;
    while (running()) {
      try {
        const data = await this.client.readRealtime();
        if (!running()) break;
        const s = { ms: Math.round(performance.now() - this.t0!), data };
        this.history.push(s);
        if (this.history.length > this.maxHistory) this.history.shift();
        for (const fn of this.listeners) fn(s);
      } catch {
        /* dropped frame */
      }
      await new Promise((r) => setTimeout(r, this.periodMs));
    }
  }
}
