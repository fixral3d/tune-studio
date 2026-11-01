import { useEffect, useMemo, useState } from 'react';
import {
  ConfigEvaluator,
  fieldMarks,
  FwSymbols,
  readAllPages,
  readBits,
  readScalar,
  resolveTarget,
  testCond,
  userToRaw,
  writeBits,
  writeRawInt,
  VemsClient,
  type BitsField,
  type ConfigCriteria,
  type DialogDesc,
  type FieldMark,
  type FwLayout,
  type SiprDescriptor,
  type DialogField,
  type MenuItem,
  type PageStore,
  type ScalarField,
  type VemsConfig,
} from '@vems/core';
import { loadCriteria, loadFwLayout } from '../lib/config';
import { TableEditor } from './TableEditor';
import { CurveEditor } from './CurveEditor';
import { TpsWizard } from './TpsWizard';
import { Wbo2Calibration } from './Wbo2Calibration';
import { AnalogCalWizard } from './AnalogCalWizard';
import type { RealtimeFeed } from '../lib/realtime';

const plain = (s: string) => s.replace(/&/g, '');

/** INI-driven menu tree ([Menu]) + [UserDefined] dialog renderer (TUNE-01/02).
 *  Every field change is written to ECU RAM immediately; Burn makes it permanent. */
export function MenuPanel({
  client,
  config,
  openRequest,
  sipr,
  firmware,
  feed,
  pagesReady,
}: {
  client: VemsClient;
  config: VemsConfig;
  /** open this item (e.g. a sanity-check link) */
  openRequest?: MenuItem;
  sipr?: SiprDescriptor;
  firmware?: string;
  /** live feed whose `pages` are the shared config copy (read once on connect, mirrored on writes) */
  feed?: RealtimeFeed;
  /** resolves when feed.pages has been loaded */
  pagesReady?: Promise<Map<number, Uint8Array>>;
}) {
  const [store, setStore] = useState<PageStore>();
  const [open, setOpen] = useState<MenuItem | undefined>(openRequest);
  useEffect(() => openRequest && setOpen(openRequest), [openRequest]);
  const [status, setStatus] = useState('');
  const [wizard, setWizard] = useState<'tps' | 'wbo2' | 'analog'>();

  /** "ECU'dan oku": read every page from the ECU and refresh the shared copy too. */
  async function refresh() {
    setStatus('config okunuyor…');
    try {
      const s = await readAllPages(client, config);
      for (const [k, v] of s) feed?.pages.set(k, v);
      setStore(s);
      setStatus(`okundu: ${s.size} sayfa`);
    } catch (e) {
      setStatus(`okuma hatası: ${(e as Error).message}`);
    }
  }

  // reuse the connect-time page read when there is one (other editors keep it current)
  useEffect(() => {
    let alive = true;
    if (!pagesReady) void refresh();
    else
      pagesReady
        .then((p) => {
          if (!alive) return;
          setStore(new Map(p));
          setStatus(`okundu: ${p.size} sayfa (ortak kopya)`);
        })
        .catch(() => alive && void refresh());
    return () => {
      alive = false;
    };
  }, [client, config, pagesReady]);

  const ev = useMemo(() => new ConfigEvaluator(config, { pages: store }), [config, store]);
  const test = (c?: string) => testCond(c, ev);

  // per-field validation marks, recomputed after every edit (VemsTune's dialog field icons)
  const [criteria, setCriteria] = useState<ConfigCriteria>();
  const [layout, setLayout] = useState<FwLayout>();
  useEffect(() => {
    loadCriteria().then(setCriteria).catch(() => undefined);
    if (firmware) loadFwLayout(firmware).then(setLayout).catch(() => undefined);
  }, [firmware]);
  const marks = useMemo(() => {
    if (!criteria || !store) return new Map<string, FieldMark>();
    const fw = layout && sipr ? new FwSymbols(layout, sipr, store) : undefined;
    return fieldMarks(criteria, config, store, { firmware, fw });
  }, [criteria, layout, sipr, store, config, firmware]);

  /** Apply `mutate` to a copy of the field's page and write only the changed bytes. */
  async function commit(page: number, mutate: (buf: Uint8Array) => void) {
    const old = store?.get(page);
    const ecuId = config.vt2ecu.get(page);
    if (!store || !old || ecuId === undefined) return;
    const next = old.slice();
    mutate(next);
    try {
      for (let i = 0; i < next.length; i++) if (next[i] !== old[i]) await client.writeByte(ecuId, i, next[i]!);
      feed?.pages.set(page, next); // mirror into the shared copy (new buffer, never mutated in place)
      setStore(new Map(store).set(page, next));
      setStatus('yazıldı (RAM) — kalıcı olması için üstteki Burn');
    } catch (e) {
      setStatus(`yazma hatası: ${(e as Error).message}`);
    }
  }

  const target = open && resolveTarget(config, open.target, test);
  /** wizards write through feed.pages; pick their changes up */
  const closeWizard = () => {
    setWizard(undefined);
    if (feed) setStore(new Map(feed.pages));
  };

  return (
    <div className="menu-layout">
      <aside className="menu-side">
        {feed && (
          <div className="menu-group">
            <div className="menu-title">Sihirbazlar</div>
            <button className={wizard === 'tps' ? 'menu-item on' : 'menu-item'} disabled={!store} onClick={() => setWizard('tps')}>
              TPS kalibrasyonu
            </button>
            <button className={wizard === 'wbo2' ? 'menu-item on' : 'menu-item'} disabled={!store} onClick={() => setWizard('wbo2')}>
              WBO2 kalibrasyonu
            </button>
            <button className={wizard === 'analog' ? 'menu-item on' : 'menu-item'} disabled={!store} onClick={() => setWizard('analog')}>
              Analog giriş kalibrasyonu
            </button>
          </div>
        )}
        {config.menus.map((m) => (
          <div key={m.title} className="menu-group">
            <div className="menu-title">{plain(m.title)}</div>
            {m.items.map((it, i) =>
              it === 'separator' ? (
                <hr key={i} />
              ) : (
                <button
                  key={i}
                  className={open === it ? 'menu-item on' : 'menu-item'}
                  disabled={!store || !test(it.cond)}
                  onClick={() => {
                    setWizard(undefined);
                    setOpen(it);
                  }}
                >
                  {plain(it.label)}
                </button>
              ),
            )}
          </div>
        ))}
      </aside>
      <section className="stack">
        <div className="panel-head">
          <button onClick={refresh}>ECU'dan oku</button>
          <span className="status">{status}</span>
        </div>
        {wizard === 'tps' && feed && <TpsWizard client={client} config={config} feed={feed} onClose={closeWizard} />}
        {wizard === 'wbo2' && feed && <Wbo2Calibration client={client} config={config} feed={feed} onClose={closeWizard} />}
        {wizard === 'analog' && feed && <AnalogCalWizard client={client} config={config} feed={feed} onClose={closeWizard} />}
        {!wizard && !target && <div className="panel muted">Soldaki menüden bir ayar seç.</div>}
        {!wizard && target?.kind === 'dialog' && store && (
          <DialogView dialog={target.dialog} config={config} store={store} ev={ev} commit={commit} marks={marks} />
        )}
        {!wizard && target?.kind === 'table' && <TableEditor client={client} config={config} table={target.table} />}
        {!wizard && target?.kind === 'curve' && <CurveEditor client={client} config={config} curve={target.curve} />}
        {!wizard && target?.kind === 'unknown' && (
          <div className="panel">
            INI hedefi çözülemedi: <span className="mono">{target.id}</span> (VemsTune'da da tanımsız)
          </div>
        )}
      </section>
    </div>
  );
}

type Commit = (page: number, mutate: (buf: Uint8Array) => void) => Promise<void>;

function DialogView({
  dialog,
  config,
  store,
  ev,
  commit,
  marks,
}: {
  dialog: DialogDesc;
  config: VemsConfig;
  store: PageStore;
  ev: ConfigEvaluator;
  commit: Commit;
  marks: Map<string, FieldMark>;
}) {
  const rows = dialog.fields.filter((f) => testCond(f.visible, ev));
  return (
    <div className="panel">
      <div className="panel-head">
        <strong>{dialog.title}</strong>
        {dialog.help && <span className="muted small">yardım konusu: {dialog.help}</span>}
        <span className="muted mono small">{dialog.id}</span>
      </div>
      <div className="dlg">
        {rows.map((f, i) => (
          <FieldRow key={i} f={f} config={config} store={store} ev={ev} commit={commit} mark={f.symbol ? marks.get(f.symbol) : undefined} />
        ))}
      </div>
    </div>
  );
}

function Label({ text }: { text: string }) {
  return text.startsWith('!') ? <span className="warn">{text.slice(1)}</span> : <>{text}</>;
}

function FieldRow({
  f,
  config,
  store,
  ev,
  commit,
  mark,
}: {
  f: DialogField;
  config: VemsConfig;
  store: PageStore;
  ev: ConfigEvaluator;
  commit: Commit;
  mark?: FieldMark;
}) {
  if (f.kind === 'header')
    return (
      <h4 className="dlg-head">
        <Label text={f.label} />
      </h4>
    );
  if (f.kind === 'text')
    return (
      <p className="dlg-text">
        <Label text={f.label} />
      </p>
    );

  const sym = config.byName.get(f.symbol!);
  const enabled = testCond(f.enable, ev);
  const buf = sym && sym.kind !== 'computed' ? store.get(sym.page) : undefined;
  let editor: JSX.Element;
  const units = sym?.units ?? '';

  if (!sym) editor = <span className="muted small">tanımsız sembol: {f.symbol}</span>;
  else if (sym.kind === 'computed') {
    const v = safe(() => ev.value(sym.name));
    editor = <span className="mono">{v === undefined ? '—' : v.toFixed(sym.digits)}</span>;
  } else if (!buf) editor = <span className="muted small">sayfa {sym.page} okunamadı</span>;
  else if (sym.kind === 'scalar')
    editor = <ScalarInput f={sym} value={readScalar(buf, sym)} disabled={!enabled} commit={commit} />;
  else if (sym.kind === 'bits')
    editor = <BitsSelect f={sym} value={readBits(buf, sym)} disabled={!enabled} commit={commit} />;
  else editor = <span className="muted small">dizi ({sym.name}) — tablo/eğri editöründen düzenlenir</span>;

  return (
    <div className={enabled ? 'dlg-row' : 'dlg-row off'}>
      <label title={f.symbol} className={mark ? `marked ${mark.severity}` : undefined}>
        <Label text={f.label} />
      </label>
      {editor}
      <span className="muted small">
        {mark && (
          <span className={`field-mark ${mark.severity === 'error' ? 'bad' : 'warn'}`} title={htmlText(mark.text)}>
            {mark.severity === 'error' ? '✖' : '⚠'}{' '}
          </span>
        )}
        {units}
      </span>
    </div>
  );
}

/** Tooltip text from a rule's HTML detail (tags dropped, $MENU_LINK left out). */
const htmlText = (html: string) =>
  html.replace(/<br\s*\/?>/gi, '\n').replace(/<li>/gi, '\n• ').replace(/<[^>]+>/g, '').replace(/\$MENU_LINK/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();

const safe = <T,>(fn: () => T): T | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

function ScalarInput({
  f,
  value,
  disabled,
  commit,
}: {
  f: ScalarField;
  value: number;
  disabled: boolean;
  commit: Commit;
}) {
  const shown = value.toFixed(f.digits);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);

  function apply() {
    let v = Number(text.replace(',', '.'));
    if (!Number.isFinite(v) || text.trim() === '' || v.toFixed(f.digits) === shown) return setText(shown);
    if (v < f.lo || v > f.hi) {
      // VemsTune asks YES (keep) / NO (limit) / CANCEL (drop); confirm() covers keep vs limit.
      const keep = window.confirm(`Değer aralık dışı (${f.lo} … ${f.hi}). Yine de ${v} yazılsın mı?\nİptal = sınıra çek`);
      if (!keep) v = Math.min(f.hi, Math.max(f.lo, v));
    }
    const bits = f.type.size * 8;
    const rawMin = f.type.signed ? -(2 ** (bits - 1)) : 0;
    const rawMax = f.type.signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1;
    const raw = Math.min(rawMax, Math.max(rawMin, userToRaw(v, f.scale, f.translate)));
    void commit(f.page, (b) => writeRawInt(b, f.offset, f.type, raw));
  }

  return (
    <input
      className="num"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function BitsSelect({
  f,
  value,
  disabled,
  commit,
}: {
  f: BitsField;
  value: number;
  disabled: boolean;
  commit: Commit;
}) {
  const count = 2 ** (f.bitHi - f.bitLo + 1);
  const opts = f.labels.slice(0, count).map((l, i) => ({ v: i + f.bitOfs, l }));
  if (!opts.some((o) => o.v === value)) opts.push({ v: value, l: `(${value})` });
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => void commit(f.page, (b) => writeBits(b, f, Number(e.target.value)))}
    >
      {opts.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  );
}
