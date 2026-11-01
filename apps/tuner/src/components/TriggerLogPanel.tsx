import { useEffect, useMemo, useRef, useState } from 'react';
import {
  appendTriggerStream,
  emptyTriggerLog,
  parseGraphColors,
  parseTriggerLog,
  triggerLogCsv,
  triggerLogFileName,
  triggerLogResults,
  TriggerTimeBase,
  vemslogHeader,
  writeTriggerLog,
  type FirmwareDetails,
  type TriggerEventStyle,
  type TriggerLog,
} from '@vems/core';
import type { Device } from '../lib/device';
import type { RealtimeFeed } from '../lib/realtime';

function download(bytes: Uint8Array | string, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

type Colors = ReturnType<typeof parseGraphColors>;
const NO_DATA_MS = 3000; // TriggerFrameCommunicationClient: 300 empty reads → enable again

/**
 * TRIG-01 Record/Analyze trigger log (VemsTune TriggerLogManager / TriggerLogGraph / TriggerLogResults):
 * Start sends `40 03 F7` and stores the raw TF stream; the scope draws primary teeth with a height
 * proportional to their interval, other events (graphcolors.xml) as coloured markers; the result table
 * flags MISSING TOOTH gaps; .triggerlog and CSV export.
 */
export function TriggerLogPanel({ device, feed, details }: { device?: Device; feed?: RealtimeFeed; details?: FirmwareDetails }) {
  const [log, setLog] = useState<TriggerLog>();
  const [name, setName] = useState('');
  const [rec, setRec] = useState(false);
  const [status, setStatus] = useState('');
  const [colors, setColors] = useState<Colors>();
  const [view, setView] = useState({ t0: 0, span: 200 });
  const [follow, setFollow] = useState(true);
  const [sel, setSel] = useState<{ a: number; b: number }>();
  const [rev, setRev] = useState(0); // bumps on live data
  const live = useRef<{ chunks: Uint8Array[]; tb: TriggerTimeBase; last: number; off?: () => void; nodata?: ReturnType<typeof setInterval> }>();

  useEffect(() => {
    fetch('/config/graphcolors.xml')
      .then((r) => r.text())
      .then((x) => setColors(parseGraphColors(x)))
      .catch(() => undefined);
  }, []);

  // stop the ECU stream if the panel goes away mid-recording
  useEffect(() => () => void (live.current && stopRec()), []);

  async function startRec() {
    if (!device) return;
    feed?.stop(); // realtime polling would interleave with the trigger stream
    const l = emptyTriggerLog({ version: details?.version, serialNumber: details?.serialNumber, currentTime: new Date().toLocaleString() });
    const st = { chunks: [] as Uint8Array[], tb: new TriggerTimeBase(), last: Date.now() } as NonNullable<typeof live.current>;
    st.off = device.client.onRawData((b) => {
      st.chunks.push(b.slice());
      const before = l.stats.frames;
      appendTriggerStream(l, b, st.tb);
      l.stats.bytes += b.length;
      if (l.stats.frames > before) st.last = Date.now();
    });
    st.nodata = setInterval(() => {
      setRev((r) => r + 1);
      if (Date.now() - st.last > NO_DATA_MS) {
        st.last = Date.now();
        setStatus('TriggerLogNoData — trigger log yeniden başlatıldı');
        device.client.startTriggerLog();
      }
    }, 250);
    live.current = st;
    setLog(l);
    setName(triggerLogFileName(details?.serialNumber ?? 'vems'));
    setSel(undefined);
    setFollow(true);
    setRec(true);
    setStatus('kayıt sürüyor…');
    device.client.startTriggerLog();
  }

  async function stopRec() {
    const st = live.current;
    if (!st) return;
    live.current = undefined;
    clearInterval(st.nodata);
    try {
      await device?.client.stopTriggerLog();
    } catch (e) {
      setStatus(`durdurma hatası: ${(e as Error).message}`);
    }
    st.off?.();
    feed?.start();
    setLog((l) => l && { ...l, stream: concat(st.chunks) });
    setRec(false);
    setStatus('kayıt durdu');
  }

  async function open(f: File) {
    const l = parseTriggerLog(new Uint8Array(await f.arrayBuffer()));
    setLog(l);
    setName(f.name);
    setSel(undefined);
    setFollow(false);
    const pr = l.timelines.get(1)?.t ?? [];
    setView({ t0: pr[0] ?? 0, span: 200 });
    setStatus(l.hasHeader ? '' : 'no valid header found, use log as raw byte stream');
  }

  function save() {
    if (!log) return;
    const header = vemslogHeader({
      trigger: true,
      version: log.info.version ?? details?.version,
      serialNumber: log.info.serialNumber ?? details?.serialNumber,
      compilationTime: details?.compilationTime,
      signature: details?.mtCodeVer,
    });
    download(writeTriggerLog(header, log.stream), name.endsWith('.triggerlog') ? name : `${name || 'vems'}.triggerlog`);
  }

  const rows = useMemo(() => (log ? triggerLogResults(log) : []), [log, rev, rec]);
  const end = useMemo(() => {
    let m = 0;
    for (const tl of log?.timelines.values() ?? []) m = Math.max(m, tl.t[tl.t.length - 1] ?? 0);
    return m;
  }, [log, rev]);
  const v = follow && rec ? { t0: Math.max(0, end - view.span), span: view.span } : view;

  const inSel = (id: number) => (sel && log ? (log.timelines.get(id)?.t ?? []).filter((t) => t >= Math.min(sel.a, sel.b) && t <= Math.max(sel.a, sel.b)).length : 0);
  const visibleRows = rows.filter((r) => {
    const t = r.primary?.t ?? r.secondary!.t;
    return t >= v.t0 && t <= v.t0 + v.span;
  });

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head">
          <strong>Trigger log</strong>
          {rec ? (
            <button className="rec-on" onClick={stopRec}>
              ■ Stop V3
            </button>
          ) : (
            <button onClick={startRec} disabled={!device} title={device ? 'ECU trigger log kaydını başlat (40 03 F7)' : 'Kayıt için ECU bağlantısı gerekli'}>
              ● Start V3
            </button>
          )}
          <label className="button-like">
            Aç…
            <input type="file" accept=".triggerlog,.bin,.raw" hidden onChange={(e) => e.target.files?.[0] && void open(e.target.files[0])} />
          </label>
          <button onClick={save} disabled={!log || rec}>
            .triggerlog kaydet
          </button>
          <button onClick={() => log && download(triggerLogCsv(rows, log.info), `${(name || 'triggerlog').replace(/\.triggerlog$/, '')}.csv`)} disabled={!log || rec}>
            Save table to CSV
          </button>
          <label className="small">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Scroll as real-time
          </label>
          <span className="status">{status}</span>
        </div>
        {log && (
          <p className="muted small mono">
            {name} · {log.stats.bytes} bayt · {log.stats.frames} frame · CRC hatalı {log.stats.crcErrors} · primary {log.timelines.get(1)?.t.length ?? 0} · secondary{' '}
            {log.timelines.get(2)?.t.length ?? 0}
            {log.info.version ? ` · fw ${log.info.version}` : ''}
            {sel ? ` · seçim ${Math.abs(sel.b - sel.a).toFixed(3)} ms, primary ${inSel(1)}, secondary ${inSel(2)}` : ''}
          </p>
        )}
        {!log && <p className="muted">Bir .triggerlog dosyası aç ya da ECU bağlıyken Start V3 ile kayıt başlat.</p>}
        {log && colors && (
          <Scope
            log={log}
            colors={colors}
            view={v}
            rev={rev}
            sel={sel}
            onView={(nv) => {
              setFollow(false);
              setView(nv);
            }}
            onSel={setSel}
          />
        )}
      </div>
      {log && (
        <div className="panel">
          <div className="panel-head">
            <strong>Trigger log results</strong>
            <span className="muted small">
              {rows.filter((r) => r.comment).length} MISSING TOOTH · görünen aralıkta {visibleRows.length} satır
            </span>
          </div>
          <div className="table-wrap tlog-results">
            <table className="pages">
              <thead>
                <tr>
                  <th>id</th>
                  <th>Primary Time (ms)</th>
                  <th>Primary Diff (ms)</th>
                  <th>Primary Diff Ratio</th>
                  <th>Secondary Time (ms)</th>
                  <th>Secondary Diff (ms)</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.slice(0, 600).map((r) => {
                  const id = rows.indexOf(r);
                  return (
                    <tr key={id} className={r.comment ? 'tlog-gap' : undefined}>
                      <td>{id}</td>
                      <td>{r.primary ? `${r.primary.t.toFixed(3)}, (${r.primary.idx})` : ''}</td>
                      <td>{r.primary?.diff.toFixed(3)}</td>
                      <td>{r.primary?.ratio.toFixed(2)}</td>
                      <td>{r.secondary ? `${r.secondary.t.toFixed(3)}, (${r.secondary.idx})` : ''}</td>
                      <td>{r.secondary?.diff.toFixed(3)}</td>
                      <td>
                        <b>{r.comment}</b>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Oscilloscope-like view: wheel = zoom at cursor, drag = pan, Shift+drag = select, ←/→ pan, +/− zoom. */
function Scope({
  log,
  colors,
  view,
  rev,
  sel,
  onView,
  onSel,
}: {
  log: TriggerLog;
  colors: Colors;
  view: { t0: number; span: number };
  rev: number;
  sel?: { a: number; b: number };
  onView: (v: { t0: number; span: number }) => void;
  onSel: (s?: { a: number; b: number }) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; t0: number; select: boolean; a: number }>();
  const H = 300;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = c.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr;
    c.height = H * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.fillStyle = colors.background ?? '#e7dabe';
    g.fillRect(0, 0, W, H);
    const x = (t: number) => ((t - view.t0) / view.span) * W;
    // time grid
    const stepMs = 10 ** Math.floor(Math.log10(view.span / 5));
    g.strokeStyle = 'rgba(0,0,0,.12)';
    g.fillStyle = colors.text ?? '#000';
    g.font = '10px ui-monospace, Consolas, monospace';
    for (let t = Math.ceil(view.t0 / stepMs) * stepMs; t <= view.t0 + view.span; t += stepMs) {
      g.beginPath();
      g.moveTo(x(t), 0);
      g.lineTo(x(t), H);
      g.stroke();
      g.fillText(`${t.toFixed(stepMs < 1 ? 2 : 0)} ms`, x(t) + 2, H - 3);
    }
    if (sel) {
      g.fillStyle = 'rgba(0,90,255,.15)';
      g.fillRect(x(Math.min(sel.a, sel.b)), 0, Math.abs(x(sel.b) - x(sel.a)), H);
    }
    const base = H * 0.72;
    // primary: pulse height ∝ interval to the previous tooth
    const pr = log.timelines.get(1)?.t ?? [];
    const style = (id: number): TriggerEventStyle => colors.events.get(id) ?? { id, name: `trigger Nr.${id}`, voffset: 0, color: '#4b2258' };
    let lo = lowerBound(pr, view.t0);
    let maxDiff = 0;
    for (let i = Math.max(1, lo); i < pr.length && pr[i]! <= view.t0 + view.span; i++) maxDiff = Math.max(maxDiff, pr[i]! - pr[i - 1]!);
    g.strokeStyle = style(1).color;
    g.lineWidth = 1.5;
    for (let i = Math.max(1, lo - 1); i < pr.length && pr[i - 1]! <= view.t0 + view.span; i++) {
      const h = maxDiff ? ((pr[i]! - pr[i - 1]!) / maxDiff) * base * 0.85 : 10;
      g.beginPath();
      g.moveTo(x(pr[i]!), base - style(1).voffset);
      g.lineTo(x(pr[i]!), base - style(1).voffset - h);
      g.stroke();
    }
    // other events: marker lines around the baseline, offset by voffset
    for (const [id, tl] of log.timelines) {
      if (id === 1) continue;
      const s = style(id);
      g.strokeStyle = s.color;
      g.lineWidth = 2;
      lo = lowerBound(tl.t, view.t0);
      for (let i = lo; i < tl.t.length && tl.t[i]! <= view.t0 + view.span; i++) {
        const y = base + 8 - s.voffset;
        g.beginPath();
        g.moveTo(x(tl.t[i]!), y);
        g.lineTo(x(tl.t[i]!), y + 26);
        g.stroke();
      }
    }
    // legend
    let lx = 8;
    g.font = '11px system-ui, sans-serif';
    for (const id of [...log.timelines.keys()].sort((a, b) => a - b)) {
      const s = style(id);
      g.fillStyle = s.color;
      g.fillRect(lx, 8, 10, 10);
      g.fillStyle = colors.text ?? '#000';
      g.fillText(s.name, lx + 14, 17);
      lx += g.measureText(s.name).width + 30;
    }
  }, [log, colors, view, rev, sel]);

  const tAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return view.t0 + ((clientX - r.left) / r.width) * view.span;
  };

  return (
    <canvas
      ref={ref}
      className="tlog-scope"
      style={{ width: '100%', height: H }}
      tabIndex={0}
      onWheel={(e) => {
        const t = tAt(e.clientX);
        const k = e.deltaY > 0 ? 1.25 : 0.8;
        const span = Math.min(1e7, Math.max(0.05, view.span * k));
        onView({ t0: t - ((t - view.t0) / view.span) * span, span });
      }}
      onMouseDown={(e) => {
        const a = tAt(e.clientX);
        drag.current = { x: e.clientX, t0: view.t0, select: e.shiftKey, a };
        if (e.shiftKey) onSel({ a, b: a });
      }}
      onMouseMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (d.select) onSel({ a: d.a, b: tAt(e.clientX) });
        else onView({ t0: d.t0 - ((e.clientX - d.x) / ref.current!.clientWidth) * view.span, span: view.span });
      }}
      onMouseUp={() => (drag.current = undefined)}
      onMouseLeave={() => (drag.current = undefined)}
      onKeyDown={(e) => {
        const step = view.span * (e.ctrlKey ? 0.02 : e.key.startsWith('Page') ? 0.9 : 0.2);
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') onView({ ...view, t0: view.t0 - step });
        else if (e.key === 'ArrowRight' || e.key === 'PageDown') onView({ ...view, t0: view.t0 + step });
        else if (e.key === '+' || e.key === 'ArrowUp') onView({ t0: view.t0 + view.span * 0.1, span: view.span * 0.8 });
        else if (e.key === '-' || e.key === 'ArrowDown') onView({ t0: view.t0 - view.span * 0.125, span: view.span * 1.25 });
        else if (e.key === 'Enter' && sel) onView({ t0: Math.min(sel.a, sel.b), span: Math.max(0.05, Math.abs(sel.b - sel.a)) });
        else return;
        e.preventDefault();
      }}
    />
  );
}

function lowerBound(a: number[], v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m]! < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}
