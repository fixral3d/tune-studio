import type { SerialTransport } from '@vems/core';

/** SerialTransport over the WebSerial API (Chromium). For real ECU connections. */
export class WebSerialTransport implements SerialTransport {
  private port: SerialPort | undefined;
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  private listeners = new Set<(d: Uint8Array) => void>();
  private _open = false;
  constructor(private baudRate = 19200) {}

  get isOpen() {
    return this._open;
  }

  /** Prompt for a port (once) and open it at `baud` (defaults to the ctor baud). */
  async open(baud = this.baudRate): Promise<void> {
    if (!('serial' in navigator)) throw new Error('WebSerial not supported in this browser');
    this.port = await navigator.serial.requestPort();
    await this.openPort(baud);
  }

  /** Reopen the already-selected port (optionally at a new baud; used for baud auto-detect and to
   *  re-acquire a device that dropped + re-enumerated its USB, e.g. after a firmware flash). */
  async reopen(baud: number = this.baudRate): Promise<void> {
    if (!this.port) throw new Error('port not selected');
    await this.closePort();
    await this.openPort(baud);
  }

  private async openPort(baud: number): Promise<void> {
    this.baudRate = baud;
    await this.port!.open({ baudRate: baud });
    // Assert DTR/RTS — VemsTune raises DTR on connect; some FTDI cables need it.
    const sp = this.port! as SerialPort & {
      setSignals?: (s: { dataTerminalReady?: boolean; requestToSend?: boolean }) => Promise<void>;
    };
    try {
      await sp.setSignals?.({ dataTerminalReady: true, requestToSend: true });
    } catch {
      /* not all platforms expose setSignals */
    }
    this._open = true;
    this.writer = this.port!.writable!.getWriter();
    this.reader = this.port!.readable!.getReader();
    void this.readLoop();
  }

  private async readLoop(): Promise<void> {
    try {
      while (this._open && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) for (const cb of this.listeners) cb(value);
      }
    } catch {
      /* closed */
    }
  }

  /** Tear down streams and close the port, but keep the selected `port` for reopen. */
  private async closePort(): Promise<void> {
    this._open = false;
    try {
      await this.reader?.cancel();
      this.reader?.releaseLock();
      this.writer?.releaseLock();
      await this.port?.close();
    } catch {
      /* ignore */
    }
    this.reader = undefined;
    this.writer = undefined;
  }

  async close(): Promise<void> {
    await this.closePort();
    this.port = undefined;
  }

  async write(data: Uint8Array): Promise<void> {
    await this.writer?.write(data);
  }

  async setBaudRate(baud: number): Promise<void> {
    await this.reopen(baud);
  }

  onData(cb: (data: Uint8Array) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
