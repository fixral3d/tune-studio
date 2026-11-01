import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ConfigEvaluator,
  logSamples,
  pagesFromPackets,
  parseVemsLog,
  siprTypeName,
  type SiprDescriptor,
  type VemsConfig,
  type VemsLog,
} from '@vems/core';
import { ReplayFeed } from '../lib/replay';

const DEFAULT_CHANNELS = ['rpm', 'map', 'throttle', 'coolant', 'lambda', 'pulseWidth'];
const LANE_H = 64;
const COLORS = ['#3fb950', '#58a6ff', '#d29922', '#f85149', '#bc8cff', '#39c5cf', '#ff7b72', '#e3b341'];

/** digits < 0 = auto (computed channels carry no digits in the INI). */
const fmtV = (v: number, d: number) => v.toFixed(d >= 0 ? d : Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 3);

interface Series {
  name: string;
  units: string;
  digits: number;
  values: Float64Array;
}

/** .vemslog viewer: decodes realtime with the INI (+ the log's own config snapshot) into a
 *  multi-lane graph with cursor, markers, zoom and min/max/avg (LOG-05), plus CSV export (LOG-07). */
export function DatalogPanel({
  config,
  sipr,
  onReplay,
  replayIndex,
}: {
  config?: VemsConfig;
  sipr?: SiprDescriptor;
  /** start a replay of the loaded log (LOG-03) */
  onReplay?: (feed: ReplayFeed) => void;
  /** current replay position → graph cursor */
  replayIndex?: number;
}) {
  const [log, setLog] = useState<VemsLog>();
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [channels, setChannels] = useState<string[]>(DEFAULT_CHANNELS);
  const [range, setRange] = useState<[number, number]>();
  const [cursor, setCursor] = useState<number>();

  async function onFile(file: File) {
    setErr('');
    try {
      setLog(parseVemsLog(new Uint8Array(await file.arrayBuffer())));
      setName(file.name);
      setRange(undefined);
      setCursor(undefined);
    } catch (e) {
      setErr(String(e));
    }
  }

  const packets = log?.results ?? [];
  const crcErrors = packets.filter((r) => r.kind === 'crc-error').length;
  const decoded = useMemo(() => {
    const ok = packets.filter((r) => r.kind === 'packet').map((r) => r.packet);
    return { ...logSamples(ok), pages: sipr ? pagesFromPackets(sipr, ok) : undefined };
  }, [log, sipr]);
  const { samples, markers } = decoded;

  const shown = config ? channels.filter((c) => config.byName.has(c)) : [];
  const series = useMemo<Series[]>(() => {
    if (!config) return [];
    const ev = new ConfigEvaluator(config);
    const out = shown.map((n) => {
      const f = config.byName.get(n)!;
      return { name: n, units: f.units, digits: f.kind === 'computed' ? -1 : 'digits' in f ? f.digits : 1, values: new Float64Array(samples.length) };
    });
    samples.forEach((s, i) => {
      ev.reset({ realtime: s.data, pages: decoded.pages, extra: { time: s.ms / 1000 } });
      for (const sr of out) {
        try {
          sr.values[i] = ev.value(sr.name) ?? NaN;
        } catch {
          sr.values[i] = NaN;
        }
      }
    });
    return out;
  }, [config, decoded, shown.join(',')]);

  const [i0, i1] = range ?? [0, Math.max(0, samples.length - 1)];
  useEffect(() => {
    if (replayIndex !== undefined && replayIndex < samples.length) setCursor(replayIndex);
  }, [replayIndex, samples.length]);

  function exportCsv() {
    const lines = ['#VemsTune', ['time', ...series.map((s) => s.name)].join('\t')];
    samples.forEach((s, i) =>
      lines.push([(s.ms / 1000).toFixed(3), ...series.map((sr) => (Number.isNaN(sr.values[i]) ? '' : fmtV(sr.values[i]!, sr.digits)))].join('\t')),
    );
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name.replace(/\.vemslog$/i, '') + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Datalog (.vemslog)</strong>
        <span className="muted">Multi Graph log görüntüleyici</span>
      </div>

      <label className="dropzone">
        <input type="file" accept=".vemslog" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} hidden />
        <span>{log ? `${name} — başka bir .vemslog seç` : 'Bir .vemslog dosyası seç'}</span>
      </label>

      {err && <div className="err">{err}</div>}

      {log && (
        <>
          <div className="fw-meta">
            <div><span className="muted">Firmware</span><b>{log.header.Version ?? '?'}</b></div>
            <div><span className="muted">Seri no</span><b>{log.header.SerialNumber ?? '?'}</b></div>
            <div><span className="muted">Zaman</span><b>{log.header.CurrentTime ?? '?'}</b></div>
            <div><span className="muted">Realtime kayıt</span><b>{samples.length}</b></div>
            <div><span className="muted">Süre</span><b>{samples.length ? ((samples.at(-1)!.ms - samples[0]!.ms) / 1000).toFixed(1) : 0} s</b></div>
            <div><span className="muted">Marker</span><b>{markers.length}</b></div>
            <div><span className="muted">Config snapshot</span><b>{decoded.pages?.size ?? 0} sayfa</b></div>
            <div><span className="muted">CRC hatası</span><b className={crcErrors ? 'bad' : 'ok'}>{crcErrors}</b></div>
          </div>

          {samples.length > 0 && config && (
            <>
              <ChannelPicker config={config} channels={channels} setChannels={setChannels} />
              <div className="btnrow">
                <button onClick={() => setRange(undefined)} disabled={!range}>Tümü</button>
                <button onClick={() => zoom(0.5)}>Yakınlaş</button>
                <button onClick={() => zoom(2)}>Uzaklaş</button>
                <button onClick={exportCsv}>CSV dışa aktar</button>
                {onReplay && (
                  <button onClick={() => onReplay(new ReplayFeed(samples, decoded.pages, name))} title="Göstergeleri bu log ile oynat">
                    ▶ Oynat
                  </button>
                )}
                <span className="muted small">Grafikte sürükle = seçime yakınlaş · çift tık = tümü</span>
              </div>
              <Graph
                samples={samples}
                series={series}
                markers={markers}
                i0={i0}
                i1={i1}
                cursor={cursor}
                setCursor={setCursor}
                setRange={setRange}
              />
              <Stats series={series} i0={i0} i1={i1} cursor={cursor} />
            </>
          )}
          {samples.length === 0 && <p className="muted">Bu log realtime kaydı içermiyor (yalnız config snapshot).</p>}

          <details className="pkt-list">
            <summary>Paket listesi ({packets.length})</summary>
            <div className="table-wrap fw-pages">
              <table className="pages">
                <thead>
                  <tr><th>#</th><th>Tip</th><th>Seq</th><th>Boy</th><th>CRC</th></tr>
                </thead>
                <tbody>
                  {packets.slice(0, 500).map((r, i) => (
                    <tr key={i}>
                      <td>{i}</td>
                      <td className="mono">{siprTypeName(r.packet.type)} (0x{r.packet.type.toString(16)})</td>
                      <td>{r.packet.sequence}</td>
                      <td>{r.packet.payload.length}</td>
                      <td className={r.kind === 'packet' ? 'ok' : 'bad'}>{r.kind === 'packet' ? 'OK' : 'HATA'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {packets.length > 500 && <p className="muted small">İlk 500 paket gösteriliyor.</p>}
          </details>
        </>
      )}
    </div>
  );

  function zoom(f: number) {
    const n = samples.length;
    const c = cursor ?? Math.round((i0 + i1) / 2);
    const half = Math.max(5, Math.round(((i1 - i0) * f) / 2));
    const a = Math.max(0, c - half);
    const b = Math.min(n - 1, c + half);
    setRange(a === 0 && b === n - 1 ? undefined : [a, b]);
  }
}

function ChannelPicker({
  config,
  channels,
  setChannels,
}: {
  config: VemsConfig;
  channels: string[];
  setChannels: (c: string[]) => void;
}) {
  const [text, setText] = useState('');
  const all = useMemo(() => config.channels.map((c) => c.name).sort(), [config]);
  function add() {
    if (config.byName.has(text) && !channels.includes(text)) setChannels([...channels, text]);
    setText('');
  }
  return (
    <div className="chips">
      {channels.map((c, i) => (
        <span key={c} className="chip" style={{ borderColor: COLORS[i % COLORS.length] }}>
          {c}
          {!config.byName.has(c) && <span className="bad"> ?</span>}
          <button onClick={() => setChannels(channels.filter((x) => x !== c))} aria-label={`${c} kaldır`}>×</button>
        </span>
      ))}
      <input
        className="num"
        list="rt-channels"
        placeholder="kanal ekle…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
      />
      <datalist id="rt-channels">
        {all.map((c) => <option key={c} value={c} />)}
      </datalist>
      <button onClick={add} disabled={!config.byName.has(text)}>Ekle</button>
    </div>
  );
}

function Graph({
  samples,
  series,
  markers,
  i0,
  i1,
  cursor,
  setCursor,
  setRange,
}: {
  samples: { ms: number }[];
  series: Series[];
  markers: number[];
  i0: number;
  i1: number;
  cursor?: number;
  setCursor: (i?: number) => void;
  setRange: (r?: [number, number]) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  const [drag, setDrag] = useState<[number, number]>();
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const AXIS = 22;
  const h = series.length * LANE_H + AXIS;
  const span = Math.max(1, i1 - i0);
  const xOf = (i: number) => ((i - i0) / span) * w;
  const iOf = (x: number) => Math.round(i0 + (Math.max(0, Math.min(w, x)) / w) * span);
  const tOf = (i: number) => (samples[i]!.ms - samples[0]!.ms) / 1000;

  const paths = series.map((s, k) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const v = s.values[i]!;
      if (!Number.isNaN(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (lo === Infinity) return { d: '', lo: 0, hi: 0, flat: true };
    const flat = hi === lo;
    if (flat) {
      hi += 1;
      lo -= 1;
    }
    const top = k * LANE_H + 6;
    const ht = LANE_H - 12;
    const yOf = (v: number) => top + ht - ((v - lo) / (hi - lo)) * ht;
    // decimate to ~1 point per pixel (min/max per bucket keeps spikes)
    const step = Math.max(1, Math.floor(span / w));
    let d = '';
    for (let i = i0; i <= i1; i += step) {
      let mn = Infinity;
      let mx = -Infinity;
      for (let j = i; j < Math.min(i + step, i1 + 1); j++) {
        const v = s.values[j]!;
        if (!Number.isNaN(v)) {
          mn = Math.min(mn, v);
          mx = Math.max(mx, v);
        }
      }
      if (mn === Infinity) continue;
      const x = xOf(i).toFixed(1);
      d += `${d ? 'L' : 'M'}${x},${yOf(mx).toFixed(1)}`;
      if (mn !== mx) d += `L${x},${yOf(mn).toFixed(1)}`;
    }
    return { d, lo, hi, flat };
  });

  // time ticks at a "nice" second interval
  const total = tOf(i1) - tOf(i0) || 1;
  const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600].find((s) => total / s <= w / 90) ?? 1200;
  const ticks: number[] = [];
  for (let t = Math.ceil(tOf(i0) / nice) * nice; t <= tOf(i1); t += nice) ticks.push(t);
  const xOfT = (t: number) => ((t - tOf(i0)) / total) * w;

  const px = (e: React.MouseEvent) => e.clientX - e.currentTarget.getBoundingClientRect().left;

  return (
    <div ref={wrap} className="mvg">
      <svg
        width={w}
        height={h}
        onMouseMove={(e) => {
          const i = iOf(px(e));
          setCursor(i);
          if (drag) setDrag([drag[0], i]);
        }}
        onMouseDown={(e) => setDrag([iOf(px(e)), iOf(px(e))])}
        onMouseUp={() => {
          if (drag && Math.abs(drag[1] - drag[0]) > 2) setRange([Math.min(...drag), Math.max(...drag)]);
          setDrag(undefined);
        }}
        onMouseLeave={() => setDrag(undefined)}
        onDoubleClick={() => setRange(undefined)}
      >
        {series.map((s, k) => (
          <g key={s.name}>
            <rect x={0} y={k * LANE_H} width={w} height={LANE_H} className={k % 2 ? 'lane odd' : 'lane'} />
            <path d={paths[k]!.d} stroke={COLORS[k % COLORS.length]} fill="none" strokeWidth={1.4} />
            <text x={6} y={k * LANE_H + 16} className="lane-label" fill={COLORS[k % COLORS.length]}>
              {s.name}
              {cursor !== undefined && !Number.isNaN(s.values[cursor]!) ? ` = ${fmtV(s.values[cursor]!, s.digits)} ${s.units}` : ''}
            </text>
            <text x={w - 6} y={k * LANE_H + 14} className="lane-scale" textAnchor="end">{paths[k]!.flat ? '' : fmtV(paths[k]!.hi, s.digits)}</text>
            <text x={w - 6} y={(k + 1) * LANE_H - 4} className="lane-scale" textAnchor="end">{paths[k]!.flat ? '' : fmtV(paths[k]!.lo, s.digits)}</text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={xOfT(t)} x2={xOfT(t)} y1={0} y2={h - AXIS} className="grid" />
            <text x={xOfT(t)} y={h - 6} className="lane-scale" textAnchor="middle">{+t.toFixed(1)} s</text>
          </g>
        ))}
        {markers.filter((m) => m >= i0 && m <= i1).map((m, j) => (
          <line key={j} x1={xOf(m)} x2={xOf(m)} y1={0} y2={h - AXIS} className="marker" />
        ))}
        {drag && (
          <rect x={Math.min(xOf(drag[0]), xOf(drag[1]))} y={0} width={Math.abs(xOf(drag[1]) - xOf(drag[0]))} height={h - AXIS} className="sel" />
        )}
        {cursor !== undefined && <line x1={xOf(cursor)} x2={xOf(cursor)} y1={0} y2={h - AXIS} className="cursor" />}
      </svg>
      <div className="muted small">
        {cursor !== undefined ? `imleç: ${tOf(cursor).toFixed(2)} s (#${cursor})` : ' '} · görünen: {tOf(i0).toFixed(1)}–{tOf(i1).toFixed(1)} s
      </div>
    </div>
  );
}

function Stats({ series, i0, i1, cursor }: { series: Series[]; i0: number; i1: number; cursor?: number }) {
  const stat = (v: Float64Array, a: number, b: number) => {
    let mn = Infinity;
    let mx = -Infinity;
    let sum = 0;
    let n = 0;
    for (let i = a; i <= b; i++) {
      const x = v[i]!;
      if (Number.isNaN(x)) continue;
      mn = Math.min(mn, x);
      mx = Math.max(mx, x);
      sum += x;
      n++;
    }
    return n ? { mn, mx, avg: sum / n } : undefined;
  };
  const fmt = (x: number | undefined, d: number) => (x === undefined ? '—' : fmtV(x, d));
  return (
    <div className="table-wrap">
      <table className="pages">
        <thead>
          <tr>
            <th>Kanal</th><th>İmleç</th><th>Min (görünen)</th><th>Maks (görünen)</th><th>Ort. (görünen)</th><th>Min (tümü)</th><th>Maks (tümü)</th><th>Ort. (tümü)</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s, k) => {
            const vis = stat(s.values, i0, i1);
            const all = stat(s.values, 0, s.values.length - 1);
            const cur = cursor !== undefined ? s.values[cursor] : undefined;
            return (
              <tr key={s.name}>
                <td style={{ color: COLORS[k % COLORS.length] }}>{s.name} <span className="muted">{s.units}</span></td>
                <td>{fmt(cur !== undefined && !Number.isNaN(cur) ? cur : undefined, s.digits)}</td>
                <td>{fmt(vis?.mn, s.digits)}</td>
                <td>{fmt(vis?.mx, s.digits)}</td>
                <td>{fmt(vis?.avg, s.digits)}</td>
                <td>{fmt(all?.mn, s.digits)}</td>
                <td>{fmt(all?.mx, s.digits)}</td>
                <td>{fmt(all?.avg, s.digits)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
