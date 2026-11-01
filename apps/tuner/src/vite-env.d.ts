/// <reference types="vite/client" />

// Minimal WebSerial ambient types (Chromium) for strict TS.
interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface Serial {
  requestPort(): Promise<SerialPort>;
}
interface Navigator {
  serial: Serial;
}
