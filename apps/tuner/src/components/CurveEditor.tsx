import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  curveSequenceBins,
  ecuIdForField,
  readArray,
  VemsClient,
  type ArrayField,
  type CurveDesc,
  type VemsConfig,
} from '@vems/core';
import { heatCss, HEAT_GRADIENT } from '../lib/colormap';
import { useChannels, type RtSource } from '../lib/gauges';
import { usePageEditor, writeUserClamped } from '../lib/pageEditor';
import { RealtimeFeed } from '../lib/realtime';

const PAD = { l: 58, r: 22, t: 22, b: 40 };
const H = 360;

/** Fractional index of v within ascending bins (clamped). */
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

/** Width of an element via a callback ref (the element mounts only after the page loads). */
function useWidth() {
  const [w, setW] = useState(800);
  const ro = useRef<ResizeObserver>();
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    ro.current = new ResizeObserver(() => setW(el.clientWidth));
    ro.current.observe(el);
    setW(el.clientWidth);
  }, []);
  return [ref, w] as const;
}

/** 2D curve editor: draggable points, live operating point, VemsTune-style value row. */
export function CurveEditor({
  client,
  config,
  curve,
  feed,
}: {
  client: VemsClient;
  config: VemsConfig;
  curve: CurveDesc;
  feed?: RtSource;
}) {
  const yF = curve.ySym ? (config.byName.get(curve.ySym) as ArrayField | undefined) : undefined;
  const xF = curve.xSym ? (config.byName.get(curve.xSym) as ArrayField | undefined) : undefined;
  const ecuId = yF ? ecuIdForField(config, yF) : undefined;
  const ed = usePageEditor(client, ecuId, feed instanceof RealtimeFeed ? feed.pages : undefined, yF?.page);
  const { page, commit, undo, redo, setStatus } = ed;

  const [xPage, setXPage] = useState<Uint8Array>();
  const [sel, setSel] = useState<{ a: number; f: number }>({ a: 0, f: 0 });
  const [hover, setHover] = useState<number>();
  const [preview, setPreview] = useState<number[]>();
  const [entry, setEntry] = useState('');
  const [pct, setPct] = useState('5');
  const root = useRef<HTMLDivElement>(null);
  const entryRef = useRef<HTMLInputElement>(null);
  const rowDrag = useRef(false);
  const drag = useRef<{ y0: number; moved: boolean }>();
  const [chartRef, W] = useWidth();

  useEffect(() => {
    ed.load(undefined);
    setXPage(undefined);
    setSel({ a: 0, f: 0 });
    if (!yF || ecuId === undefined) return;
    let alive = true;
    const xId = xF ? ecuIdForField(config, xF) : undefined;
    Promise.all([client.readPage(ecuId), xId !== undefined && xId !== ecuId ? client.readPage(xId) : undefined])
      .then(([pg, xp]) => {
        if (!alive) return;
        ed.load(pg);
        setXPage(xp ?? pg);
        root.current?.focus();
      })
      .catch((e) => alive && setStatus(`okuma hatası: ${(e as Error).message}`));
    return () => {
      alive = false;
    };
  }, [client, config, yF, xF, ecuId]);

  const n = yF?.shape.dims[0] ?? 0;
  const committed = useMemo(() => (page && yF ? readArray(page, yF).slice(0, n) : []), [page, yF, n]);
  const values = preview ?? committed;
  const bins = useMemo(
    () => curveSequenceBins(curve, n) ?? (xPage && xF ? readArray(xPage, xF).slice(0, n) : []),
    [curve, xPage, xF, n],
  );
  const ascending = bins.length === n && bins.every((b, i) => i === 0 || b > bins[i - 1]!);

  const { values: live } = useChannels(feed, config, curve.xChannel ? [curve.xChannel] : [], 2);
  const liveX = curve.xChannel ? live[curve.xChannel] : undefined;

  if (!yF || yF.kind !== 'array') return <div className="panel">Bu eğri düzenlenemiyor.</div>;
  if (ecuId === undefined) return <div className="panel">Eğrinin ECU sayfası eşlenemedi.</div>;
  if (!page) return <div className="panel">{ed.status || `${curve.title} yükleniyor…`}</div>;

  const f = yF;
  const digits = f.digits;
  const step = Math.max(Math.abs(f.scale), 10 ** -digits);
  const lo = Math.min(sel.a, sel.f);
  const hi = Math.max(sel.a, sel.f);
  const count = hi - lo + 1;
  const xTitle = curve.xLabel || curve.xChannel || xF?.name || 'X';
  const yTitle = curve.yLabel || f.units || f.name;
  const xLabel = (i: number) => (bins[i] === undefined ? String(i) : String(+bins[i]!.toFixed(xF?.digits ?? 1)));

  // ── geometry ───────────────────────────────────────────────────────────
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const v of values) {
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }
  if (!Number.isFinite(vmin)) [vmin, vmax] = [0, 1];
  if (vmax === vmin) [vmin, vmax] = [vmin - 1, vmax + 1];
  const padV = (vmax - vmin) * 0.12;
  const y0 = vmin - padV;
  const y1 = vmax + padV;
  const pw = Math.max(100, W - PAD.l - PAD.r);
  const ph = H - PAD.t - PAD.b;
  const px = (i: number) =>
    PAD.l + (ascending && n > 1 ? ((bins[i]! - bins[0]!) / (bins[n - 1]! - bins[0]! || 1)) * pw : (i / Math.max(1, n - 1)) * pw);
  const pxFrac = (fi: number) => {
    const i = Math.min(n - 2, Math.max(0, Math.floor(fi)));
    return n < 2 ? PAD.l : px(i) + (px(i + 1) - px(i)) * (fi - i);
  };
  const py = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0)) * ph;
  const norm = (v: number) => (v - vmin) / (vmax - vmin || 1);
  const line = values.map((v, i) => `${px(i)},${py(v)}`).join(' ');
  const ticks = Array.from({ length: 6 }, (_, k) => y0 + ((y1 - y0) * k) / 5);

  const liveFrac = liveX !== undefined && bins.length === n ? binFrac(bins, liveX) : undefined;
  const liveVal =
    liveFrac === undefined
      ? undefined
      : (() => {
          const i = Math.min(n - 1, Math.floor(liveFrac));
          const j = Math.min(n - 1, i + 1);
          return values[i]! + (values[j]! - values[i]!) * (liveFrac - i);
        })();
  const liveIdx = liveFrac === undefined ? undefined : Math.round(liveFrac);

  // ── edits ──────────────────────────────────────────────────────────────
  function apply(fn: (v: number, i: number) => number, msg: string) {
    const next = page!.slice();
    for (let i = lo; i <= hi; i++) writeUserClamped(next, f, i, fn(committed[i]!, i));
    commit(next, `${msg} · ${count} nokta`);
  }
  const add = (k: number) => apply((v) => v + k * step, `${k > 0 ? '+' : '−'}${+(Math.abs(k) * step).toFixed(digits + 2)}`);
  const setAll = (v: number) => apply(() => v, `= ${v}`);
  const scaleBy = (p: number) => apply((v) => v * (1 + p / 100), `×${(1 + p / 100).toFixed(3)}`);
  const interpolate = () => {
    const a = committed[lo]!;
    const b = committed[hi]!;
    apply((_, i) => (hi === lo ? a : a + ((b - a) * (i - lo)) / (hi - lo)), 'interpolasyon');
  };
  const smooth = () =>
    apply((v, i) => {
      const l = committed[Math.max(0, i - 1)]!;
      const r = committed[Math.min(n - 1, i + 1)]!;
      return (l + 2 * v + r) / 4;
    }, 'yumuşatma');

  async function copy() {
    await navigator.clipboard.writeText(committed.slice(lo, hi + 1).map((v) => v.toFixed(digits)).join('\t'));
    setStatus(`kopyalandı · ${count} nokta`);
  }
  async function paste() {
    const nums = (await navigator.clipboard.readText())
      .trim()
      .split(/[\t;\s]+/)
      .map((c) => parseFloat(c.replace(',', '.')))
      .filter(Number.isFinite);
    if (!nums.length) return;
    const next = page!.slice();
    nums.forEach((v, k) => lo + k < n && writeUserClamped(next, f, lo + k, v));
    commit(next, `yapıştırıldı · ${Math.min(nums.length, n - lo)} nokta`);
  }

  function select(i: number, extend: boolean) {
    setSel((s) => (extend ? { ...s, f: i } : { a: i, f: i }));
    root.current?.focus();
  }

  function onPointDown(e: React.PointerEvent, i: number) {
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) return select(i, true);
    if (i < lo || i > hi) select(i, false);
    drag.current = { y0: e.clientY, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function dragDelta(e: React.PointerEvent) {
    const d = ((drag.current!.y0 - e.clientY) / ph) * (y1 - y0);
    return Math.round(d / step) * step;
  }
  function onPointMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const d = dragDelta(e);
    if (!d && !drag.current.moved) return;
    drag.current.moved = true;
    const s0 = Math.min(sel.a, sel.f);
    const s1 = Math.max(sel.a, sel.f);
    setPreview(
      committed.map((v, i) => {
        if (i < s0 || i > s1) return v;
        const u = v + d;
        return f.hi > f.lo ? Math.max(f.lo, Math.min(f.hi, u)) : u;
      }),
    );
  }
  function onPointUp(e: React.PointerEvent) {
    if (!drag.current) return;
    const d = drag.current.moved ? dragDelta(e) : 0;
    drag.current = undefined;
    setPreview(undefined);
    if (d) apply((v) => v + d, `sürükle ${d > 0 ? '+' : ''}${+d.toFixed(digits + 2)}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    let handled = true;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const fi = Math.max(0, Math.min(n - 1, sel.f + (k === 'ArrowLeft' ? -1 : 1)));
      setSel(e.shiftKey ? { ...sel, f: fi } : { a: fi, f: fi });
    } else if (k === 'ArrowUp' && !ctrl) add(1);
    else if (k === 'ArrowDown' && !ctrl) add(-1);
    else if (ctrl && k.toLowerCase() === 'z') e.shiftKey ? redo() : undo();
    else if (ctrl && k.toLowerCase() === 'y') redo();
    else if (ctrl && k.toLowerCase() === 'c') void copy();
    else if (ctrl && k.toLowerCase() === 'v') void paste();
    else if (ctrl && k.toLowerCase() === 'a') setSel({ a: 0, f: n - 1 });
    else if (ctrl) handled = false;
    else if (k === '+' || k === '=') add(1);
    else if (k === '-') add(-1);
    else if (k === 'PageUp') add(10);
    else if (k === 'PageDown') add(-10);
    else if (k === 'i' || k === 'I') interpolate();
    else if (k === 's' || k === 'S') smooth();
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

  const xEvery = Math.max(1, Math.ceil((n * 46) / pw));

  return (
    <div className="panel te ce" ref={root} tabIndex={0} onKeyDown={onKey}>
      <div className="panel-head">
        <strong>{curve.title}</strong>
        <span className="muted">
          {f.name} · {n} nokta · ecu {ecuId}
          {!ascending && bins.length > 0 && ' · eksen sıralı değil (indeks aralıklı)'}
        </span>
        <span className="status">{ed.status}</span>
      </div>

      <div className="te-body">
        <div className="ce-left">
          <div className="ce-chart" ref={chartRef}>
            <svg width={W} height={H} onPointerMove={onPointMove} onPointerUp={onPointUp}>
              <defs>
                <linearGradient id="ce-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#3ee6c1" stopOpacity={0.28} />
                  <stop offset="1" stopColor="#3ee6c1" stopOpacity={0} />
                </linearGradient>
                <filter id="ce-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {ticks.map((t, k) => (
                <g key={k}>
                  <line x1={PAD.l} x2={PAD.l + pw} y1={py(t)} y2={py(t)} className="ce-grid" />
                  <text x={PAD.l - 8} y={py(t)} className="ce-ylab" textAnchor="end" dominantBaseline="central">
                    {t.toFixed(digits)}
                  </text>
                </g>
              ))}
              {values.map((_, i) => (
                <g key={i}>
                  <line x1={px(i)} x2={px(i)} y1={PAD.t} y2={PAD.t + ph} className="ce-grid v" />
                  {i % xEvery === 0 && (
                    <text x={px(i)} y={PAD.t + ph + 16} className="ce-xlab" textAnchor="middle">
                      {xLabel(i)}
                    </text>
                  )}
                </g>
              ))}
              <text x={PAD.l + pw} y={H - 4} className="ce-axis" textAnchor="end">
                {xTitle} →
              </text>
              <text x={PAD.l - 50} y={PAD.t - 8} className="ce-axis">
                {yTitle}
                {f.units && curve.yLabel ? ` (${f.units})` : ''}
              </text>
              {lo <= hi && (
                <rect
                  x={px(lo) - 10}
                  y={PAD.t}
                  width={px(hi) - px(lo) + 20}
                  height={ph}
                  className="ce-selband"
                  rx={8}
                />
              )}
              <polygon points={`${px(0)},${PAD.t + ph} ${line} ${px(n - 1)},${PAD.t + ph}`} fill="url(#ce-area)" />
              <polyline points={line} className="ce-line" filter="url(#ce-glow)" />
              {liveFrac !== undefined && liveVal !== undefined && (
                <g className="ce-live">
                  <line x1={pxFrac(liveFrac)} x2={pxFrac(liveFrac)} y1={PAD.t} y2={PAD.t + ph} />
                  <circle cx={pxFrac(liveFrac)} cy={py(liveVal)} r={7} />
                  <text
                    x={pxFrac(liveFrac) + (pxFrac(liveFrac) > PAD.l + pw * 0.7 ? -10 : 10)}
                    y={PAD.t + 12}
                    textAnchor={pxFrac(liveFrac) > PAD.l + pw * 0.7 ? 'end' : 'start'}
                  >
                    {xTitle} {liveX!.toFixed(0)} → {liveVal.toFixed(digits)}
                  </text>
                </g>
              )}
              {values.map((v, i) => {
                const on = i >= lo && i <= hi;
                return (
                  <g
                    key={i}
                    className={`ce-pt ${on ? 'on' : ''} ${hover === i ? 'hov' : ''}`}
                    onPointerDown={(e) => onPointDown(e, i)}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(undefined)}
                  >
                    <circle cx={px(i)} cy={py(v)} r={16} className="hit" />
                    <circle cx={px(i)} cy={py(v)} r={on ? 7.5 : 5.5} fill={heatCss(norm(v))} />
                    {(on || hover === i) && (
                      <text x={px(i)} y={py(v) - 14} textAnchor="middle" className="ce-vlab">
                        {v.toFixed(digits)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="table-wrap" onMouseUp={() => (rowDrag.current = false)} onMouseLeave={() => (rowDrag.current = false)}>
            <table className="ve ce-row">
              <tbody>
                <tr>
                  <th className="axis corner">{xTitle}</th>
                  {values.map((_, i) => (
                    <th key={i} className="axis">
                      {xLabel(i)}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="axis corner">{f.units || 'değer'}</th>
                  {values.map((v, i) => {
                    const cls = ['cell'];
                    if (i >= lo && i <= hi) cls.push('in-sel');
                    if (i === sel.f) cls.push('sel');
                    if (i === hover) cls.push('hov');
                    if (i === liveIdx) cls.push('live');
                    return (
                      <td
                        key={i}
                        className={cls.join(' ')}
                        style={{ background: heatCss(norm(v)) }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          rowDrag.current = true;
                          select(i, e.shiftKey);
                        }}
                        onMouseEnter={() => {
                          setHover(i);
                          if (rowDrag.current) setSel((s) => ({ ...s, f: i }));
                        }}
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
              </tbody>
            </table>
          </div>
        </div>

        <aside className="te-side">
          <section>
            <h4>Seçim</h4>
            <div className="kv">
              <span>Nokta</span>
              <b>
                [{sel.f}] {count > 1 && <span className="muted">· {count} nokta</span>}
              </b>
              <span>{xTitle}</span>
              <b>{xLabel(sel.f)}</b>
              <span>Değer</span>
              <b className="big">
                {values[sel.f]?.toFixed(digits)} <span className="muted small">{f.units}</span>
              </b>
            </div>
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
              <button onClick={submitEntry}>Ayarla</button>
            </div>
            <div className="row">
              <button onClick={() => add(-10)} title="PageDown">−10</button>
              <button onClick={() => add(-1)} title="↓ / −">−</button>
              <button onClick={() => add(1)} title="↑ / +">+</button>
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
            {liveX !== undefined ? (
              <div className="kv">
                <span>{curve.xChannel}</span>
                <b>{liveX.toFixed(1)}</b>
                <span>Eğri</span>
                <b className="live-val">{liveVal?.toFixed(digits) ?? '—'}</b>
              </div>
            ) : (
              <span className="muted small">{curve.xChannel ? 'veri bekleniyor…' : 'eğrinin canlı kanalı yok'}</span>
            )}
          </section>

          <section>
            <div className="legend" style={{ background: HEAT_GRADIENT }} />
            <div className="legend-lab">
              <span>{vmin.toFixed(digits)}</span>
              <span>{vmax.toFixed(digits)}</span>
            </div>
            <div className={ed.pending ? 'sync busy' : 'sync'}>
              {ed.pending ? `ECU'ya yazılıyor · ${ed.pending} bayt` : '● ECU RAM ile senkron'}
            </div>
            <div className="muted small keys">
              Noktayı sürükle: değer · Shift+tık: aralık · ←/→: gez · ↑/↓, +/−, PgUp/PgDn: adım · rakam + Enter ·
              I · S · Ctrl+A/C/V/Z/Y
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function CurvesPanel({
  client,
  config,
  feed,
  request,
}: {
  client: VemsClient;
  config: VemsConfig;
  feed?: RtSource;
  /** open this curve (from the command palette); a new object re-triggers */
  request?: { id: string };
}) {
  const curves = useMemo(
    () =>
      [...config.curves.values()].filter((c) => {
        const y = c.ySym ? config.byName.get(c.ySym) : undefined;
        return y?.kind === 'array' && ecuIdForField(config, y) !== undefined;
      }),
    [config],
  );
  const [id, setId] = useState(request?.id ?? curves[0]?.id ?? '');
  useEffect(() => {
    if (request) setId(request.id);
  }, [request]);
  const curve = config.curves.get(id) ?? curves[0];
  if (curves.length === 0) return <div className="panel">Düzenlenebilir eğri bulunamadı.</div>;
  return (
    <div className="stack">
      <div className="picker">
        <label>Eğri:</label>
        <select value={curve?.id} onChange={(e) => setId(e.target.value)}>
          {curves.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title || c.id}
            </option>
          ))}
        </select>
        <span className="muted small">{curves.length} eğri · Ctrl+K ile ara</span>
      </div>
      {curve && <CurveEditor key={curve.id} client={client} config={config} curve={curve} feed={feed} />}
    </div>
  );
}
