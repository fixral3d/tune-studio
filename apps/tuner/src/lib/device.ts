import {
  applyVemsCfg,
  array2dIndex,
  EcuEmulator,
  MemoryPipe,
  parseVemsCfg,
  readArray,
  VemsClient,
  type ArrayField,
  type SerialTransport,
  type SiprDescriptor,
  type VemsConfig,
} from '@vems/core';

/** A connected device = client + its transport, plus optional emulator (demo). */
export interface Device {
  client: VemsClient;
  transport: SerialTransport;
  emulator?: EcuEmulator;
  stop(): void;
}

/** VE fields the demo engine model reads from the emulator's own pages. */
export interface DemoVe {
  ecuId: number;
  table: ArrayField;
  rpmBins: ArrayField;
  mapBins: ArrayField;
}

export interface DemoOptions {
  /** config pages by ecuId (VemsTune's default .vemscfg, see loadDemoSeed) */
  seed?: Map<number, Uint8Array>;
  ve?: DemoVe;
}

/**
 * Config pages from VemsTune's own defaultfirmwareconfigs/config_<fw>.vemscfg, keyed by ecuId,
 * plus the VE fields for the engine model. Undefined when the file or fields are missing.
 */
export async function loadDemoSeed(config: VemsConfig, sipr: SiprDescriptor, fw = '1.2.34'): Promise<DemoOptions> {
  const res = await fetch(`${import.meta.env.BASE_URL}config/defaultfirmwareconfigs/config_${fw}.vemscfg`);
  if (!res.ok) return {};
  const pages = new Map<number, Uint8Array>();
  applyVemsCfg(parseVemsCfg(await res.text()), { cfg: config, sipr }, pages);
  const seed = new Map<number, Uint8Array>();
  for (const [vt, buf] of pages) {
    const ecu = config.vt2ecu.get(vt);
    if (ecu !== undefined) seed.set(ecu, buf);
  }
  const f = (n: string) => config.byName.get(n);
  const table = f('veTable');
  const rpmBins = f('rpmBinsVE');
  const mapBins = f('mapBinsVE');
  const ecuId = table ? config.vt2ecu.get(table.page) : undefined;
  const ve =
    table?.kind === 'array' && rpmBins?.kind === 'array' && mapBins?.kind === 'array' && ecuId !== undefined
      ? { ecuId, table, rpmBins, mapBins }
      : undefined;
  return { seed, ve };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Bilinear VE lookup over the table's bins (clamped at the edges). */
function veAt(page: Uint8Array, ve: DemoVe, rpm: number, map: number): number {
  const xs = readArray(page, ve.rpmBins);
  const ys = readArray(page, ve.mapBins);
  const vals = readArray(page, ve.table);
  const frac = (bins: number[], v: number) => {
    if (v <= bins[0]!) return 0;
    for (let i = 0; i < bins.length - 1; i++)
      if (v <= bins[i + 1]!) return i + (v - bins[i]!) / (bins[i + 1]! - bins[i]! || 1);
    return bins.length - 1;
  };
  const fx = frac(xs, rpm);
  const fy = frac(ys, map);
  const x0 = Math.min(xs.length - 2, Math.floor(fx));
  const y0 = Math.min(ys.length - 2, Math.floor(fy));
  const tx = clamp(fx - x0, 0, 1);
  const ty = clamp(fy - y0, 0, 1);
  const v = (x: number, y: number) => vals[array2dIndex(ve.table, x, y)]!;
  return (
    v(x0, y0) * (1 - tx) * (1 - ty) + v(x0 + 1, y0) * tx * (1 - ty) + v(x0, y0 + 1) * (1 - tx) * ty + v(x0 + 1, y0 + 1) * tx * ty
  );
}

/**
 * Demo device: client ↔ in-browser V3 emulator over a MemoryPipe. Config pages come from
 * VemsTune's default config when given; the realtime block is a small engine model whose
 * "true" VE differs smoothly from the VE table, so the measured lambda (egoADC) shows what the
 * VE analysers should correct. Editing the VE table (AutoTune, Fix cells) closes the loop.
 */
export function createDemoDevice(opts: DemoOptions = {}): Device {
  const pipe = new MemoryPipe(19200);
  const ve = new Uint8Array(255);
  for (let i = 0; i < 224; i++) ve[i] = 60 + ((i * 7) % 120); // VE table 0..223 (%)
  // rpmBinsVE @224 [16], scale 100 → 500..7500 rpm
  for (let i = 0; i < 16; i++) ve[224 + i] = 5 + i * 4;
  // mapBinsVE @240 [14] → ~20..250 kPa
  for (let i = 0; i < 14; i++) ve[240 + i] = 20 + i * 17;
  // fallback: seed every ecu page (0..17) so all tables render; the default config overrides
  const pages = new Map<number, Uint8Array>();
  for (let ecuId = 0; ecuId <= 17; ecuId++) {
    pages.set(ecuId, Uint8Array.from({ length: 255 }, (_, i) => 50 + ((i * 5 + ecuId * 13) % 150)));
  }
  pages.set(10, ve);
  for (const [ecuId, buf] of opts.seed ?? []) {
    const page = pages.get(ecuId) ?? new Uint8Array(Math.max(255, buf.length));
    page.set(buf.subarray(0, page.length));
    pages.set(ecuId, page);
  }
  const emulator = new EcuEmulator(pipe.b, {
    details: { serialNumber: 'v3.3_n001453', signature: 'VEMS Genboard v3, 1.2.34', mtCodeVer: 'VEMS v1.2.34 16x14 kpa=2,1' },
    pages,
  });
  const client = new VemsClient(pipe.a);
  void pipe.a.open();
  void pipe.b.open();
  emulator.start();
  client.start();

  // the engine's real volumetric efficiency: the shipped VE table shaped by a smooth error
  const veModel = opts.ve;
  const base = veModel && pages.get(veModel.ecuId)?.slice();
  const trueVe = (rpm: number, map: number) =>
    base && veModel ? veAt(base, veModel, rpm, map) * (1 + 0.07 * Math.sin(rpm / 1100) * Math.cos(map / 23)) : 80;

  let t = 0;
  let heat = 0;
  const rt = new Uint8Array(80);
  const put16 = (at: number, v: number) => {
    const r = clamp(Math.round(v), 0, 0xffff);
    rt[at] = (r >> 8) & 0xff;
    rt[at + 1] = r & 0xff;
  };
  const timer = setInterval(() => {
    t += 0.1;
    // Lissajous drive cycle over the whole table: rpm 900..6500, MAP 28..100 kPa, throttle follows load
    const cranking = t < 1.5;
    const rpm = cranking ? 250 : 900 + 5600 * (0.5 + 0.5 * Math.sin(t * 0.42));
    const map = cranking ? 95 : 28 + 72 * (0.5 + 0.5 * Math.sin(t * 0.29 + 1.3));
    const tps = clamp(((map - 28) / 72) * 90 + 5, 0, 100);
    const clt = 40 + 45 * (1 - Math.exp(-t / 12)); // warms up to ~85 °C
    const lambdaTarget = map > 85 ? 0.88 : 1.0;
    const page = veModel ? emulator.getPage(veModel.ecuId) : undefined;
    const tableVe = page && veModel ? veAt(page, veModel, rpm, map) : 80;
    const lambda = (lambdaTarget * trueVe(rpm, map)) / Math.max(1, tableVe) + (Math.random() - 0.5) * 0.004;

    rt[2] = cranking ? 2 : 1; // engine: bit0 running, bit1 cranking
    put16(4, map * 4); // mapADC: map = mapADC / 4
    rt[6] = 125; // matADC (25 °C)
    rt[7] = clamp(Math.round(clt + 100), 0, 255); // coolant = cltADC - 100
    rt[8] = Math.round(tps * 2.55); // throttle = tpsADC * 100/255
    rt[9] = 120; // batteryVoltage = batADC / 255 * 30 ≈ 14.1 V
    rt[10] = clamp(Math.round(lambda * 470 - 306), 0, 211); // lambda = (egoADC + 306) / 470
    rt[11] = 100; // egoCorrection %
    put16(14, rpm);
    put16(16, (1.2 + 9 * (map / 100) * (tableVe / 100) / lambdaTarget) / 0.004); // pulseWidth_raw (ms / 0.004)
    rt[20] = clamp(Math.round(tableVe), 0, 255); // veCurr
    rt[40] = clamp(Math.round(256 / lambdaTarget - 200), 0, 255); // lambdatarget = 256 / (latgtADC + 200)

    // WBO2 calibration (ENA_FLAGS 02/03) overrides pulseWidth_raw: free-air O2 % goes out in pulseWidth_raw @16
    // (stallO2 = pulseWidth_raw / 10.24, scale 0.004); the sensor heats for ~3 s, then reads 20.9 % when
    // wbo2_calibration (page 5 @139 / page 16 @26) is 120
    const ena = emulator.testTools.get(3) ?? 0;
    heat = ena === 2 || ena === 3 ? heat + 1 : 0;
    if (heat) {
      const cal = ena === 2 ? emulator.getPage(0)?.[139] : emulator.getPage(7)?.[26];
      const o2 = Math.min(1, heat / 30) * (20.9 + ((cal ?? 120) - 120) * 0.06) + (Math.random() - 0.5) * 0.04;
      put16(16, (o2 * 10.24) / 0.004);
    }
    emulator.setRealtimeBlock(rt);
  }, 100);

  return {
    client,
    transport: pipe.a,
    emulator,
    stop() {
      clearInterval(timer);
      client.stop();
      emulator.stop();
      void pipe.a.close();
      void pipe.b.close();
    },
  };
}
