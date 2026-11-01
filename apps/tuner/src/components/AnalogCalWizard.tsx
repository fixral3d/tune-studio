import { useEffect, useState } from 'react';
import {
  ANALOG_CAL_CHANNELS,
  calculateAnalogCal,
  ConfigEvaluator,
  userToRaw,
  writeBits,
  writeRawInt,
  VemsClient,
  type AnalogCalResult,
  type VemsConfig,
} from '@vems/core';
import type { RealtimeFeed } from '../lib/realtime';

const MULT_LABEL = ['/ 10', 'x1', 'x2', 'x10'];

/**
 * Analog Input Calibration Wizard (CAL-03, VemsTune AnalogInputCalibrationWizard):
 * two points (Values in Volt ↔ Calibrated Values) → &Calculate → Scale / Scale Multiplier / Offset /
 * Offset Multiplier → Write (mcp_scale_N, mcp_mult_N, mcp_offset_N, mcp_offset_mult_N) or Burn.
 */
export function AnalogCalWizard({
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
  const [ch, setCh] = useState<number>(ANALOG_CAL_CHANNELS[0]);
  const [pts, setPts] = useState({ v1: '', y1: '', v2: '', y2: '' });
  const [res, setRes] = useState<AnalogCalResult>();
  const [calculated, setCalculated] = useState(false);
  const [status, setStatus] = useState('');
  const [live, setLive] = useState<{ volts?: number; value?: number }>({});

  // live input voltage + current calibrated value, to help pick the two points
  useEffect(() => {
    const ev = new ConfigEvaluator(config);
    const val = (n: string) => {
      try {
        return ev.value(n);
      } catch {
        return undefined;
      }
    };
    return feed.subscribe((s) => {
      ev.reset({ realtime: s.data, pages: feed.pages });
      const adc = val(`demuxed_ch${ch}`) ?? val(`raw_adc_ch${ch}`);
      setLive({ volts: adc === undefined ? undefined : (adc * 5) / 4096, value: val(`mcp3208_ch${ch}`) });
    });
  }, [feed, config, ch]);

  function calculate() {
    const n = Object.values(pts).map((t) => Number(t.replace(',', '.')));
    setCalculated(false);
    if (Object.values(pts).some((t) => t.trim() === '') || n.some((x) => !Number.isFinite(x))) return; // ToDouble failed
    const r = calculateAnalogCal(n[0]!, n[1]!, n[2]!, n[3]!);
    setRes(r);
    setCalculated(!!r);
    setStatus(r ? '' : 'hesaplanamadı: noktalar aynı ya da sonuç aralık dışı (Scale 0..2550, Offset ±1270)');
  }

  async function write(burn: boolean) {
    if (!calculated || !res) return;
    const pages = new Map<number, Uint8Array>();
    const page = (p: number) => {
      let b = pages.get(p);
      if (!b) {
        const old = feed.pages.get(p);
        if (!old) throw new Error(`sayfa ${p} yok`);
        pages.set(p, (b = old.slice()));
      }
      return b;
    };
    try {
      for (const [name, v] of [
        [`mcp_scale_${ch}`, res.scale],
        [`mcp_mult_${ch}`, res.mult],
        [`mcp_offset_${ch}`, res.offset],
        [`mcp_offset_mult_${ch}`, res.offsetMult],
      ] as const) {
        const f = config.byName.get(name);
        if (f?.kind === 'scalar') writeRawInt(page(f.page), f.offset, f.type, userToRaw(v, f.scale, f.translate));
        else if (f?.kind === 'bits') writeBits(page(f.page), f, v + f.bitOfs);
        else throw new Error(`INI'de ${name} yok`);
      }
      for (const [p, next] of pages) {
        const old = feed.pages.get(p)!;
        const ecuId = config.vt2ecu.get(p);
        if (ecuId === undefined) throw new Error(`sayfa ${p} için ECU id yok`);
        for (let i = 0; i < next.length; i++) if (next[i] !== old[i]) await client.writeByte(ecuId, i, next[i]!);
        feed.pages.set(p, next);
      }
      if (burn) await client.burn();
      setStatus(burn ? 'yazıldı + burn' : "RAM'e yazıldı — kalıcı olması için Burn");
    } catch (e) {
      setStatus(`yazma hatası: ${(e as Error).message}`);
    }
  }

  const input = (k: keyof typeof pts) => (
    <input className="num" value={pts[k]} onChange={(e) => setPts({ ...pts, [k]: e.target.value })} />
  );

  return (
    <div className="panel analog-cal">
      <div className="panel-head">
        <strong>Analog giriş kalibrasyonu</strong>
        <span className="muted small">MCP3208, 0..5 V</span>
        <button className="ghost" onClick={onClose}>
          Kapat
        </button>
      </div>
      <div className="dlg">
        <div className="dlg-row">
          <label>Select input channel</label>
          <select
            value={ch}
            onChange={(e) => {
              setCh(Number(e.target.value));
              setCalculated(false);
            }}
          >
            {ANALOG_CAL_CHANNELS.map((c) => (
              <option key={c} value={c}>
                Channel {c}
              </option>
            ))}
          </select>
          <span className="muted small mono">
            {live.volts === undefined ? '' : `${live.volts.toFixed(3)} V`}
            {live.value === undefined ? '' : ` · ${live.value.toFixed(2)}`}
          </span>
        </div>
      </div>
      <h4 className="dlg-head">Calibration Input</h4>
      <table className="pages analog-pts">
        <thead>
          <tr>
            <th />
            <th>Values in Volt</th>
            <th>Calibrated Values</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>{input('v1')}</td>
            <td>{input('y1')}</td>
          </tr>
          <tr>
            <td>2</td>
            <td>{input('v2')}</td>
            <td>{input('y2')}</td>
          </tr>
        </tbody>
      </table>
      <div className="panel-head">
        <button className="primary" onClick={calculate}>
          Calculate
        </button>
        <span className="status">{status}</span>
      </div>
      <h4 className="dlg-head">Calibration Result</h4>
      <div className="dlg">
        <div className="dlg-row">
          <label>Scale:</label>
          <span className="mono">{calculated && res ? res.scale : ''}</span>
          <span className="muted small">{calculated && res ? `5 V'ta ${res.slope.toFixed(2)}` : ''}</span>
        </div>
        <div className="dlg-row">
          <label>Scale Multiplier</label>
          <span className="mono">{calculated && res ? MULT_LABEL[res.mult] : ''}</span>
          <span />
        </div>
        <div className="dlg-row">
          <label>Offset:</label>
          <span className="mono">{calculated && res ? res.offset : ''}</span>
          <span className="muted small">{calculated && res ? `0 V'ta ${res.intercept.toFixed(2)}` : ''}</span>
        </div>
        <div className="dlg-row">
          <label>Offset Multiplier</label>
          <span className="mono">{calculated && res ? MULT_LABEL[res.offsetMult] : ''}</span>
          <span />
        </div>
      </div>
      <div className="panel-head">
        <button onClick={() => write(false)} disabled={!calculated}>
          Write
        </button>
        <button className="primary" onClick={() => write(true)} disabled={!calculated}>
          Burn
        </button>
      </div>
    </div>
  );
}
