/**
 * Serial transport abstraction shared by the client and the emulator.
 * Concrete implementations: node-serialport (desktop), WebSerial (browser),
 * or an in-memory pipe for tests / emulator wiring.
 */
export interface SerialOptions {
  baudRate: number;
}

export interface SerialTransport {
  open(): Promise<void>;
  close(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  /** Register a listener for inbound bytes. Returns an unsubscribe fn. */
  onData(cb: (data: Uint8Array) => void): () => void;
  readonly isOpen: boolean;
  setBaudRate(baud: number): Promise<void>;
}

/** Two linked in-memory endpoints (A↔B). Used to wire client ↔ emulator in tests. */
export class MemoryPipe {
  readonly a: MemoryEndpoint;
  readonly b: MemoryEndpoint;
  constructor(baudRate = 19200) {
    this.a = new MemoryEndpoint(baudRate);
    this.b = new MemoryEndpoint(baudRate);
    this.a._peer = this.b;
    this.b._peer = this.a;
  }
}

export class MemoryEndpoint implements SerialTransport {
  /** @internal */ _peer!: MemoryEndpoint;
  private listeners = new Set<(d: Uint8Array) => void>();
  private _open = false;
  private baud: number;
  constructor(baudRate: number) {
    this.baud = baudRate;
  }
  get isOpen(): boolean {
    return this._open;
  }
  async open(): Promise<void> {
    this._open = true;
  }
  async close(): Promise<void> {
    this._open = false;
  }
  async setBaudRate(baud: number): Promise<void> {
    this.baud = baud;
  }
  async write(data: Uint8Array): Promise<void> {
    if (!this._open) throw new Error('endpoint closed');
    const copy = data.slice();
    queueMicrotask(() => {
      if (this._peer._open) for (const cb of this._peer.listeners) cb(copy);
    });
  }
  onData(cb: (data: Uint8Array) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
