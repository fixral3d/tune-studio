import { useEffect, useMemo, useRef, useState } from 'react';
import {
  array2dIndex,
  cellsToFix,
  compileExpr,
  ConfigEvaluator,
  DEFAULT_STAT_OPTIONS,
  ecuIdForField,
  findPacketByDelay,
  logSamples,
  pagesFromPackets,
  parseVemsLog,
  readArray,
  VE_EXPRESSION,
  VE_FILTER,
  veStatistics,
  type ArrayField,
  type SiprDescriptor,
  type VeStatOptions,
  type VeStatResult,
  type VeStatSample,
  type VemsClient,
  type VemsConfig,
} from '@vems/core';
import { heatCss } from '../lib/colormap';
import type { RtSource } from '../lib/gauges';
import { usePageEditor, writeUserClamped } from '../lib/pageEditor';
import { RealtimeFeed, type RtSample } from '../lib/realtime';

const FILTER2 = `${VE_FILTER} && (calc_dtpsdt > -1) && (calc_dtpsdt < 1)`;
const LS = 'vt.rtds';

interface Source {
  name: string;
  samples: RtSample[];
  pages?: Map<number, Uint8Array>;
}
interface Params extends VeStatOptions {
  lambdaDelay: number;
  expression: string;
  filter: string;
}

function loadParams(): Params {
  const d: Params = { ...DEFAULT_STAT_OPTIONS, lambdaDelay: 0, expression: VE_EXPRESSION, filter: VE_FILTER };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(LS) ?? '{}') };
  } catch {
    return d;
  }
}

/** VE Tune by statistics (VemsTune RTDataStat): per-cell statistics of a log or the live buffer. */
export function VeStatsPanel({
  client,
  config,
  feed,
  sipr,
}: {
  client: VemsClient;
  config: VemsConfig;
  feed?: RtSource;
  sipr?: SiprDescriptor;
}) {
  const table = config.tables.get('veTableMap') ?? [...config.tables.values()][0];
  const z = table?.zSym ? (config.byName.get(table.zSym) as ArrayField | undefined) : undefined;
  const xF = table?.xSym ? (config.byName.get(table.xSym) as ArrayField | undefined) : undefined;
  const yF = table?.ySym ? (config.byName.get(table.ySym) as ArrayField | undefined) : undefined;
  const ecuId = z ? ecuIdForField(config, z) : undefined;
  const ed = usePageEditor(client, ecuId, feed instanceof RealtimeFeed ? feed.pages : undefined, z?.page);

  const [axes, setAxes] = useState<{ x: number[]; y: number[] }>();
  const [p, setP] = useState(loadParams);
  const [source, setSource] = useState<Source>();
  const [res, setRes] = useState<VeStatResult & { params: Params }>();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ratio, setRatio] = useState(false);
  const [sel, setSel] = useState<{ a: number; f: number }>();
  const [focus, setFocus] = useState<number>();
  const [fixed, setFixed] = useState<Set<number>>(new Set());
  const drag = useRef(false);

  const xlen = z?.shape.dims[0] ?? 0;
  const ylen = z?.shape.dims[1] ?? 0;

  useEffect(() => {
    if (!z || ecuId === undefined) return;
    let alive = true;
    (async () => {
      const pg = await client.readPage(ecuId);
      const read = async (f?: ArrayField) => {
        const id = f && ecuIdForField(config, f);
        return f && id !== undefined ? readArray(id === ecuId ? pg : await client.readPage(id), f) : [];
      };
      const ax = { x: (await read(xF)).slice(0, xlen), y: (await read(yF)).slice(0, ylen) };
      if (!alive) return;
      ed.load(pg);
      setAxes(ax);
    })().catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, [client, config, z, ecuId]);

  useEffect(() => {
    try {
      localStorage.setItem(LS, JSON.stringify(p));
    } catch {
      /* storage unavailable */
    }
  }, [p]);

  const ve = useMemo(() => {
    if (!ed.page || !z) return [];
    const mem = readArray(ed.page, z);
    return Array.from({ length: xlen * ylen }, (_, i) => mem[array2dIndex(z, i % xlen, Math.floor(i / xlen))]!);
  }, [ed.page, z, xlen, ylen]);

  const liveCount = feed instanceof RealtimeFeed ? feed.history.length : 0;

  async function openLog(file: File) {
    try {
      const log = parseVemsLog(new Uint8Array(await file.arrayBuffer()));
      const ok = log.results.flatMap((r) => (r.kind === 'packet' ? [r.packet] : []));
      setSource({ name: file.name, samples: logSamples(ok).samples, pages: sipr ? pagesFromPackets(sipr, ok) : undefined });
      setRes(undefined);
      setErr('');
    } catch (e) {
      setErr(`log okunamadı: ${(e as Error).message}`);
    }
  }
  function useLive() {
    if (!(feed instanceof RealtimeFeed)) return;
    setSource({ name: `canlı tampon`, samples: feed.history.slice(), pages: new Map(feed.pages) });
    setRes(undefined);
  }

  function evaluate() {
    if (!source || !axes || !table?.xChannel || !table.yChannel) return;
    setBusy(true);
    setErr('');
    setTimeout(() => {
      try {
        const expr = compileExpr(p.expression);
        const filt = p.filter.trim() ? compileExpr(p.filter) : undefined;
        const ev = new ConfigEvaluator(config);
        const evL = new ConfigEvaluator(config);
        const times = source.samples.map((s) => s.ms);
        const pages = source.pages?.size ? source.pages : feed?.pages;
        const out: VeStatSample[] = [];
        let skipped = 0;
        source.samples.forEach((s, i) => {
          const j = findPacketByDelay(times, i, p.lambdaDelay);
          if (j < 0) return void skipped++;
          const extra: Record<string, number> = { time: s.ms / 1000 };
          if (j !== i) {
            evL.reset({ realtime: source.samples[j]!.data, pages });
            const l = evL.value('lambda');
            if (l !== undefined) extra.lambda = l;
          }
          ev.reset({ realtime: s.data, pages, extra });
          const rpm = ev.value(table.xChannel!);
          const load = ev.value(table.yChannel!);
          if (rpm === undefined || load === undefined) return void skipped++;
          out.push({ rpm, load, pass: filt ? filt.evaluate(ev) > 0 : true, value: expr.evaluate(ev) });
        });
        setRes({ ...veStatistics(axes.x, axes.y, out, p), params: p });
        setFixed(new Set());
        if (skipped) setErr(`${skipped} örnek değerlendirilemedi (gecikme log sonunu aştı ya da kanal yok)`);
      } catch (e) {
        setErr(`ifade/filtre hatası: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    }, 10);
  }

  if (!table || !z) return <div className="panel">VE tablosu bulunamadı.</div>;
  if (!axes || !ed.page) return <div className="panel">{err || 'VE tablosu okunuyor…'}</div>;

  const digits = z.digits;
  const rect = sel && {
    x0: Math.min(sel.a % xlen, sel.f % xlen),
    x1: Math.max(sel.a % xlen, sel.f % xlen),
    y0: Math.min(Math.floor(sel.a / xlen), Math.floor(sel.f / xlen)),
    y1: Math.max(Math.floor(sel.a / xlen), Math.floor(sel.f / xlen)),
  };
  const selected = rect
    ? Array.from({ length: (rect.x1 - rect.x0 + 1) * (rect.y1 - rect.y0 + 1) }, (_, k) => {
        const w = rect.x1 - rect.x0 + 1;
        return (rect.y0 + Math.floor(k / w)) * xlen + rect.x0 + (k % w);
      })
    : [];
  const qualifies = (i: number) => !!res && cellsToFix(res, [i], res.params, digits).length > 0;

  function fixSelected() {
    if (!res || !ed.page || !z) return;
    const todo = cellsToFix(res, selected.filter((i) => !fixed.has(i)), res.params, digits);
    if (!todo.length) return setErr('Seçili hücrelerin hiçbiri koşulları sağlamıyor (Min. veri, Maks. varyans)');
    const next = ed.page.slice();
    for (const { i, value } of todo) writeUserClamped(next, z, array2dIndex(z, i % xlen, Math.floor(i / xlen)), value);
    ed.commit(next, `${todo.length} hücre düzeltildi`);
    setFixed(new Set([...fixed, ...todo.map((t) => t.i)]));
  }

  function exportJson() {
    if (!res || !source) return;
    const data = {
      logname: source.name,
      expression: res.params.expression,
      filter: res.params.filter,
      lambdadelay: res.params.lambdaDelay,
      variance_multiplier: res.params.varianceMultiplier,
      mindata: res.params.minData,
      maxvariance: res.params.maxVariance,
      x_axis: axes!.x,
      y_axis: axes!.y,
      statistics: { total: res.total, dropped: res.dropped, outliers: res.outliers, out_of_range: res.outOfRange },
      tabledata: res.cells.map((c, i) => ({
        x: i % xlen,
        y: Math.floor(i / xlen),
        current: ve[i],
        calculated: c?.mean,
        count: c?.n ?? 0,
        dropped: c?.dropped ?? 0,
        outliers: c?.outliers ?? 0,
        variance: c?.sd,
      })),
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `${source.name.replace(/\.vemslog$/i, '')}-vestat.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const rows = Array.from({ length: ylen }, (_, k) => ylen - 1 - k);
  const fc = focus !== undefined ? res?.cells[focus] : undefined;
  const set = (patch: Partial<Params>) => setP((o) => ({ ...o, ...patch }));

  return (
    <div className="rtds">
      <div className="panel rtds-ctl">
        <div className="rtds-src">
          <span className="muted small">Kaynak</span>
          <b>{source ? `${source.name} · ${source.samples.length} örnek` : 'seçilmedi'}</b>
          <label className="btn-file">
            .vemslog aç
            <input type="file" accept=".vemslog" hidden onChange={(e) => e.target.files?.[0] && void openLog(e.target.files[0])} />
          </label>
          <button onClick={useLive} disabled={!liveCount}>
            Canlı tampon ({liveCount})
          </button>
        </div>
        <div className="rtds-form">
          <label>İfade</label>
          <input className="num wide mono" value={p.expression} onChange={(e) => set({ expression: e.target.value })} />
          <label>Filtre</label>
          <span className="rtds-filter">
            <input className="num wide mono" value={p.filter} onChange={(e) => set({ filter: e.target.value })} />
            <button className="ghost" onClick={() => set({ filter: VE_FILTER })} title="default_filter">F1</button>
            <button className="ghost" onClick={() => set({ filter: FILTER2 })} title="default_filter2 (+calc_dtpsdt)">F2</button>
            <button className="ghost" onClick={() => set({ expression: VE_EXPRESSION })} title="default_expression">İfade ↺</button>
          </span>
        </div>
        <div className="rtds-nums">
          <label>
            Lambda gecikmesi (ms)
            <input className="num short" value={p.lambdaDelay} onChange={(e) => set({ lambdaDelay: Number(e.target.value) || 0 })} />
          </label>
          <label title="0 = aykırı değer filtresi kapalı">
            Varyans çarpanı
            <input className="num short" value={p.varianceMultiplier} onChange={(e) => set({ varianceMultiplier: Number(e.target.value) || 0 })} />
          </label>
          <label>
            Min. veri
            <input className="num short" value={p.minData} onChange={(e) => set({ minData: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
          <label title="hücrenin ağırlıklı standart sapması ile karşılaştırılır">
            Maks. varyans
            <input className="num short" value={p.maxVariance} onChange={(e) => set({ maxVariance: Number(e.target.value) || 0 })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={p.weighted} onChange={(e) => set({ weighted: e.target.checked })} /> Merkez ağırlığı
          </label>
          <button className="primary" onClick={evaluate} disabled={!source || busy}>
            {busy ? 'Hesaplanıyor…' : '(Yeniden) Değerlendir'}
          </button>
        </div>
        {err && <div className="muted small warn">{err}</div>}
      </div>

      {res && (
        <div className="rtla-stats rtds-sum">
          {(
            [
              ['Toplam', res.total],
              ['Atılan (filtre+aykırı)', res.dropped],
              ['Aykırı', res.outliers],
              ['Aralık dışı', res.outOfRange],
              ['Koşulu sağlayan hücre', res.cells.filter((_, i) => qualifies(i)).length],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      )}

      <div className="rtla-body">
        <div className="panel rtla-main">
          <div className="panel-head">
            <strong>{table.title} · istatistik</strong>
            <label className="check">
              <input type="checkbox" checked={ratio} onChange={(e) => setRatio(e.target.checked)} /> VEcorr/VE oranı (%)
            </label>
            <span className="status">{ed.status}</span>
          </div>
          <div className="table-wrap" onMouseUp={() => (drag.current = false)} onMouseLeave={() => (drag.current = false)}>
            <table className="rtds-grid">
              <tbody>
                {rows.map((y) => (
                  <tr key={y}>
                    <th className="axis">{+axes.y[y]!.toFixed(0)}</th>
                    {Array.from({ length: xlen }, (_, x) => {
                      const i = y * xlen + x;
                      const c = res?.cells[i];
                      const cur = ve[i]!;
                      const on = rect && x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
                      const has = c && c.n > 0;
                      const center = has ? (ratio ? (c.mean / cur) * 100 : c.mean) : undefined;
                      const cls = ['rcell'];
                      if (has) cls.push(qualifies(i) ? 'ok' : 'weak');
                      if (on) cls.push('on');
                      if (fixed.has(i)) cls.push('fixed');
                      if (focus === i) cls.push('focus');
                      const tint = has ? heatCss(0.5 + Math.max(-0.5, Math.min(0.5, (c.mean - cur) / (cur || 1) * 2.5))) : undefined;
                      return (
                        <td
                          key={x}
                          className={cls.join(' ')}
                          style={tint ? { boxShadow: `inset 0 -3px 0 ${tint}` } : undefined}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            drag.current = true;
                            setSel((s) => (e.shiftKey && s ? { ...s, f: i } : { a: i, f: i }));
                            setFocus(i);
                          }}
                          onMouseEnter={() => drag.current && setSel((s) => s && { ...s, f: i })}
                        >
                          {has ? (
                            <>
                              <span className="tl">{c.min.toFixed(0)}</span>
                              <span className="tr">{c.max.toFixed(0)}</span>
                              <b>{center!.toFixed(ratio ? 0 : 1)}{ratio ? '%' : ''}</b>
                              <span className="bl">
                                {c.n}
                                {c.dropped + c.outliers ? ` (${c.dropped}/${c.outliers})` : ''}
                              </span>
                              <span className="br">{c.sd.toFixed(1)}</span>
                            </>
                          ) : (
                            <span className="cur">{cur.toFixed(digits)}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <th className="axis corner" />
                  {axes.x.map((v, x) => (
                    <th key={x} className="axis">
                      {+v.toFixed(0)}
                    </th>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="rtla-legend">
            <span>sol üst: min · sağ üst: maks · orta: ağırlıklı ortalama · sol alt: veri (atılan/aykırı) · sağ alt: σ</span>
            <span>
              <i className="lg-ok" /> düzeltilebilir
            </span>
            <span>
              <i className="lg-weak" /> yetersiz veri / yüksek varyans
            </span>
          </div>
          <div className="row rtds-actions">
            <button onClick={() => setSel({ a: 0, f: xlen * ylen - 1 })}>Tümünü seç</button>
            <button className="primary" onClick={fixSelected} disabled={!res || !selected.length}>
              Seçili hücreleri düzelt ({selected.length})
            </button>
            <button onClick={ed.undo} disabled={!ed.canUndo}>
              ↶ Geri al
            </button>
            <button onClick={exportJson} disabled={!res}>
              Veriyi dışa aktar (.json)
            </button>
            <span className={ed.pending ? 'sync busy' : 'sync'}>
              {ed.pending ? `ECU'ya yazılıyor · ${ed.pending} bayt` : '● ECU RAM ile senkron'}
            </span>
          </div>
        </div>

        <aside className="rtla-side">
          <section className="panel">
            <h4>Hücre {focus !== undefined ? `[${focus % xlen}, ${Math.floor(focus / xlen)}]` : ''}</h4>
            {fc && focus !== undefined ? (
              <>
                <div className="kv">
                  <span>{table.xChannel}</span>
                  <b>{+axes.x[focus % xlen]!.toFixed(0)}</b>
                  <span>{table.yChannel}</span>
                  <b>{+axes.y[Math.floor(focus / xlen)]!.toFixed(0)}</b>
                  <span>Mevcut VE</span>
                  <b>{ve[focus]!.toFixed(digits)}</b>
                  <span>Hesaplanan</span>
                  <b className="live-val">{Number.isFinite(fc.mean) ? fc.mean.toFixed(2) : '—'}</b>
                  <span>Veri / atılan / aykırı</span>
                  <b>
                    {fc.n} / {fc.dropped} / {fc.outliers}
                  </b>
                  <span>σ</span>
                  <b>{Number.isFinite(fc.sd) ? fc.sd.toFixed(2) : '—'}</b>
                </div>
                <Histogram values={fc.values} mean={fc.mean} current={ve[focus]!} />
              </>
            ) : (
              <span className="muted small">
                {!res ? 'Önce bir kaynak seçip değerlendir' : focus === undefined ? 'Bir hücre seç' : 'Bu hücreye düşen örnek yok'}
              </span>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Distribution of a cell's values with the calculated mean and the current VE marked. */
function Histogram({ values, mean, current }: { values: number[]; mean: number; current: number }) {
  if (!values.length) return <div className="muted small">Değer yok</div>;
  const W = 340;
  const H = 120;
  let lo = Math.min(current, ...values);
  let hi = Math.max(current, ...values);
  if (hi === lo) [lo, hi] = [lo - 1, hi + 1];
  const nb = Math.min(24, Math.max(6, Math.round(Math.sqrt(values.length) * 2)));
  const bins = new Array<number>(nb).fill(0);
  for (const v of values) bins[Math.min(nb - 1, Math.floor(((v - lo) / (hi - lo)) * nb))]!++;
  const top = Math.max(...bins);
  const px = (v: number) => ((v - lo) / (hi - lo)) * W;
  return (
    <svg className="rtds-hist" viewBox={`0 0 ${W} ${H + 16}`}>
      {bins.map((b, k) => (
        <rect key={k} x={(k * W) / nb + 1} width={W / nb - 2} y={H - (b / top) * (H - 6)} height={(b / top) * (H - 6)} rx={2} />
      ))}
      {Number.isFinite(mean) && <line className="mean" x1={px(mean)} x2={px(mean)} y1={0} y2={H} />}
      <line className="cur" x1={px(current)} x2={px(current)} y1={0} y2={H} />
      <text x={0} y={H + 13}>{lo.toFixed(0)}</text>
      <text x={W} y={H + 13} textAnchor="end">
        {hi.toFixed(0)}
      </text>
    </svg>
  );
}
