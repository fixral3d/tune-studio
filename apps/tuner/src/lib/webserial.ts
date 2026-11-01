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

  async open(): Promise<void> {
    if (!('serial' in navigator)) throw new Error('WebSerial not supported in this browser');
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: this.baudRate });
    this._open = true;
    this.writer = this.port.writable!.getWriter();
    this.reader = this.port.readable!.getReader();
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

  async close(): Promise<void> {
    this._open = false;
    try {
      await this.reader?.cancel();
      this.reader?.releaseLock();
      this.writer?.releaseLock();
      await this.port?.close();
    } catch {
      /* ignore */
    }
  }

  async write(data: Uint8Array): Promise<void> {
    await this.writer?.write(data);
  }

  async setBaudRate(baud: number): Promise<void> {
    this.baudRate = baud;
    // WebSerial needs reopen to change baud; left to caller.
  }

  onData(cb: (data: Uint8Array) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
