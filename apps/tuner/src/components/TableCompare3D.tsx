import { useEffect, useMemo, useState } from 'react';
import {
  applyVemsCfg,
  array2dIndex,
  ecuIdForField,
  parseVemsCfg,
  readArray,
  VemsClient,
  type ArrayField,
  type SiprDescriptor,
  type TableDesc,
  type VemsConfig,
} from '@vems/core';
import { divergeCss, heatCss } from '../lib/colormap';
import { Table3D } from './Table3D';

/**
 * Table Compare 3D (TUNE-11) — VemsTune TableCompare3DFrame / TableCompare3DGLCanvas:
 * two tables (File 1 / File 2 / "Load from VT") drawn on one scale, File 1 red, File 2 green,
 * Difference = File 1 − File 2 coloured red/blue by sign. Modes as cbx_mode (0x203/0x204/0x205).
 * Unlike VemsTune (VE 14×16 / Ignition 12×12 only) any INI table can be compared.
 */
type SrcKind = 'ecu' | 'default' | 'file';
interface Source {
  kind: SrcKind;
  fw: string;
  file?: { name: string; text: string };
}
interface Loaded {
  label: string;
  values: number[];
  xBins: number[];
  yBins: number[];
}

const MODES = ['File 1', 'File 2', 'File 1 + File 2', 'Fark', 'File 1 + File 2 + Fark'] as const;
const show = [
  [true, false, false],
  [false, true, false],
  [true, true, false],
  [false, false, true],
  [true, true, true],
] as const;

async function loadSource(
  src: Source,
  client: VemsClient,
  config: VemsConfig,
  sipr: SiprDescriptor | undefined,
  z: ArrayField,
  xf?: ArrayField,
  yf?: ArrayField,
  shared?: Map<number, Uint8Array>,
): Promise<Loaded> {
  const fields = [z, xf, yf].filter((f): f is ArrayField => !!f);
  const pages = new Map<number, Uint8Array>(); // by INI page
  let label: string;
  if (src.kind === 'ecu') {
    // prefer the shared page copy read once at connect (RealtimeFeed.pages); only read from the ECU if it is
    // missing, so this doesn't race the realtime poll loop over WebSerial (that caused "Load from VT" timeouts)
    for (const f of fields) {
      if (pages.has(f.page)) continue;
      const fromShared = shared?.get(f.page);
      if (fromShared) {
        pages.set(f.page, fromShared);
        continue;
      }
      const id = ecuIdForField(config, f);
      if (id !== undefined) pages.set(f.page, await client.readPage(id));
    }
    label = 'ECU';
  } else {
    if (!sipr) throw new Error('SIPR tanımı yok — .vemscfg uygulanamıyor');
    let text: string;
    if (src.kind === 'file') {
      if (!src.file) throw new Error('dosya seçilmedi');
      text = src.file.text;
      label = src.file.name;
    } else {
      const res = await fetch(`${import.meta.env.BASE_URL}config/defaultfirmwareconfigs/config_${src.fw}.vemscfg`);
      if (!res.ok) throw new Error(`config_${src.fw}.vemscfg bulunamadı`);
      text = await res.text();
      label = `varsayılan ${src.fw}`;
    }
    applyVemsCfg(parseVemsCfg(text), { cfg: config, sipr }, pages);
    if (!pages.has(z.page)) throw new Error(`${z.name} bu dosyada yok`);
  }
  const read = (f?: ArrayField) => {
    const pg = f && pages.get(f.page);
    return f && pg ? readArray(pg, f) : [];
  };
  const [xlen, ylen] = z.shape.dims as [number, number];
  const mem = read(z);
  const values = new Array<number>(xlen * ylen);
  for (let y = 0; y < ylen; y++) for (let x = 0; x < xlen; x++) values[y * xlen + x] = mem[array2dIndex(z, x, y)]!;
  return { label, values, xBins: read(xf).slice(0, xlen), yBins: read(yf).slice(0, ylen) };
}

/** one side, loaded independently (VemsTune ReloadData: ClearData → LoadData → Repaint) */
function useSource(
  src: Source,
  c: {
    client: VemsClient;
    config: VemsConfig;
    sipr?: SiprDescriptor;
    z?: ArrayField;
    xf?: ArrayField;
    yf?: ArrayField;
    shared?: Map<number, Uint8Array>;
    reload: number;
  },
): [Loaded | undefined, string | undefined] {
  const [loaded, setLoaded] = useState<Loaded>();
  const [err, setErr] = useState<string>();
  useEffect(() => {
    setLoaded(undefined);
    setErr(undefined);
    if (!c.z) return;
    let alive = true;
    loadSource(src, c.client, c.config, c.sipr, c.z, c.xf, c.yf, c.shared)
      .then((l) => alive && setLoaded(l))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [src, c.client, c.config, c.sipr, c.z, c.xf, c.yf, c.shared, c.reload]);
  return [loaded, err];
}

function SourcePicker({
  title,
  color,
  src,
  set,
  versions,
  loaded,
  err,
}: {
  title: string;
  color: string;
  src: Source;
  set(s: Source): void;
  versions: string[];
  loaded?: Loaded;
  err?: string;
}) {
  return (
    <div className="tc-src">
      <span className="tc-dot" style={{ background: color }} />
      <b>{title}</b>
      <select value={src.kind} onChange={(e) => set({ ...src, kind: e.target.value as SrcKind })}>
        <option value="ecu">ECU (Load from VT)</option>
        <option value="default">Varsayılan config</option>
        <option value="file">.vemscfg dosyası</option>
      </select>
      {src.kind === 'default' && (
        <select value={src.fw} onChange={(e) => set({ ...src, fw: e.target.value })}>
          {versions.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      )}
      {src.kind === 'file' && (
        <label className="tc-file">
          {src.file?.name ?? 'Dosya seç…'}
          <input
            type="file"
            accept=".vemscfg,.txt"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) set({ ...src, file: { name: f.name, text: await f.text() } });
              e.target.value = '';
            }}
          />
        </label>
      )}
      <span className={`small ${err ? 'tc-err' : 'muted'}`}>{err ?? (loaded ? `✓ ${loaded.label}` : '…')}</span>
    </div>
  );
}

export function TableCompare3D({
  client,
  config,
  table,
  sipr,
  firmware,
  shared,
}: {
  client: VemsClient;
  config: VemsConfig;
  table: TableDesc;
  sipr?: SiprDescriptor;
  firmware?: string;
  /** config pages read once at connect (RealtimeFeed.pages); the ECU source uses these */
  shared?: Map<number, Uint8Array>;
}) {
  const z = table.zSym ? (config.byName.get(table.zSym) as ArrayField | undefined) : undefined;
  const xf = table.xSym ? (config.byName.get(table.xSym) as ArrayField | undefined) : undefined;
  const yf = table.ySym ? (config.byName.get(table.ySym) as ArrayField | undefined) : undefined;

  const [versions, setVersions] = useState<string[]>([]);
  const [srcA, setSrcA] = useState<Source>({ kind: 'ecu', fw: '1.2.34' });
  const [srcB, setSrcB] = useState<Source>({ kind: 'default', fw: firmware ?? '1.2.34' });
  const [mode, setMode] = useState(4);
  const [info, setInfo] = useState(true);
  const [reload, setReload] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number }>();

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}config/defaultfirmwareconfigs/index.json`)
      .then((r) => r.json())
      .then((ix: { v3: string[] }) => {
        setVersions(ix.v3);
        if (firmware && !ix.v3.includes(firmware)) setSrcB((s) => ({ ...s, fw: ix.v3[ix.v3.length - 1]! }));
      })
      .catch(() => setVersions(['1.2.34']));
  }, [firmware]);

  const ctx = { client, config, sipr, z, xf, yf, shared, reload };
  const [a, errA] = useSource(srcA, ctx);
  const [b, errB] = useSource(srcB, ctx);

  const xlen = z?.shape.dims[0] ?? 0;
  const ylen = z?.shape.dims[1] ?? 0;
  const n = xlen * ylen;
  const digits = z?.digits ?? 0;
  const eps = 10 ** -digits / 2;

  const diff = useMemo(() => (a && b ? a.values.map((v, i) => v - b.values[i]!) : undefined), [a, b]);
  const stats = useMemo(() => {
    if (!diff) return undefined;
    let changed = 0;
    let maxP = 0;
    let maxN = 0;
    let sumAbs = 0;
    let sq = 0;
    for (const d of diff) {
      if (Math.abs(d) > eps) changed++;
      if (d > maxP) maxP = d;
      if (d < maxN) maxN = d;
      sumAbs += Math.abs(d);
      sq += d * d;
    }
    return { changed, maxP, maxN, mean: sumAbs / diff.length, rms: Math.sqrt(sq / diff.length) };
  }, [diff, eps]);

  const sameBins = (p: number[], q: number[]) => p.length === q.length && p.every((v, i) => Math.abs(v - q[i]!) < 1e-9);
  const binsDiffer = a && b && !(sameBins(a.xBins, b.xBins) && sameBins(a.yBins, b.yBins));

  const [showA, showB, showD] = show[mode]!;
  const diffOnly = showD && !showA;
  const range = useMemo(() => {
    if (diffOnly) {
      const m = Math.max(10 ** -digits, ...(diff ?? [0]).map(Math.abs));
      return { lo: -m, hi: m };
    }
    const vals = [...(showA || !showB ? (a?.values ?? []) : []), ...(showB ? (b?.values ?? []) : [])];
    if (!vals.length) return { lo: 0, hi: 1 };
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return hi === lo ? { lo: lo - 1, hi: hi + 1 } : { lo, hi };
  }, [a, b, diff, showA, showB, diffOnly, digits]);

  const base = a ?? b;
  const xLabels = useMemo(
    () => Array.from({ length: xlen }, (_, i) => (base?.xBins[i] !== undefined ? String(+base.xBins[i]!.toFixed(1)) : String(i))),
    [base, xlen],
  );
  const yLabels = useMemo(
    () => Array.from({ length: ylen }, (_, i) => (base?.yBins[i] !== undefined ? String(+base.yBins[i]!.toFixed(1)) : String(i))),
    [base, ylen],
  );

  if (!z || z.kind !== 'array' || z.shape.dims.length !== 2)
    return <div className="panel">Bu tablo karşılaştırılamıyor.</div>;

  // what the 3D view draws for the mode
  let values: number[] | undefined;
  let ghost: number[] | undefined;
  let tint: string | undefined;
  let diverging = false;
  let colorBy: number[] | undefined;
  if (diffOnly) {
    values = diff;
    diverging = true;
  } else if (showA && showB) {
    values = a?.values;
    ghost = b?.values;
    if (showD && diff) {
      diverging = true;
      colorBy = diff;
    } else tint = '#ff5f6d';
  } else values = showB ? b?.values : a?.values;

  const fmt = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits));
  const sgn = (v: number) => (v > eps ? '+' : '') + v.toFixed(digits);
  const tipExtra = (i: number) =>
    `F1 ${fmt(a?.values[i])} · F2 ${fmt(b?.values[i])}${diff ? ` · Δ ${sgn(diff[i]!)}` : ''}`;
  const m = stats ? Math.max(stats.maxP, -stats.maxN) : 1;
  const xTitle = table.xChannel ?? xf?.name ?? 'X';
  const yTitle = table.yChannel ?? yf?.name ?? 'Y';

  return (
    <div className="tc">
      <div className="tc-bar">
        <SourcePicker title="File 1" color="#ff5f6d" src={srcA} set={setSrcA} versions={versions} loaded={a} err={errA} />
        <SourcePicker title="File 2" color="#3ee68a" src={srcB} set={setSrcB} versions={versions} loaded={b} err={errB} />
        <div className="tc-ctl">
          <div className="seg">
            {MODES.map((l, i) => (
              <button key={l} className={mode === i ? 'on' : ''} onClick={() => setMode(i)}>
                {l}
              </button>
            ))}
          </div>
          <label className="small">
            <input type="checkbox" checked={info} onChange={(e) => setInfo(e.target.checked)} /> Bilgi
          </label>
          <button
            className="ghost"
            onClick={() => {
              const t = srcA;
              setSrcA(srcB);
              setSrcB(t);
            }}
            title="File 1 ↔ File 2"
          >
            ⇄
          </button>
          <button className="ghost" onClick={() => setReload((r) => r + 1)}>
            Yenile
          </button>
        </div>
      </div>

      {binsDiffer && (
        <div className="tc-warn small">
          Eksen değerleri iki dosyada farklı — VemsTune gibi hücre hücre karşılaştırılıyor, etiketler File 1'den.
        </div>
      )}

      <div className="tc-body">
        <div className="t3-host tall tc-3d">
          {values && values.length >= n ? (
            <Table3D
              xlen={xlen}
              ylen={ylen}
              values={values}
              lo={range.lo}
              hi={range.hi}
              digits={digits}
              xLabels={xLabels}
              yLabels={yLabels}
              xTitle={xTitle}
              yTitle={yTitle}
              zTitle={diffOnly ? `Δ ${z.units || z.name}` : z.units || z.name}
              ghost={ghost}
              tint={tint}
              diverging={diverging}
              colorBy={colorBy}
              sel={hover && { xa: hover.x, xb: hover.x, ya: hover.y, yb: hover.y }}
              tipExtra={tipExtra}
              help="Sürükle: döndür · Sağ tık: kaydır · Tekerlek: yakınlaş · F1 kırmızı · F2 yeşil · Fark: + kırmızı / − mavi"
              onSelect={(x, y) => setHover({ x, y })}
              onHover={() => undefined}
              onDrag={() => undefined}
            />
          ) : (
            <div className="panel">{errA || errB || 'Yükleniyor…'}</div>
          )}
          {info && stats && (
            <div className="tc-info">
              <div>
                <span>Farklı hücre</span>
                <b>
                  {stats.changed} / {n}
                </b>
              </div>
              <div>
                <span>En büyük +</span>
                <b className="pos">{sgn(stats.maxP)}</b>
              </div>
              <div>
                <span>En büyük −</span>
                <b className="neg">{sgn(stats.maxN)}</b>
              </div>
              <div>
                <span>Ort. |Δ|</span>
                <b>{stats.mean.toFixed(digits + 1)}</b>
              </div>
              <div>
                <span>RMS</span>
                <b>{stats.rms.toFixed(digits + 1)}</b>
              </div>
            </div>
          )}
        </div>

        <div className="tc-grid-wrap">
          <table className="tc-grid">
            <tbody>
              {Array.from({ length: ylen }, (_, r) => {
                const y = ylen - 1 - r;
                return (
                  <tr key={y}>
                    <th>{yLabels[y]}</th>
                    {Array.from({ length: xlen }, (_, x) => {
                      const i = y * xlen + x;
                      const d = diff?.[i];
                      const main = showD || (showA && showB) ? d : showB ? b?.values[i] : a?.values[i];
                      const bg =
                        d !== undefined && (showD || (showA && showB))
                          ? divergeCss(d, m)
                          : heatCss(((main ?? range.lo) - range.lo) / (range.hi - range.lo || 1));
                      const on = hover?.x === x && hover.y === y;
                      return (
                        <td
                          key={x}
                          className={`${on ? 'on' : ''} ${d !== undefined && Math.abs(d) <= eps ? 'same' : ''}`}
                          style={{ background: bg }}
                          title={tipExtra(i)}
                          onClick={() => setHover({ x, y })}
                        >
                          {main === undefined ? '—' : showD || (showA && showB) ? sgn(main) : fmt(main)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              <tr>
                <th />
                {xLabels.map((l, x) => (
                  <th key={x}>{l}</th>
                ))}
              </tr>
            </tbody>
          </table>
          {hover && (
            <div className="tc-cell small">
              {xTitle} {xLabels[hover.x]} · {yTitle} {yLabels[hover.y]} — {tipExtra(hover.y * xlen + hover.x)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
