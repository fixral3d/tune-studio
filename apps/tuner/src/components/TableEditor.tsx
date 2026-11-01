import { useEffect, useMemo, useRef, useState } from 'react';
import {
  array2dIndex,
  ConfigEvaluator,
  ecuIdForField,
  readArray,
  VemsClient,
  type ArrayField,
  type SiprDescriptor,
  type TableDesc,
  type VemsConfig,
} from '@vems/core';
import { heatCss, HEAT_GRADIENT } from '../lib/colormap';
import { Table3D, type CellRect } from './Table3D';
import type { RtSource } from './GaugePanel';
import { RealtimeFeed } from '../lib/realtime';
import { usePageEditor, writeUserClamped } from '../lib/pageEditor';
import { TableCompare3D } from './TableCompare3D';

/** anchor (ax, ay) + focus (fx, fy); the selection is the rectangle between them */
interface Sel {
  ax: number;
  ay: number;
  fx: number;
  fy: number;
}
type Layout = 'split' | '3d' | '2d';

const rectOf = (s: Sel): CellRect => ({
  xa: Math.min(s.ax, s.fx),
  xb: Math.max(s.ax, s.fx),
  ya: Math.min(s.ay, s.fy),
  yb: Math.max(s.ay, s.fy),
});

/** Fractional index of v within ascending bins (clamped to the table edges). */
function binFrac(bins: number[], v: number): number {
  const n = bins.length;
  if (n < 2 || v <= bins[0]!) return 0;
  for (let i = 0; i < n - 1; i++) {
    const a = bins[i]!;
    const b = bins[i + 1]!;
    if (v <= b) return i + (b === a ? 0 : (v - a) / (b - a));
  }
  return n - 1;
}

const fmtBin = (v: number | undefined, i: number) => (v === undefined ? String(i) : String(+v.toFixed(1)));

/** Generic 3D table editor driven by a TableDesc (VE, ignition, boost, …). */
export function TableEditor({
  client,
  config,
  table,
  feed,
}: {
  client: VemsClient;
  config: VemsConfig;
  table: TableDesc;
  feed?: RtSource;
}) {
  const z = table.zSym ? (config.byName.get(table.zSym) as ArrayField | undefined) : undefined;
  const xField = table.xSym ? (config.byName.get(table.xSym) as ArrayField | undefined) : undefined;
  const yField = table.ySym ? (config.byName.get(table.ySym) as ArrayField | undefined) : undefined;
  const ecuId = z ? ecuIdForField(config, z) : undefined;

  const [axisPages, setAxisPages] = useState<Map<number, Uint8Array>>();
  const [sel, setSel] = useState<Sel>();
  const [hover, setHover] = useState<{ x: number; y: number }>();
  const [preview, setPreview] = useState<number[]>();
  const [liveRaw, setLiveRaw] = useState<{ xv: number; yv: number }>();
  const [follow, setFollow] = useState(false);
  const [layout, setLayout] = useState<Layout>('split');
  const [entry, setEntry] = useState('');
  const [pct, setPct] = useState('5');

  const root = useRef<HTMLDivElement>(null);
  const entryRef = useRef<HTMLInputElement>(null);
  const ed = usePageEditor(client, ecuId, feed instanceof RealtimeFeed ? feed.pages : undefined, z?.page);
  const { page, setStatus, commit, undo, redo } = ed;
  const gridDrag = useRef(false);

  useEffect(() => {
    ed.load(undefined);
    setAxisPages(undefined);
    setSel(undefined);
    setPreview(undefined);
    setStatus('');
    if (!z || ecuId === undefined) return;
    let alive = true;
    const ids = new Set([ecuId]);
    for (const f of [xField, yField]) {
      const id = f && ecuIdForField(config, f);
      if (id !== undefined) ids.add(id);
    }
    Promise.all([...ids].map(async (id) => [id, await client.readPage(id)] as const))
      .then((list) => {
        if (!alive) return;
        const m = new Map(list);
        const pg = m.get(ecuId)!;
        setAxisPages(m);
        ed.load(pg);
        setSel({ ax: 0, ay: 0, fx: 0, fy: 0 });
        root.current?.focus();
      })
      .catch((e) => alive && setStatus(`okuma hatası: ${(e as Error).message}`));
    return () => {
      alive = false;
    };
  }, [client, config, z, xField, yField, ecuId]);

  // live operating point from the realtime feed (or log replay)
  useEffect(() => {
    setLiveRaw(undefined);
    const xc = table.xChannel;
    const yc = table.yChannel;
    if (!feed || !xc || !yc) return;
    const ev = new ConfigEvaluator(config);
    return feed.subscribe(({ data }) => {
      try {
        ev.reset({ realtime: data, pages: feed.pages, extra: { time: Date.now() / 1000 } });
        const xv = ev.value(xc);
        const yv = ev.value(yc);
        if (xv !== undefined && yv !== undefined) setLiveRaw({ xv, yv });
      } catch {
        /* channel not evaluable for this firmware */
      }
    });
  }, [feed, config, table]);

  const xlen = z?.shape.dims[0] ?? 0;
  const ylen = z?.shape.dims[1] ?? 0;

  const axes = useMemo(() => {
    const read = (f?: ArrayField) => {
      const id = f && ecuIdForField(config, f);
      const pg = id !== undefined ? axisPages?.get(id) : undefined;
      return f && pg ? readArray(pg, f) : [];
    };
    return { x: read(xField), y: read(yField) };
  }, [axisPages, config, xField, yField]);

  // committed values in logical order: index y*xlen + x
  const committed = useMemo(() => {
    if (!page || !z) return [];
    const mem = readArray(page, z);
    const out = new Array<number>(xlen * ylen);
    for (let y = 0; y < ylen; y++) for (let x = 0; x < xlen; x++) out[y * xlen + x] = mem[array2dIndex(z, x, y)]!;
    return out;
  }, [page, z, xlen, ylen]);
  const cells = preview ?? committed;

  const range = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of cells) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!Number.isFinite(lo)) return { lo: 0, hi: 1 };
    return hi === lo ? { lo: lo - 1, hi: hi + 1 } : { lo, hi };
  }, [cells]);

  const live = useMemo(
    () =>
      liveRaw && axes.x.length && axes.y.length
        ? { fx: binFrac(axes.x.slice(0, xlen), liveRaw.xv), fy: binFrac(axes.y.slice(0, ylen), liveRaw.yv) }
        : undefined,
    [liveRaw, axes, xlen, ylen],
  );
  const liveCell = live && { x: Math.round(live.fx), y: Math.round(live.fy) };

  useEffect(() => {
    if (follow && liveCell) setSel({ ax: liveCell.x, ay: liveCell.y, fx: liveCell.x, fy: liveCell.y });
  }, [follow, liveCell?.x, liveCell?.y]);

  const xLabels = useMemo(() => Array.from({ length: xlen }, (_, i) => fmtBin(axes.x[i], i)), [axes, xlen]);
  const yLabels = useMemo(() => Array.from({ length: ylen }, (_, i) => fmtBin(axes.y[i], i)), [axes, ylen]);

  if (!z || z.kind !== 'array' || z.shape.dims.length !== 2)
    return <div className="panel">Bu tablo 2B düzenleyici ile açılamıyor.</div>;
  if (ecuId === undefined) return <div className="panel">Bu tablonun ECU sayfası eşlenemedi.</div>;
  if (!page) return <div className="panel">{ed.status || `${table.title} yükleniyor…`}</div>;

  const zf = z;
  const digits = zf.digits;
  const step = Math.max(Math.abs(zf.scale), 10 ** -digits);
  const rect = sel && rectOf(sel);
  const count = rect ? (rect.xb - rect.xa + 1) * (rect.yb - rect.ya + 1) : 0;
  const at = (x: number, y: number) => cells[y * xlen + x]!;
  const xTitle = table.xChannel ?? xField?.name ?? 'X';
  const yTitle = table.yChannel ?? yField?.name ?? 'Y';
  const zTitle = zf.units || zf.name;

  const setUser = (buf: Uint8Array, x: number, y: number, v: number) =>
    writeUserClamped(buf, zf, array2dIndex(zf, x, y), v);

  function apply(fn: (v: number, x: number, y: number) => number, msg: string) {
    if (!rect) return;
    const next = page!.slice();
    for (let y = rect.ya; y <= rect.yb; y++) for (let x = rect.xa; x <= rect.xb; x++) setUser(next, x, y, fn(at(x, y), x, y));
    commit(next, `${msg} · ${count} hücre`);
  }

  const add = (k: number) => apply((v) => v + k * step, `${k > 0 ? '+' : '−'}${+(Math.abs(k) * step).toFixed(digits + 2)}`);
  const setAll = (v: number) => apply(() => v, `= ${v}`);
  const scaleBy = (p: number) => apply((v) => v * (1 + p / 100), `×${(1 + p / 100).toFixed(3)}`);

  function interpolate() {
    if (!rect) return;
    const { xa, xb, ya, yb } = rect;
    const c00 = at(xa, ya);
    const c10 = at(xb, ya);
    const c01 = at(xa, yb);
    const c11 = at(xb, yb);
    apply((_, x, y) => {
      const tx = xb === xa ? 0 : (x - xa) / (xb - xa);
      const ty = yb === ya ? 0 : (y - ya) / (yb - ya);
      return c00 * (1 - tx) * (1 - ty) + c10 * tx * (1 - ty) + c01 * (1 - tx) * ty + c11 * tx * ty;
    }, 'interpolasyon');
  }

  function smooth() {
    apply((v, x, y) => {
      let sum = v * 2;
      let w = 2;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < xlen && ny < ylen) {
            sum += at(nx, ny);
            w++;
          }
        }
      return sum / w;
    }, 'yumuşatma');
  }

  // clipboard: rows top→bottom as shown in the grid (highest y first), tab separated
  async function copy() {
    if (!rect) return;
    const rows: string[] = [];
    for (let y = rect.yb; y >= rect.ya; y--) {
      const r: string[] = [];
      for (let x = rect.xa; x <= rect.xb; x++) r.push(at(x, y).toFixed(digits));
      rows.push(r.join('\t'));
    }
    await navigator.clipboard.writeText(rows.join('\n'));
    setStatus(`kopyalandı · ${count} hücre`);
  }
  async function paste() {
    if (!rect) return;
    const text = await navigator.clipboard.readText();
    const rows = text
      .trim()
      .split(/\r?\n/)
      .map((r) => r.split(/\t|;|\s+/).map((c) => parseFloat(c.replace(',', '.'))));
    const next = page!.slice();
    let n = 0;
    rows.forEach((r, ri) =>
      r.forEach((v, ci) => {
        const x = rect.xa + ci;
        const y = rect.yb - ri;
        if (Number.isFinite(v) && x < xlen && y >= 0) {
          setUser(next, x, y, v);
          n++;
        }
      }),
    );
    if (n) commit(next, `yapıştırıldı · ${n} hücre`);
  }

  function onDrag(delta: number, done: boolean) {
    if (!rect) return;
    const d = Math.round(delta / step) * step;
    if (!done) {
      const pv = committed.slice();
      for (let y = rect.ya; y <= rect.yb; y++)
        for (let x = rect.xa; x <= rect.xb; x++) {
          let v = committed[y * xlen + x]! + d;
          if (zf.hi > zf.lo) v = Math.max(zf.lo, Math.min(zf.hi, v));
          pv[y * xlen + x] = v;
        }
      setPreview(pv);
      return;
    }
    setPreview(undefined);
    if (d) {
      const next = page!.slice();
      for (let y = rect.ya; y <= rect.yb; y++)
        for (let x = rect.xa; x <= rect.xb; x++) setUser(next, x, y, committed[y * xlen + x]! + d);
      commit(next, `sürükle ${d > 0 ? '+' : ''}${+d.toFixed(digits + 2)} · ${count} hücre`);
    }
  }

  function moveFocus(dx: number, dy: number, extend: boolean) {
    const s = sel ?? { ax: 0, ay: 0, fx: 0, fy: 0 };
    const fx = Math.max(0, Math.min(xlen - 1, s.fx + dx));
    const fy = Math.max(0, Math.min(ylen - 1, s.fy + dy));
    setSel(extend ? { ...s, fx, fy } : { ax: fx, ay: fy, fx, fy });
  }

  function onKey(e: React.KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    let handled = true;
    if (k === 'ArrowUp') moveFocus(0, 1, e.shiftKey);
    else if (k === 'ArrowDown') moveFocus(0, -1, e.shiftKey);
    else if (k === 'ArrowLeft') moveFocus(-1, 0, e.shiftKey);
    else if (k === 'ArrowRight') moveFocus(1, 0, e.shiftKey);
    else if (ctrl && k.toLowerCase() === 'z') e.shiftKey ? redo() : undo();
    else if (ctrl && k.toLowerCase() === 'y') redo();
    else if (ctrl && k.toLowerCase() === 'c') void copy();
    else if (ctrl && k.toLowerCase() === 'v') void paste();
    else if (ctrl && k.toLowerCase() === 'a') setSel({ ax: 0, ay: 0, fx: xlen - 1, fy: ylen - 1 });
    else if (ctrl) handled = false;
    else if (k === '+' || k === '=') add(1);
    else if (k === '-') add(-1);
    else if (k === 'PageUp') add(10);
    else if (k === 'PageDown') add(-10);
    else if (k === 'i' || k === 'I') interpolate();
    else if (k === 's' || k === 'S') smooth();
    else if (k === 'f' || k === 'F') setFollow((f) => !f);
    else if (/^[0-9.,]$/.test(k)) {
      setEntry(k === ',' ? '.' : k);
      entryRef.current?.focus();
    } else handled = false;
    if (handled) e.preventDefault();
  }

  function submitEntry() {
    const v = parseFloat(entry.replace(',', '.'));
    if (Number.isFinite(v)) setAll(v);
    setEntry('');
    root.current?.focus();
  }

  const inRect = (x: number, y: number) => !!rect && x >= rect.xa && x <= rect.xb && y >= rect.ya && y <= rect.yb;
  const focusVal = sel ? at(sel.fx, sel.fy) : undefined;
  const liveVal =
    live &&
    (() => {
      const x0 = Math.floor(live.fx);
      const y0 = Math.floor(live.fy);
      const x1 = Math.min(xlen - 1, x0 + 1);
      const y1 = Math.min(ylen - 1, y0 + 1);
      const tx = live.fx - x0;
      const ty = live.fy - y0;
      return (
        at(x0, y0) * (1 - tx) * (1 - ty) + at(x1, y0) * tx * (1 - ty) + at(x0, y1) * (1 - tx) * ty + at(x1, y1) * tx * ty
      );
    })();

  return (
    <div className="panel te" ref={root} tabIndex={0} onKeyDown={onKey}>
      <div className="panel-head">
        <strong>{table.title}</strong>
        <span className="muted">
          {xlen}×{ylen} · {zf.name} · ecu {ecuId}
        </span>
        <div className="seg">
          {(['split', '3d', '2d'] as const).map((l) => (
            <button key={l} className={layout === l ? 'on' : ''} onClick={() => setLayout(l)}>
              {l === 'split' ? 'Bölünmüş' : l === '3d' ? '3B' : '2B'}
            </button>
          ))}
        </div>
        <span className="status">{ed.status}</span>
      </div>

      {layout !== '2d' && (
        <div className={layout === '3d' ? 't3-host tall' : 't3-host'}>
          <Table3D
            xlen={xlen}
            ylen={ylen}
            values={cells}
            lo={range.lo}
            hi={range.hi}
            digits={digits}
            xLabels={xLabels}
            yLabels={yLabels}
            xTitle={xTitle}
            yTitle={yTitle}
            zTitle={zTitle}
            sel={rect}
            live={live}
            onSelect={(x, y, extend) => {
              setSel((s) => (extend && s ? { ...s, fx: x, fy: y } : { ax: x, ay: y, fx: x, fy: y }));
              root.current?.focus();
            }}
            onHover={setHover}
            onDrag={onDrag}
          />
        </div>
      )}

      <div className={layout === '2d' || layout === 'split' ? 'te-body' : 'te-body solo'}>
        {layout !== '3d' && (
          <div className="table-wrap" onMouseUp={() => (gridDrag.current = false)} onMouseLeave={() => (gridDrag.current = false)}>
            <table className="ve">
              <tbody>
                {Array.from({ length: ylen }, (_, yi) => {
                  const y = ylen - 1 - yi;
                  return (
                    <tr key={y}>
                      <th className="axis">{yLabels[y]}</th>
                      {Array.from({ length: xlen }, (_, x) => {
                        const v = at(x, y);
                        const cls = ['cell'];
                        if (inRect(x, y)) cls.push('in-sel');
                        if (sel?.fx === x && sel?.fy === y) cls.push('sel');
                        if (hover?.x === x && hover?.y === y) cls.push('hov');
                        if (liveCell?.x === x && liveCell?.y === y) cls.push('live');
                        return (
                          <td
                            key={x}
                            className={cls.join(' ')}
                            style={{ background: heatCss((v - range.lo) / (range.hi - range.lo)) }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              root.current?.focus();
                              gridDrag.current = true;
                              setSel((s) => (e.shiftKey && s ? { ...s, fx: x, fy: y } : { ax: x, ay: y, fx: x, fy: y }));
                            }}
                            onMouseEnter={() => gridDrag.current && setSel((s) => s && { ...s, fx: x, fy: y })}
                            onDoubleClick={() => {
                              setEntry(v.toFixed(digits));
                              entryRef.current?.focus();
                              entryRef.current?.select();
                            }}
                          >
                            {v.toFixed(digits)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr>
                  <th className="axis corner">
                    <span className="muted small">
                      {yTitle}↑ {xTitle}→
                    </span>
                  </th>
                  {xLabels.map((l, x) => (
                    <th key={x} className="axis">
                      {l}
                    </th>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <aside className="te-side">
          <section>
            <h4>Seçim</h4>
            {rect && sel ? (
              <div className="kv">
                <span>Hücre</span>
                <b>
                  [{sel.fx},{sel.fy}] {count > 1 && <span className="muted">· {count} hücre</span>}
                </b>
                <span>{xTitle}</span>
                <b>{xLabels[sel.fx]}</b>
                <span>{yTitle}</span>
                <b>{yLabels[sel.fy]}</b>
                <span>Değer</span>
                <b className="big">
                  {focusVal?.toFixed(digits)} <span className="muted small">{zf.units}</span>
                </b>
              </div>
            ) : (
              <span className="muted">Hücre seç</span>
            )}
          </section>

          <section>
            <h4>Düzenle</h4>
            <div className="row">
              <input
                ref={entryRef}
                className="num"
                value={entry}
                placeholder="değer"
                onChange={(e) => setEntry(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitEntry();
                  if (e.key === 'Escape') {
                    setEntry('');
                    root.current?.focus();
                  }
                }}
              />
              <button onClick={submitEntry} disabled={!rect}>
                Ayarla
              </button>
            </div>
            <div className="row">
              <button onClick={() => add(-10)} title="PageDown">−10</button>
              <button onClick={() => add(-1)} title="−">−</button>
              <button onClick={() => add(1)} title="+">+</button>
              <button onClick={() => add(10)} title="PageUp">+10</button>
            </div>
            <div className="row">
              <input className="num short" value={pct} onChange={(e) => setPct(e.target.value)} />
              <span className="muted">%</span>
              <button onClick={() => scaleBy(parseFloat(pct) || 0)}>Artır</button>
              <button onClick={() => scaleBy(-(parseFloat(pct) || 0))}>Azalt</button>
            </div>
            <div className="row">
              <button onClick={interpolate} title="I">İnterpole</button>
              <button onClick={smooth} title="S">Yumuşat</button>
            </div>
            <div className="row">
              <button onClick={undo} disabled={!ed.canUndo} title="Ctrl+Z">↶ Geri</button>
              <button onClick={redo} disabled={!ed.canRedo} title="Ctrl+Y">↷ Yinele</button>
              <button onClick={copy} title="Ctrl+C">Kopyala</button>
              <button onClick={paste} title="Ctrl+V">Yapıştır</button>
            </div>
          </section>

          <section>
            <h4>Canlı nokta</h4>
            {liveRaw ? (
              <div className="kv">
                <span>{table.xChannel}</span>
                <b>{liveRaw.xv.toFixed(0)}</b>
                <span>{table.yChannel}</span>
                <b>{liveRaw.yv.toFixed(0)}</b>
                <span>Tablo</span>
                <b className="live-val">{liveVal?.toFixed(digits)}</b>
              </div>
            ) : (
              <span className="muted small">{feed ? 'veri bekleniyor…' : 'canlı veri yok'}</span>
            )}
            <label className="check">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Seçim canlı
              hücreyi takip etsin (F)
            </label>
          </section>

          <section>
            <div className="legend" style={{ background: HEAT_GRADIENT }} />
            <div className="legend-lab">
              <span>{range.lo.toFixed(digits)}</span>
              <span>{range.hi.toFixed(digits)}</span>
            </div>
            <div className={ed.pending ? 'sync busy' : 'sync'}>
              {ed.pending ? `ECU'ya yazılıyor · ${ed.pending} bayt` : '● ECU RAM ile senkron'}
            </div>
            <div className="muted small keys">
              Oklar: gez · Shift+ok: alan · +/−, PgUp/PgDn: adım · rakam yaz + Enter: değer · I: interpole · S:
              yumuşat · Ctrl+A/C/V/Z/Y
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Table picker + editor: lists every 2D table and edits the selected one. */
export function TablesPanel({
  client,
  config,
  feed,
  request,
  sipr,
  firmware,
}: {
  client: VemsClient;
  config: VemsConfig;
  feed?: RtSource;
  /** open this table (from the command palette); a new object re-triggers */
  request?: { id: string; compare?: boolean };
  sipr?: SiprDescriptor;
  firmware?: string;
}) {
  const tables = useMemo(
    () =>
      [...config.tables.values()].filter((t) => {
        const z = t.zSym ? config.byName.get(t.zSym) : undefined;
        return z?.kind === 'array' && z.shape.dims.length === 2 && ecuIdForField(config, z) !== undefined;
      }),
    [config],
  );
  const [id, setId] = useState(request?.id ?? tables[0]?.id3d ?? '');
  const [compare, setCompare] = useState(!!request?.compare);
  useEffect(() => {
    if (request) {
      setId(request.id);
      setCompare(!!request.compare);
    }
  }, [request]);
  const table = config.tables.get(id) ?? tables[0];

  if (tables.length === 0) return <div className="panel">Düzenlenebilir 2B tablo bulunamadı.</div>;

  return (
    <div className="stack">
      <div className="picker">
        <label>Tablo:</label>
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {tables.map((t) => (
            <option key={t.id3d} value={t.id3d}>
              {t.title || t.id3d}
            </option>
          ))}
        </select>
        <div className="seg">
          <button className={compare ? '' : 'on'} onClick={() => setCompare(false)}>
            Düzenle
          </button>
          <button className={compare ? 'on' : ''} onClick={() => setCompare(true)} title="Table Compare 3D: iki tune'u üst üste">
            Karşılaştır 3D
          </button>
        </div>
      </div>
      {table &&
        (compare ? (
          <TableCompare3D key={table.id3d} client={client} config={config} table={table} sipr={sipr} firmware={firmware} />
        ) : (
          <TableEditor key={table.id3d} client={client} config={config} table={table} feed={feed} />
        ))}
    </div>
  );
}
