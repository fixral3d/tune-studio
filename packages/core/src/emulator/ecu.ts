/**
 * Minimal V3 (fw >= 1.1.98) TriggerFrame ECU emulator — enough for VemsTune /
 * our client to connect, read details, read/write pages, poll realtime and burn.
 * Response layouts per PROTOCOL.md §4.5. Not cycle-accurate; for protocol
 * validation over a MemoryPipe (and later com0com against real VemsTune).
 */
import type { SerialTransport } from '../transport/serial.js';
import { encodeTfBody, TfParser, type TfFrame } from '../tf/frame.js';
import { BootloaderEmulator } from './bootloader.js';
import { encodeTriggerFrame } from '../log/triggerlog.js';

/** Simulated crank/cam wheel for the trigger log (TEST_TOOLS ENA_FLAGS 0x40). */
export interface TriggerWheel {
  teeth: number;
  missing: number;
  /** engine speed; may vary over time (seconds since the log started) */
  rpm: number | ((sec: number) => number);
  /** primary position (tooth index in the second revolution) of the secondary/cam pulse */
  secondaryTooth?: number;
  /** spark events per revolution (event 8) */
  sparksPerRev?: number;
}

export interface EcuDetails {
  serialNumber: string; // sub 3
  compilationTime: string; // sub 2
  signature: string; // sub 4 (regex yields firmware version)
  mtCodeVer: string; // sub 5 (INI [MegaTune] signature)
}

export interface EcuEmulatorOptions {
  details?: Partial<EcuDetails>;
  /** realtime block, byte 0 is `secl` (auto-incremented per second). */
  realtimeBlock?: Uint8Array;
  /** page store keyed by ecuPageId → bytes. */
  pages?: Map<number, Uint8Array>;
  /** detection probe reply in TF mode: CRC-error frame (default true). */
  answerDetectionProbe?: boolean;
  /** serial the bootloader reports (letter after '_' = boot type, u = UHEX). */
  bootSerial?: string;
  /** start in boot mode instead of the application. */
  bootMode?: boolean;
  /** trigger wheel streamed while the trigger log is on (default 36-1 around 1500 rpm). */
  triggerWheel?: TriggerWheel;
}

const DEFAULT_DETAILS: EcuDetails = {
  serialNumber: 'v3.3_n003361',
  compilationTime: '2011-11-24 15:15',
  signature: 'VEMS Genboard v3, 1.1.98',
  mtCodeVer: 'VEMS v1.1.98 16x14 kpa=2,1',
};

export class EcuEmulator {
  private parser = new TfParser();
  private details: EcuDetails;
  private pages: Map<number, Uint8Array>;
  private rt: Uint8Array;
  private startMs = Date.now();
  private unsub: (() => void) | undefined;
  private answerProbe: boolean;
  /** bootloader + its flash (persists across boot-mode entries, like real flash). */
  readonly bootloader: BootloaderEmulator;
  /** true while the ECU sits in its bootloader (entered via TF F6). */
  inBoot = false;
  /** last TEST_TOOLS (0xF7) param per sub, e.g. 3 (ENA_FLAGS) → 0x02 while WBO2 1 calibrates. */
  readonly testTools = new Map<number, number>();
  private wheel: TriggerWheel;
  private trig?: { timer: ReturnType<typeof setInterval>; tick: number; next: number; pos: number; t0: number };

  constructor(
    private transport: SerialTransport,
    opts: EcuEmulatorOptions = {},
  ) {
    this.details = { ...DEFAULT_DETAILS, ...opts.details };
    this.pages = opts.pages ?? new Map();
    this.rt = opts.realtimeBlock ? opts.realtimeBlock.slice() : new Uint8Array(75);
    this.answerProbe = opts.answerDetectionProbe ?? true;
    this.wheel = opts.triggerWheel ?? { teeth: 36, missing: 1, rpm: (s) => 1500 + 300 * Math.sin(s / 2), secondaryTooth: 5, sparksPerRev: 2 };
    this.bootloader = new BootloaderEmulator({ serial: opts.bootSerial });
    if (opts.bootMode) this.enterBoot();
  }

  start(): void {
    this.unsub = this.transport.onData((data) => this.onBytes(data));
  }
  stop(): void {
    this.stopTrigger();
    this.unsub?.();
  }

  setPage(ecuId: number, bytes: Uint8Array): void {
    this.pages.set(ecuId, bytes.slice());
  }
  /** Replace the realtime block (byte 0 secl is still auto-managed on read). */
  setRealtimeBlock(bytes: Uint8Array): void {
    this.rt = bytes.slice();
  }
  getPage(ecuId: number): Uint8Array | undefined {
    return this.pages.get(ecuId);
  }

  private secl(): number {
    return Math.floor((Date.now() - this.startMs) / 1000) & 0xff;
  }

  enterBoot(): void {
    this.inBoot = true;
    this.bootloader.left = false;
  }

  private onBytes(data: Uint8Array): void {
    if (this.inBoot) {
      const reply = this.bootloader.feed(data);
      if (reply.length) void this.transport.write(reply);
      if (this.bootloader.left) {
        this.inBoot = false;
        this.parser = new TfParser();
      }
      return;
    }
    // detection probe: "Smxc." 0xFF 0x7E ends in 0x7E; its CRC fails → 0x7F frame
    for (const f of this.parser.feedAll(data)) {
      if (!f.crcOk) {
        if (this.answerProbe) this.send(Uint8Array.of(0x02, 0x7f)); // CRC-error reply
        continue;
      }
      this.handle(f);
    }
  }

  private send(body: Uint8Array): void {
    void this.transport.write(encodeTfBody(body));
  }

  private handle(f: TfFrame): void {
    const b = f.body;
    const type = f.type;
    switch (type) {
      case 0xf2: {
        // [sub] F2 → text [sub] 72
        const sub = b[b.length - 2]!;
        const text = this.detailText(sub);
        if (text === undefined) {
          this.send(Uint8Array.of(0x02, 0x04, 0x7f)); // ECU_DETAILS|BAD_SUBTYPE
          return;
        }
        const t = new TextEncoder().encode(text);
        this.send(Uint8Array.of(...t, sub, 0x72));
        return;
      }
      case 0xa0: {
        // A0 → rt[0..N) 20, byte0 = secl
        const rt = this.rt.slice();
        rt[0] = this.secl();
        this.send(Uint8Array.of(...rt, 0x20));
        return;
      }
      case 0xf4: {
        // page read [FF][ecuId] F4 → data [FF][ecuId] 74
        const ecuId = b[1]!;
        const page = this.pages.get(ecuId) ?? new Uint8Array(0);
        this.send(Uint8Array.of(...page, 0xff, ecuId, 0x74));
        return;
      }
      case 0xf5: {
        // EEPROM read [idx] F5 → data [idx] 75
        const idx = b[0]!;
        const page = this.pages.get(0x1e) ?? new Uint8Array(64);
        this.send(Uint8Array.of(...page.subarray(0, 64), idx, 0x75));
        return;
      }
      case 0xfb: {
        // write [value][offset_lo][addrHi][addrLo] FB → [status] [?] 7B
        const value = b[0]!;
        const offLo = b[1]!;
        const addrHi = b[2]!;
        const addrLo = b[3]!;
        const ecuId = addrLo;
        const offset = (addrHi & 0x80) === 0 ? offLo + 0x100 : offLo;
        const page = this.pages.get(ecuId);
        if (page && offset < page.length) page[offset] = value;
        this.send(Uint8Array.of(0x00, 0x00, 0x7b));
        return;
      }
      case 0xef: {
        // burn 04 EF, or poll 03 EF → [status=1] [00] 6F (done)
        this.send(Uint8Array.of(0x01, 0x00, 0x6f));
        return;
      }
      case 0xf7: {
        // TEST_TOOLS [param] [sub] F7 → [param] [sub] 77 (ENA_FLAGS 02/03 = WBO2 calibration mode)
        const param = b[0]!;
        const sub = b[1]!;
        this.testTools.set(sub, param);
        if (sub === 3 && param === 0x40) return this.startTrigger(); // trigger log: stream instead of an answer
        if (sub === 3) this.stopTrigger();
        this.send(Uint8Array.of(param, sub, 0x77));
        return;
      }
      case 0xf6: {
        // GO_BOOTLOADER: no reply, the application jumps into the bootloader
        this.enterBoot();
        return;
      }
      case 0xfc: {
        // change baud [ubrr] FC → ... 7C (emulator stays on same transport)
        this.send(Uint8Array.of(b[0]!, 0x00, 0x7c));
        return;
      }
      default:
        this.send(Uint8Array.of(0x01, 0x7f)); // UNKNOWN_COMMAND
    }
  }

  /** Stream 4 µs-stamped trigger frames every 20 ms (primary teeth, cam pulse, spark events). */
  private startTrigger(): void {
    if (this.trig) return;
    const step = 20;
    const trig = { tick: 0, next: 0, pos: 0, t0: Date.now(), timer: setInterval(() => this.triggerStep(step), step) };
    this.trig = trig;
  }

  private stopTrigger(): void {
    if (this.trig) clearInterval(this.trig.timer);
    this.trig = undefined;
  }

  private triggerStep(stepMs: number): void {
    const tr = this.trig;
    if (!tr) return;
    const w = this.wheel;
    tr.tick += (stepMs * 1000) / 4;
    const prim: number[] = [];
    const flush = () => {
      if (prim.length) this.transport.write(encodeTriggerFrame(0x01, prim.splice(0)));
    };
    while (tr.next <= tr.tick) {
      const rpm = typeof w.rpm === 'number' ? w.rpm : w.rpm((tr.next * 4) / 1e6);
      const period = (60 / rpm / w.teeth) * 250000; // ticks per tooth
      const tooth = tr.pos % w.teeth;
      const at = Math.round(tr.next) & 0xffff;
      if (tooth < w.teeth - w.missing) prim.push(at);
      const sparks = w.sparksPerRev ?? 0;
      const camAt = tr.pos === w.teeth + (w.secondaryTooth ?? 5);
      if (camAt || (sparks && tooth % Math.round(w.teeth / sparks) === 0)) {
        flush();
        if (camAt) this.transport.write(encodeTriggerFrame(0x02, [], at));
        if (sparks && tooth % Math.round(w.teeth / sparks) === 0) this.transport.write(encodeTriggerFrame(0x08, [], at));
      }
      tr.pos = (tr.pos + 1) % (2 * w.teeth);
      tr.next += period;
    }
    flush();
  }

  private detailText(sub: number): string | undefined {
    switch (sub) {
      case 2:
        return this.details.compilationTime;
      case 3:
        return this.details.serialNumber;
      case 4:
        return this.details.signature;
      case 5:
        return this.details.mtCodeVer;
      default:
        return undefined;
    }
  }
}
