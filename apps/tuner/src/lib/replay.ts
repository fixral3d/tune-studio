import type { RtSample } from './realtime';

export interface ReplayState {
  index: number;
  count: number;
  playing: boolean;
  speed: number;
  repeat: boolean;
  /** seconds from the first sample */
  t: number;
  total: number;
}

/**
 * Log replay (LOG-03, FilePlayCommander/ThreadLogPlayer): emits a .vemslog's realtime samples
 * with their RT_TIME spacing divided by `speed`, through the same subscribe() API as the live
 * RealtimeFeed. `pages` is the log's own config snapshot, so computed channels decode like they
 * did on the car.
 */
export class ReplayFeed {
  private listeners = new Set<(s: RtSample) => void>();
  private timer?: ReturnType<typeof setTimeout>;
  index = 0;
  playing = false;
  speed = 1;
  repeat = false;
  onState?: (s: ReplayState) => void;

  constructor(
    readonly samples: RtSample[],
    readonly pages?: Map<number, Uint8Array>,
    readonly name = '',
  ) {}

  subscribe(fn: (s: RtSample) => void): () => void {
    this.listeners.add(fn);
    if (this.samples[this.index]) fn(this.samples[this.index]!);
    return () => this.listeners.delete(fn);
  }

  state(): ReplayState {
    const t0 = this.samples[0]?.ms ?? 0;
    return {
      index: this.index,
      count: this.samples.length,
      playing: this.playing,
      speed: this.speed,
      repeat: this.repeat,
      t: ((this.samples[this.index]?.ms ?? t0) - t0) / 1000,
      total: ((this.samples.at(-1)?.ms ?? t0) - t0) / 1000,
    };
  }

  private emit() {
    const s = this.samples[this.index];
    if (s) for (const fn of this.listeners) fn(s);
    this.onState?.(this.state());
  }

  private schedule() {
    clearTimeout(this.timer);
    if (!this.playing) return;
    const cur = this.samples[this.index];
    const next = this.samples[this.index + 1];
    if (!cur) return;
    if (!next) {
      if (this.repeat && this.samples.length > 1) {
        this.timer = setTimeout(() => this.seek(0, true), 100 / this.speed);
      } else {
        this.playing = false;
        this.onState?.(this.state());
      }
      return;
    }
    const dt = Math.max(1, (next.ms - cur.ms) / this.speed);
    this.timer = setTimeout(() => {
      this.index++;
      this.emit();
      this.schedule();
    }, Math.min(dt, 5000));
  }

  play() {
    if (this.index >= this.samples.length - 1) this.index = 0;
    this.playing = true;
    this.emit();
    this.schedule();
  }

  pause() {
    this.playing = false;
    clearTimeout(this.timer);
    this.onState?.(this.state());
  }

  stop() {
    this.pause();
    this.seek(0);
  }

  seek(i: number, keepPlaying = this.playing) {
    this.index = Math.max(0, Math.min(this.samples.length - 1, i));
    this.playing = keepPlaying;
    this.emit();
    this.schedule();
  }

  setSpeed(x: number) {
    this.speed = x;
    this.schedule();
    this.onState?.(this.state());
  }

  setRepeat(r: boolean) {
    this.repeat = r;
    this.onState?.(this.state());
  }

  dispose() {
    clearTimeout(this.timer);
    this.listeners.clear();
  }
}
