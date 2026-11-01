import { useEffect, useMemo, useRef, useState } from 'react';
import {
  array2dIndex,
  compileExpr,
  ConfigEvaluator,
  DEFAULT_ANALYZER_SETTINGS,
  ecuIdForField,
  LiveVeAnalyzer,
  readArray,
  VE_EXPRESSION,
  VE_FILTER,
  type AnalyzerMessage,
  type ArrayField,
  type CellState,
  type LiveAnalyzerSettings,
  type SiprDescriptor,
  type VemsClient,
  type VemsConfig,
} from '@vems/core';
import type { RtSource } from '../lib/gauges';
import { usePageEditor, writeUserClamped } from '../lib/pageEditor';
import { RealtimeFeed } from '../lib/realtime';
import { Table3D } from './Table3D';
import { VeStatsPanel } from './VeStatsPanel';

const LS = 'vt.rtla';
const MSG_CLASS: Record<AnalyzerMessage, string> = {
  'Filter failed!': 'm-filter',
  'NOT IN CENTER!': 'm-out',
  outside: 'm-out',
  'Collecting data': 'm-collect',
  'Tuning in progress': 'm-progress',
  TUNED: 'm-tuned',
  'Too high difference!': 'm-high',
};
const MSG_TEXT: Record<AnalyzerMessage, string> = {
  'Filter failed!': 'Filtreye takıldı',
  'NOT IN CENTER!': 'Hücre merkezinde değil',
  outside: 'Analiz alanı dışında',
  'Collecting data': 'Veri toplanıyor',
  'Tuning in progress': 'Tune sürüyor',
  TUNED: 'TUNED',
  'Too high difference!': 'Fark çok büyük!',
};
const STATE_TEXT: Record<CellState, string> = {
  empty: 'veri yok',
  collecting: 'toplanıyor (< Min. veri)',
  progress: 'hesaplandı, değişebilir',
  tuned: 'TUNED',
  toohigh: 'fark çok büyük',
  ahead: 'ileri tune (ekstrapolasyon)',
};

function loadSettings(): LiveAnalyzerSettings {
  try {
    return { ...DEFAULT_ANALYZER_SETTINGS, ...JSON.parse(localStorage.getItem(LS) ?? '{}') };
  } catch {
    return DEFAULT_ANALYZER_SETTINGS;
  }
}

function binFrac(bins: number[], v: number): number {
  const n = bins.length;
  if (n < 2 || v <= bins[0]!) return 0;
  for (let i = 0; i < n - 1; i++) if (v <= bins[i + 1]!) return i + (v - bins[i]!) / (bins[i + 1]! - bins[i]! || 1);
  return n - 1;
}

/** VE tools page: Live VE Analyzer (RTLiveAnalyzer) or VE Tune by statistics (RTDataStat). */
export function VeTools(props: { client: VemsClient; config: VemsConfig; feed?: RtSource; sipr?: SiprDescriptor }) {
  const [mode, setMode] = useState<'live' | 'stats'>('live');
  return (
    <div className="stack">
      <div className="seg ve-mode">
        <button className={mode === 'live' ? 'on' : ''} onClick={() => setMode('live')}>
          Live VE Analyzer
        </button>
        <button className={mode === 'stats' ? 'on' : ''} onClick={() => setMode('stats')}>
          VE Tune by statistics
        </button>
      </div>
      {mode === 'live' ? <AnalyzerPanel {...props} /> : <VeStatsPanel {...props} />}
    </div>
  );
}

/** Live VE Analyzer (VemsTune RTLiveAnalyzer): statistics per VE cell from the live feed, optional AutoTune. */
export function AnalyzerPanel({ client, config, feed }: { client: VemsClient; config: VemsConfig; feed?: RtSource }) {
  const tables = useMemo(
    () =>
      [...config.tables.values()].filter((t) => {
        const z = t.zSym ? config.byName.get(t.zSym) : undefined;
        return z?.kind === 'array' && z.shape.dims.length === 2 && ecuIdForField(config, z) !== undefined;
      }),
    [config],
  );
  const [tableId, setTableId] = useState(() => (config.tables.has('veTableMap') ? 'veTableMap' : tables[0]?.id3d ?? ''));
  const table = config.tables.get(tableId) ?? tables[0];
  const z = table?.zSym ? (config.byName.get(table.zSym) as ArrayField | undefined) : undefined;
  const xF = table?.xSym ? (config.byName.get(table.xSym) as ArrayField | undefined) : undefined;
  const yF = table?.ySym ? (config.byName.get(table.ySym) as ArrayField | undefined) : undefined;
  const ecuId = z ? ecuIdForField(config, z) : undefined;
  const ed = usePageEditor(client, ecuId, feed instanceof RealtimeFeed ? feed.pages : undefined, z?.page);

  const [axes, setAxes] = useState<{ x: number[]; y: number[] }>();
  const [settings, setSettings] = useState(loadSettings);
  const [filter, setFilter] = useState(VE_FILTER);
  const [running, setRunning] = useState(false);
  const [autoTune, setAutoTune] = useState(false);
  const [message, setMessage] = useState<AnalyzerMessage>();
  const [cell, setCell] = useState<{ x: number; y: number }>();
  const [live, setLive] = useState<{ fx: number; fy: number }>();
  const [view3d, setView3d] = useState(false);
  const [, setTick] = useState(0);
  const an = useRef<LiveVeAnalyzer>();
  const original = useRef<Uint8Array>();
  const ve = useRef<Uint8Array>();
  const edRef = useRef(ed);
  edRef.current = ed;

  const xlen = z?.shape.dims[0] ?? 0;
  const ylen = z?.shape.dims[1] ?? 0;
  const logical = (pg: Uint8Array) => {
    const mem = readArray(pg, z!);
    return Array.from({ length: xlen * ylen }, (_, i) => mem[array2dIndex(z!, i % xlen, Math.floor(i / xlen))]!);
  };

  function reset(pg = ve.current, ax = axes) {
    if (!pg || !ax || !z) return;
    an.current = new LiveVeAnalyzer(ax.x, ax.y, logical(pg), settings);
    setMessage(undefined);
    setTick((t) => t + 1);
  }

  async function refreshFromModel() {
    if (!z || ecuId === undefined) return;
    const ids = new Set([ecuId]);
    for (const f of [xF, yF]) {
      const id = f && ecuIdForField(config, f);
      if (id !== undefined) ids.add(id);
    }
    const pages = new Map(await Promise.all([...ids].map(async (id) => [id, await client.readPage(id)] as const)));
    const pg = pages.get(ecuId)!;
    const read = (f?: ArrayField) => {
      const id = f && ecuIdForField(config, f);
      return f && id !== undefined ? readArray(pages.get(id)!, f) : [];
    };
    const ax = { x: read(xF).slice(0, xlen), y: read(yF).slice(0, ylen) };
    original.current = pg.slice();
    ve.current = pg;
    ed.load(pg);
    setAxes(ax);
    reset(pg, ax);
  }

  useEffect(() => {
    setRunning(false);
    setAutoTune(false);
    an.current = undefined;
    refreshFromModel().catch((e) => ed.setStatus(`okuma hatası: ${(e as Error).message}`));
  }, [client, config, tableId]);

  useEffect(() => {
    try {
      localStorage.setItem(LS, JSON.stringify(settings));
    } catch {
      /* storage unavailable */
    }
    if (an.current) an.current.settings = settings;
  }, [settings]);

  // realtime: locate the sample, evaluate filter/expression, update the statistics (processData)
  const run = useRef({ running, autoTune, filter });
  run.current = { running, autoTune, filter };
  useEffect(() => {
    if (!feed || !table?.xChannel || !table.yChannel || !axes) return;
    const ev = new ConfigEvaluator(config);
    const expr = compileExpr(VE_EXPRESSION);
    let last = 0;
    return feed.subscribe(({ data }) => {
      try {
        ev.reset({ realtime: data, pages: feed.pages, extra: { time: Date.now() / 1000 } });
        const rpm = ev.value(table.xChannel!);
        const load = ev.value(table.yChannel!);
        if (rpm === undefined || load === undefined) return;
        setLive({ fx: binFrac(axes.x, rpm), fy: binFrac(axes.y, load) });
        const r = run.current;
        const a = an.current;
        if (!r.running || !a) return;
        const f = r.filter.trim() ? compileExpr(r.filter).evaluate(ev) : 1;
        const step = a.process(rpm, load, f, () => expr.evaluate(ev));
        setMessage(step.message);
        if (step.cell) setCell(step.cell);
        if (r.autoTune && step.changes.length && ve.current && z) {
          const next = ve.current.slice();
          for (const c of step.changes) writeUserClamped(next, z, array2dIndex(z, c.x, c.y), c.value);
          ve.current = next;
          edRef.current.commit(next, `AutoTune · ${step.changes.length} hücre`, false);
        }
        const now = performance.now();
        if (now - last > 150) {
          last = now;
          setTick((t) => t + 1);
        }
      } catch {
        /* expression not evaluable for this firmware */
      }
    });
  }, [feed, config, table, axes]);

  if (!table || !z) return <div className="panel">VE tablosu bulunamadı.</div>;
  const a = an.current;
  if (!a || !axes) return <div className="panel">{ed.status || `${table.title} okunuyor…`}</div>;

  const s = a.summary();
  const digits = z.digits;
  const set = (patch: Partial<LiveAnalyzerSettings>) => setSettings((o) => ({ ...o, ...patch }));
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const at = (arr: number[], x: number, y: number) => arr[y * xlen + x]!;
  const xl = (i: number) => String(+(axes.x[i] ?? i).toFixed(0));
  const yl = (i: number) => String(+(axes.y[i] ?? i).toFixed(0));
  const rows = Array.from({ length: ylen }, (_, k) => ylen - 1 - k);
  const liveCell = live && { x: Math.round(live.fx), y: Math.round(live.fy) };
  const maxDiff = Math.max(1, ...a.tuned.map((v, i) => Math.abs(v - a.original[i]!)));

  function writeBack() {
    if (!original.current || !z) return;
    ve.current = original.current.slice();
    ed.commit(ve.current, 'orijinal VE geri yazıldı', false);
    reset(ve.current);
  }

  const zoom = cell ?? liveCell;

  return (
    <div className="rtla">
      <div className="rtla-bar panel">
        <select value={table.id3d} onChange={(e) => setTableId(e.target.value)}>
          {tables.map((t) => (
            <option key={t.id3d} value={t.id3d}>
              {t.title || t.id3d}
            </option>
          ))}
        </select>
        <button className={`tgl ${running ? 'on' : ''}`} onClick={() => setRunning(!running)} disabled={!feed}>
          <i /> Canlı analiz {running ? 'AÇIK' : 'KAPALI'}
        </button>
        <button
          className={`tgl warn ${autoTune ? 'on' : ''}`}
          onClick={() => setAutoTune(!autoTune)}
          title="Hesaplanan değerleri VE tablosuna (ECU RAM) yaz"
        >
          <i /> AutoTune {autoTune ? 'AÇIK' : 'KAPALI'}
        </button>
        <button onClick={() => reset()}>Tabloları sıfırla</button>
        <button onClick={() => void refreshFromModel()}>Modelden yenile</button>
        <button onClick={writeBack} title="AutoTune'un yazdıklarını geri al">
          Orijinali geri yaz
        </button>
        <span className={`rtla-msg ${message ? MSG_CLASS[message] : ''}`}>
          {message ? MSG_TEXT[message] : running ? 'Veri bekleniyor…' : 'Analiz durdu'}
        </span>
        <button className={`seg-like ${view3d ? 'on' : ''}`} onClick={() => setView3d(!view3d)}>
          {view3d ? '2B ızgara' : '3B yüzey'}
        </button>
      </div>

      <div className="rtla-stats">
        {(
          [
            ['Toplam', s.total],
            ['Aykırı', s.outliers],
            ['Filtrelenen', s.filtered],
            ['Değişen hücre', s.altered],
            ['Ort. değişim', s.avgChange.toFixed(1)],
            ['Maks. değişim', s.maxChange],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
        <div className={ed.pending ? 'busy' : ''}>
          <span>ECU</span>
          <b>{ed.pending ? `${ed.pending} bayt` : 'senkron'}</b>
        </div>
      </div>

      <div className="rtla-body">
        <div className="panel rtla-main">
          <div className="panel-head">
            <strong>Tune edilmiş {table.title}</strong>
            <span className="muted small">sağ tık: hücreyi atla / etkinleştir</span>
            <span className="status">{ed.status}</span>
          </div>
          {view3d ? (
            <div className="t3-host">
              <Table3D
                xlen={xlen}
                ylen={ylen}
                values={a.tuned}
                lo={Math.min(...a.tuned)}
                hi={Math.max(...a.tuned) + (Math.max(...a.tuned) === Math.min(...a.tuned) ? 1 : 0)}
                digits={digits}
                xLabels={axes.x.map((_, i) => xl(i))}
                yLabels={axes.y.map((_, i) => yl(i))}
                xTitle={table.xChannel ?? 'X'}
                yTitle={table.yChannel ?? 'Y'}
                zTitle={z.units || z.name}
                live={live}
                onSelect={(x, y) => setCell({ x, y })}
                onHover={() => undefined}
                onDrag={() => undefined}
              />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="ve rtla-grid">
                <tbody>
                  {rows.map((y) => (
                    <tr key={y}>
                      <th className="axis">{yl(y)}</th>
                      {Array.from({ length: xlen }, (_, x) => {
                        const i = y * xlen + x;
                        const cls = [`st-${a.state[i]}`];
                        if (a.skip[i]) cls.push('skip');
                        if (liveCell?.x === x && liveCell?.y === y) cls.push('live');
                        if (cell?.x === x && cell?.y === y) cls.push('cur');
                        return (
                          <td
                            key={x}
                            className={cls.join(' ')}
                            title={`${STATE_TEXT[a.state[i]!]} · ${a.count[i]} veri · orijinal ${a.original[i]}`}
                            onClick={() => setCell({ x, y })}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              a.toggleSkip(x, y);
                              setTick((t) => t + 1);
                            }}
                          >
                            {a.tuned[i]!.toFixed(digits)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <th className="axis corner" />
                    {axes.x.map((_, x) => (
                      <th key={x} className="axis">
                        {xl(x)}
                      </th>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <div className="rtla-legend">
            {(['empty', 'collecting', 'progress', 'tuned', 'toohigh', 'ahead'] as const).map((k) => (
              <span key={k}>
                <i className={`st-${k}`} /> {STATE_TEXT[k]}
              </span>
            ))}
          </div>
        </div>

        <aside className="rtla-side">
          <section className="panel">
            <h4>Yakın görünüm 3×3</h4>
            {zoom ? (
              <table className="rtla-zoom">
                <tbody>
                  {[1, 0, -1].map((dy) => (
                    <tr key={dy}>
                      {[-1, 0, 1].map((dx) => {
                        const x = zoom.x + dx;
                        const y = zoom.y + dy;
                        const ok = x >= 0 && y >= 0 && x < xlen && y < ylen;
                        const i = y * xlen + x;
                        return (
                          <td key={dx} className={ok ? `st-${a.state[i]} ${dx || dy ? '' : 'center'}` : 'off'}>
                            {ok && (
                              <>
                                <b>{at(a.tuned, x, y).toFixed(digits)}</b>
                                <small>
                                  {a.count[i]} · {at(a.original, x, y)}
                                </small>
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <span className="muted small">Canlı nokta bekleniyor</span>
            )}
          </section>

          <section className="panel">
            <h4>Veri sayısı</h4>
            <MiniGrid xlen={xlen} rows={rows} cell={(x, y) => {
              const c = at(a.count, x, y);
              return { text: c ? String(c) : '', cls: c ? (c >= settings.minData ? 'c-ok' : 'c-some') : '' };
            }} />
            <h4 className="mt">Fark (tune − orijinal)</h4>
            <MiniGrid xlen={xlen} rows={rows} cell={(x, y) => {
              const d = at(a.tuned, x, y) - at(a.original, x, y);
              const k = Math.min(1, Math.abs(d) / maxDiff);
              return {
                text: d ? (d > 0 ? `+${d}` : String(d)) : '',
                style: d ? { background: d > 0 ? `rgba(255,80,90,${0.2 + k * 0.7})` : `rgba(80,140,255,${0.2 + k * 0.7})` } : undefined,
              };
            }} />
          </section>

          <section className="panel rtla-settings">
            <h4>Ayarlar</h4>
            <div className="rtla-form">
              <label>Min / Maks RPM</label>
              <span>
                <input className="num short" value={settings.minRpm ?? ''} placeholder="—" onChange={(e) => set({ minRpm: num(e.target.value) })} />
                <input className="num short" value={settings.maxRpm ?? ''} placeholder="—" onChange={(e) => set({ maxRpm: num(e.target.value) })} />
              </span>
              <label>Min / Maks {table.yChannel}</label>
              <span>
                <input className="num short" value={settings.minLoad ?? ''} placeholder="—" onChange={(e) => set({ minLoad: num(e.target.value) })} />
                <input className="num short" value={settings.maxLoad ?? ''} placeholder="—" onChange={(e) => set({ maxLoad: num(e.target.value) })} />
              </span>
              <label>RPM / yük toleransı %</label>
              <span>
                <input className="num short" value={settings.rpmTolerance} onChange={(e) => set({ rpmTolerance: Number(e.target.value) || 0 })} />
                <input className="num short" value={settings.loadTolerance} onChange={(e) => set({ loadTolerance: Number(e.target.value) || 0 })} />
              </span>
              <label>Min. veri</label>
              <input className="num short" value={settings.minData} onChange={(e) => set({ minData: Math.max(1, Number(e.target.value) || 1) })} />
              <label>Tune hassasiyeti %</label>
              <input className="num short" value={settings.precision} onChange={(e) => set({ precision: Number(e.target.value) || 0 })} />
              <label>Maks. değişim + / −</label>
              <span>
                <input className="num short" value={settings.maxPos} onChange={(e) => set({ maxPos: Number(e.target.value) || 0 })} />
                <input className="num short" value={settings.maxNeg} onChange={(e) => set({ maxNeg: Number(e.target.value) || 0 })} />
              </span>
              <label>İleri tune</label>
              <span>
                <label className="check">
                  <input type="checkbox" checked={settings.aheadRight} onChange={(e) => set({ aheadRight: e.target.checked })} /> Sağa
                </label>
                <label className="check">
                  <input type="checkbox" checked={settings.aheadUp} onChange={(e) => set({ aheadUp: e.target.checked })} /> Yukarı
                </label>
              </span>
            </div>
            <h4 className="mt">İfade (sabit)</h4>
            <code className="rtla-expr">{VE_EXPRESSION}</code>
            <h4 className="mt">Filtre</h4>
            <textarea className="rtla-filter" value={filter} onChange={(e) => setFilter(e.target.value)} rows={3} />
            <button className="ghost" onClick={() => setFilter(VE_FILTER)}>
              Varsayılan filtre
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}

function MiniGrid({
  xlen,
  rows,
  cell,
}: {
  xlen: number;
  rows: number[];
  cell(x: number, y: number): { text: string; cls?: string; style?: React.CSSProperties };
}) {
  return (
    <table className="rtla-mini">
      <tbody>
        {rows.map((y) => (
          <tr key={y}>
            {Array.from({ length: xlen }, (_, x) => {
              const c = cell(x, y);
              return (
                <td key={x} className={c.cls} style={c.style}>
                  {c.text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
