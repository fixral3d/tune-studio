/**
 * TF stop-and-wait request/response engine (PROTOCOL.md §4.4).
 * One request in flight; response matched by type = request − 0x80.
 * Unsolicited frames (type ≤ 0x61 except 0x20, and 0x7C) are emitted as events.
 * 0x7F error frames fail the pending request (CRC-error subtype retries).
 */
import type { SerialTransport } from '../transport/serial.js';
import { encodeTf, responseType, TfParser, type TfBuildOptions, type TfFrame } from './frame.js';

export interface TfRequestOptions extends TfBuildOptions {
  timeoutMs?: number; // default 1000 (§4.4)
  retries?: number; // default 0
}

export interface TfSessionEvents {
  onUnsolicited?: (f: TfFrame) => void;
  onError?: (err: Error) => void;
}

interface Pending {
  reqType: number;
  resolve: (f: TfFrame) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  retriesLeft: number;
  wire: Uint8Array;
  timeoutMs: number;
}

export class TfSession {
  private parser = new TfParser();
  private pending: Pending | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private transport: SerialTransport,
    private events: TfSessionEvents = {},
  ) {}

  start(): void {
    this.unsubscribe = this.transport.onData((data) => {
      for (const f of this.parser.feedAll(data)) this.onFrame(f);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = undefined;
    }
    const q = this.queue;
    this.queue = [];
    for (const item of q) item.reject(new Error('session stopped'));
  }

  private onFrame(f: TfFrame): void {
    const t = f.type;
    const unsolicited = (t <= 0x61 && t !== 0x20) || t === 0x7c;
    if (unsolicited && (!this.pending || responseType(this.pending.reqType) !== t)) {
      this.events.onUnsolicited?.(f);
      return;
    }
    const p = this.pending;
    if (!p) {
      this.events.onUnsolicited?.(f);
      return;
    }
    if (!f.crcOk) {
      this.retryOrFail(p, new Error('rx CRC error'));
      return;
    }
    if (t === 0x7f) {
      // error frame: CRC-error subtype (body[n-2]==2) → retry, else fail
      const n = f.body.length;
      const isCrcErr = n >= 2 && f.body[n - 2] === 2;
      if (isCrcErr) this.retryOrFail(p, new Error('ECU reported CRC error'));
      else {
        clearTimeout(p.timer);
        this.pending = undefined;
        p.reject(new Error(`TF error frame 0x${[...f.body].map((b) => b.toString(16)).join('')}`));
      }
      return;
    }
    if (t === responseType(p.reqType)) {
      clearTimeout(p.timer);
      this.pending = undefined;
      p.resolve(f);
    } else {
      this.events.onUnsolicited?.(f);
    }
  }

  private retryOrFail(p: Pending, err: Error): void {
    clearTimeout(p.timer);
    if (p.retriesLeft > 0) {
      p.retriesLeft--;
      void this.transport.write(p.wire);
      p.timer = setTimeout(() => this.retryOrFail(p, new Error('timeout')), p.timeoutMs);
    } else {
      this.pending = undefined;
      p.reject(err);
    }
  }

  /** Queued requests waiting for the single in-flight slot (SafeQueue analogue). */
  private queue: { opts: TfRequestOptions; resolve: (f: TfFrame) => void; reject: (e: Error) => void }[] = [];

  /** Send a request; if one is in flight, queue it (stop-and-wait, serialized). */
  /** Write a frame now without a pending entry (trigger-log enable is sent like this, PROTOCOL §7.4.1). */
  send(opts: TfRequestOptions): void {
    void this.transport.write(encodeTf(opts));
  }

  request(opts: TfRequestOptions): Promise<TfFrame> {
    return new Promise<TfFrame>((resolve, reject) => {
      this.queue.push({ opts, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.pending || this.queue.length === 0) return;
    const { opts, resolve, reject } = this.queue.shift()!;
    const wire = encodeTf(opts);
    const timeoutMs = opts.timeoutMs ?? 1000;
    const p: Pending = {
      reqType: opts.type,
      resolve: (f) => {
        resolve(f);
        this.pump();
      },
      reject: (e) => {
        reject(e);
        this.pump();
      },
      retriesLeft: opts.retries ?? 0,
      wire,
      timeoutMs,
      timer: setTimeout(() => this.retryOrFail(p, new Error('request timeout')), timeoutMs),
    };
    this.pending = p;
    void this.transport.write(wire);
  }
}
