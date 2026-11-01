import { useEffect, useRef, useState } from 'react';
import { ConfigEvaluator, readScalar, writeRawInt, VemsClient, type ScalarField, type VemsConfig } from '@vems/core';
import type { RealtimeFeed } from '../lib/realtime';

// WBO2CalibrationFrame constants (ctor / MainFrame::OnWizards setO2Limit)
const TARGET = 20.9; // free-air O2 %
const TOLERANCE = 0.09;
const WINDOW = 20; // moving-average length (samples)
const O2_LIMIT = 8; // below this the sensor is still heating
const STEP_MS = 500; // auto-cal: settle time after each change
const ENA_FLAGS = 3; // TEST_TOOLS sub 'e'

type Tone = 'muted' | 'warn' | 'ok';

/**
 * WBO2 free-air calibration (CAL-01, VemsTune WBO2CalibrationFrame "WBO2 Calibration (new)").
 * Start/Auto send ENA_FLAGS 02 (sensor 1) / 03 (sensor 2), Stop sends 00; the firmware then reports
 * the free-air O2 % in stallO2. Manual: adjust wbo2_calibration until 20.9 % ± 0.09; Auto steps it by 1
 * every 500 ms once a 20-sample average is ready.
 */
export function Wbo2Calibration({
  client,
  config,
  feed,
  onClose,
}: {
  client: VemsClient;
  config: VemsConfig;
  feed: RealtimeFeed;
  onClose: () => void;
}) {
  const sym = (n: string) => {
    const f = config.byName.get(n);
    return f?.kind === 'scalar' ? f : undefined;
  };
  const read = (f?: ScalarField) => {
    const buf = f && feed.pages.get(f.page);
    return buf ? readScalar(buf, f!) : undefined;
  };
  const dual = (read(sym('wbo2_2_enable')) ?? 0) !== 0;

  const [sensor, setSensor] = useState(0); // 0 = wbo2_calibration (Manmde02), 1 = wbo2_calibration2 (Manmde03)
  const field = sym(sensor === 0 ? 'wbo2_calibration' : 'wbo2_calibration2');
  const [value, setValue] = useState(() => read(field) ?? 0);
  useEffect(() => setValue(read(field) ?? 0), [field]);

  const [running, setRunning] = useState(false);
  const [auto, setAuto] = useState(false);
  const [o2, setO2] = useState<number>();
  const [status, setStatus] = useState<{ text: string; tone: Tone }>({ text: 'Idle', tone: 'muted' });
  const [err, setErr] = useState('');

  // per-sample state lives in a ref so the feed callback sees current values
  const st = useRef({ samples: [] as number[], since: 0, paused: false, value, running, auto, busy: false });
  st.current.value = value;
  st.current.running = running;
  st.current.auto = auto;

  /** setSymbolValue: clamp, clear the average, write to ECU RAM (mirrored into the shared page copy). */
  async function setSymbol(v: number) {
    if (!field) return;
    v = Math.min(255, Math.max(0, Math.trunc(v)));
    st.current.samples = [];
    st.current.value = v;
    setValue(v);
    const old = feed.pages.get(field.page);
    const ecuId = config.vt2ecu.get(field.page);
    if (!old || ecuId === undefined) return;
    const next = old.slice();
    writeRawInt(next, field.offset, field.type, v);
    try {
      for (let i = 0; i < next.length; i++) if (next[i] !== old[i]) await client.writeByte(ecuId, i, next[i]!);
      feed.pages.set(field.page, next);
    } catch (e) {
      setErr(`yazma hatası: ${(e as Error).message}`);
    }
  }

  /** getAverage: push, and once more than WINDOW samples exist drop the oldest and average; else -1. */
  const average = (v: number) => {
    const s = st.current.samples;
    s.push(v);
    if (s.length <= WINDOW) return -1;
    s.shift();
    return s.reduce((a, b) => a + b, 0) / s.length;
  };

  useEffect(() => {
    const ev = new ConfigEvaluator(config);
    return feed.subscribe((sample) => {
      ev.reset({ realtime: sample.data, pages: feed.pages });
      let v: number | undefined;
      try {
        v = ev.value('stallO2');
      } catch {
        v = undefined;
      }
      setO2(v);
      const c = st.current;
      if (!c.running && !c.auto) return setStatus({ text: 'Idle', tone: 'muted' });
      if (v === undefined) return;
      if (v < O2_LIMIT) return setStatus({ text: `HEATING...${c.auto ? '[Autocalibration]' : ''}`, tone: 'warn' });
      if (c.auto) {
        // doAutoCalibration
        if (c.busy || (!c.paused && performance.now() - c.since < STEP_MS)) return;
        const avg = average(v);
        if (avg < 0) return;
        if (Math.abs(avg - TARGET) > TOLERANCE) {
          c.busy = true;
          c.paused = false;
          setStatus({ text: 'Calibration in progress... Please wait', tone: 'warn' });
          void setSymbol(c.value + (avg <= TARGET ? 1 : -1)).finally(() => {
            c.busy = false;
            c.since = performance.now();
          });
        } else {
          c.paused = true;
          setStatus({ text: 'Calibrated', tone: 'ok' });
        }
        return;
      }
      const avg = average(v);
      if (avg > 0 && Math.abs(avg - TARGET) <= TOLERANCE) setStatus({ text: 'Calibrated', tone: 'ok' });
      else setStatus({ text: `${avg <= TARGET ? 'Increase' : 'Decrease'} the WBO2 Calibration value`, tone: 'warn' });
    });
  }, [feed, config, field]);

  async function command(param: number) {
    try {
      await client.testTool(ENA_FLAGS, param);
      return true;
    } catch (e) {
      setErr(`komut hatası: ${(e as Error).message}`);
      return false;
    }
  }

  async function start(withAuto: boolean) {
    setErr('');
    st.current.samples = [];
    st.current.since = performance.now();
    st.current.paused = false;
    if (!(await command(sensor === 0 ? 0x02 : 0x03))) return;
    setRunning(true);
    setAuto(withAuto);
  }

  async function stop() {
    await command(0x00);
    setRunning(false);
    setAuto(false);
  }

  async function send(burn: boolean) {
    await setSymbol(value);
    if (burn)
      try {
        await client.burn();
      } catch (e) {
        setErr(`burn hatası: ${(e as Error).message}`);
      }
  }

  // leaving the frame must not leave the firmware in calibration mode
  const runRef = useRef(running);
  runRef.current = running;
  useEffect(() => () => void (runRef.current && client.testTool(ENA_FLAGS, 0).catch(() => undefined)), [client]);

  const ok = status.tone === 'ok';
  return (
    <div className="panel wbo2-cal">
      <div className="panel-head">
        <strong>WBO2 kalibrasyonu</strong>
        <span className="muted small">serbest hava, hedef %{TARGET} ± {TOLERANCE}</span>
        <button
          className="ghost"
          onClick={async () => {
            if (running) await stop();
            onClose();
          }}
        >
          Kapat
        </button>
      </div>
      {!field && <p className="bad">INI'de wbo2_calibration tanımlı değil.</p>}
      {field && (
        <>
          <ol className="small">
            <li>Motoru kapat (kontak açık), LSU4 sensörünü egzozdan çıkar — serbest havada olmalı.</li>
            <li>
              <b>Start cal.</b> → sensör ısınınca O2 göstergesi %{TARGET} olana dek kalibrasyon değerini ayarla →{' '}
              <b>Stop cal.</b> → <b>Burn</b>.
            </li>
            <li>
              Ya da <b>Auto cal.</b>: değer her {STEP_MS} ms'de 1 adım değişir, “Calibrated” görününce Stop + Burn.
            </li>
          </ol>
          <div className="dlg">
            {dual && (
              <div className="dlg-row">
                <label>Sensör</label>
                <select value={sensor} disabled={running} onChange={(e) => setSensor(Number(e.target.value))}>
                  <option value={0}>WBO2 1 (wbo2_calibration)</option>
                  <option value={1}>WBO2 2 (wbo2_calibration2)</option>
                </select>
                <span />
              </div>
            )}
            <div className="dlg-row">
              <label title={field.name}>WBO2 Calibration</label>
              <input
                className="num"
                type="number"
                min={0}
                max={255}
                value={value}
                onChange={(e) => void setSymbol(Number(e.target.value))}
              />
              <span />
            </div>
          </div>
          <div className="wbo2-gauge">
            <span className={`mono big ${ok ? 'ok' : ''}`}>{o2 === undefined ? '—' : o2.toFixed(1)}</span>
            <span className="muted">% O2 (stallO2)</span>
            <progress max={30} value={o2 ?? 0} />
          </div>
          <p className={`wbo2-status ${status.tone}`}>{status.text}</p>
          <div className="panel-head">
            <button onClick={() => start(false)} disabled={running}>
              Start cal.
            </button>
            <button onClick={stop} disabled={!running}>
              Stop cal.
            </button>
            <button onClick={() => start(true)} disabled={running}>
              Auto cal.
            </button>
            <button onClick={() => send(false)}>Send</button>
            <button className="primary" onClick={() => send(true)}>
              Burn
            </button>
            {err && <span className="bad small">{err}</span>}
          </div>
        </>
      )}
    </div>
  );
}
