/**
 * High-level VEMS client over a TF session (PROTOCOL.md §4.5).
 * Covers the minimum connect/read/write set; realtime and page semantics
 * are driven by the SIPR descriptor (page → ecuPageId / sizes).
 */
import type { SerialTransport } from '../transport/serial.js';
import { TfSession, type TfSessionEvents } from './session.js';

export interface FirmwareDetails {
  serialNumber?: string;
  compilationTime?: string;
  signature?: string;
  mtCodeVer?: string;
  /** firmware version parsed from the signature (sub 4), e.g. "1.1.98". */
  version?: string;
}

const dec = new TextDecoder('latin1');
const bodyText = (body: Uint8Array) => dec.decode(body.subarray(0, body.length - 2)); // drop [sub][type]

export class VemsClient {
  private session: TfSession;
  /** RAM holds writes that are not yet burned to flash (VemsTune's red Burn button). */
  unburned = false;
  /** Called whenever `unburned` changes. */
  onUnburnedChange?: (unburned: boolean) => void;

  private setUnburned(v: boolean): void {
    if (this.unburned === v) return;
    this.unburned = v;
    this.onUnburnedChange?.(v);
  }

  constructor(
    private transport: SerialTransport,
    events: TfSessionEvents = {},
  ) {
    this.session = new TfSession(transport, events);
  }

  start(): void {
    this.session.start();
  }
  stop(): void {
    this.session.stop();
  }

  /** READ_ECU_DETAILS (0xF2) subs 3,2,5,4 — the order VemsTune uses. */
  async readDetails(): Promise<FirmwareDetails> {
    const out: FirmwareDetails = {};
    for (const sub of [3, 2, 5, 4] as const) {
      const f = await this.session.request({ type: 0xf2, subtype: sub, timeoutMs: 1000, retries: 1 });
      const text = bodyText(f.body);
      if (sub === 3) out.serialNumber = text;
      else if (sub === 2) out.compilationTime = text;
      else if (sub === 5) out.mtCodeVer = text;
      else {
        out.signature = text;
        out.version = /(\d\.\d\.(?:\d{2}|\d))/.exec(text)?.[1];
      }
    }
    return out;
  }

  /** SRAM page read (0xF4): address 0xFF00|ecuId. Returns the page bytes. */
  async readPage(ecuId: number): Promise<Uint8Array> {
    const f = await this.session.request({ type: 0xf4, value: 0xff00 | ecuId, timeoutMs: 1000, retries: 1 });
    // response body: data[0..L) [addrHi][addrLo] type(0x74)
    return f.body.subarray(0, f.body.length - 3).slice();
  }

  /** EEPROM read (0xF5) at block index (CONFIG_EEPROM uses idx 0x0C). */
  async readEeprom(idx = 0x0c): Promise<Uint8Array> {
    const f = await this.session.request({ type: 0xf5, value: idx, timeoutMs: 1000, retries: 1 });
    return f.body.subarray(0, f.body.length - 2).slice();
  }

  /** READ_REALTIME (0xA0). Returns the realtime block (byte 0 = secl). */
  async readRealtime(): Promise<Uint8Array> {
    const f = await this.session.request({ type: 0xa0, timeoutMs: 1000, retries: 1 });
    return f.body.subarray(0, f.body.length - 1).slice();
  }

  /** SRAM write (0xFB): one byte at (ecuId page, offset). */
  async writeByte(ecuId: number, offset: number, value: number): Promise<void> {
    let addr = 0xff00 | ecuId;
    let offLo = offset;
    if (offset > 0xff) {
      offLo = offset - 0x100;
      addr &= 0x7fff;
    }
    const data = Uint8Array.of(value & 0xff, offLo & 0xff);
    await this.session.request({ type: 0xfb, value: addr, data, timeoutMs: 1000 });
    this.setUnburned(true);
  }

  /**
   * TEST_TOOLS (0xF7): body [param] [sub] F7, the TF form of the "Manmd<letter><hex>bye" string commands
   * (sub 1 h DIGITALOUT, 2 n IGNDWELL, 3 e ENA_FLAGS, 4 d DIS_FLAGS, 5 a FORCE_ADV, 6 i FORCE_IAC).
   */
  async testTool(sub: number, param: number): Promise<void> {
    await this.session.request({ type: 0xf7, data: Uint8Array.of(param & 0xff), subtype: sub, timeoutMs: 1000 });
  }

  /** Trigger log on (`40 03 F7`, not waited for — the ECU starts streaming trigger frames instead). */
  startTriggerLog(): void {
    this.session.send({ type: 0xf7, data: Uint8Array.of(0x40), subtype: 3 });
  }

  /** Trigger log off (`00 03 F7` → `00 03 77`). */
  async stopTriggerLog(): Promise<void> {
    await this.testTool(3, 0x00);
  }

  /** Raw bytes from the ECU (a .triggerlog stores the stream as received). */
  onRawData(fn: (bytes: Uint8Array) => void): () => void {
    return this.transport.onData(fn);
  }

  /** Burn (0xEF 04) then poll (0xEF 03) until status byte == 1. */
  async burn(maxPolls = 20): Promise<void> {
    const f = await this.session.request({ type: 0xef, data: Uint8Array.of(0x04), timeoutMs: 2000 });
    if (f.body[0] === 1) return this.setUnburned(false);
    for (let i = 0; i < maxPolls; i++) {
      const p = await this.session.request({ type: 0xef, data: Uint8Array.of(0x03), timeoutMs: 1000 });
      if (p.body[0] === 1) return this.setUnburned(false);
    }
    throw new Error('burn did not complete');
  }
}
