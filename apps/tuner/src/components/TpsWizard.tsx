import { useEffect, useState } from 'react';
import { ConfigEvaluator, readScalar, userToRaw, writeRawInt, VemsClient, type VemsConfig } from '@vems/core';
import type { RealtimeFeed } from '../lib/realtime';

const STEPS = ['Hoş geldin', 'Tam gaz', 'Rölanti', 'Bitir'];
const adc = (v: number) => Math.min(255, Math.max(0, Math.trunc(v)));

/**
 * TPS min/max calibration wizard (CAL-02, VemsTune TPSCalibrationWizard):
 * captures the live tpsADC at full throttle (→ tps_high) and released (→ tps_low),
 * writes both and burns on Finish; Cancel restores the original values if anything was written.
 */
export function TpsWizard({
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
  const [step, setStep] = useState(0);
  const [live, setLive] = useState<number>();
  const [high, setHigh] = useState(0);
  const [low, setLow] = useState(0);
  const [written, setWritten] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const hiF = config.byName.get('tps_high');
  const loF = config.byName.get('tps_low');
  const fields = hiF?.kind === 'scalar' && loF?.kind === 'scalar' ? { hiF, loF } : undefined;
  const current = (f: NonNullable<typeof fields>['hiF']) => {
    const buf = feed.pages.get(f.page);
    return buf ? adc(readScalar(buf, f)) : undefined;
  };
  // originals as they were when the wizard opened (restoreOriginalValues)
  const [orig] = useState(() => fields && { high: current(fields.hiF), low: current(fields.loF) });

  // MinMaxTPSPage.refresh: latest tpsADC, rounded with the FPU in truncate mode
  useEffect(() => {
    const ev = new ConfigEvaluator(config);
    return feed.subscribe((s) => {
      ev.reset({ realtime: s.data, pages: feed.pages });
      try {
        const v = ev.value('tpsADC');
        setLive(v === undefined ? undefined : adc(v));
      } catch {
        setLive(undefined);
      }
    });
  }, [feed, config]);

  /** Write tps_high/tps_low (only changed bytes) and mirror into the shared page copy. */
  async function write(hi: number, lo: number) {
    if (!fields) return;
    for (const [f, v] of [
      [fields.hiF, hi],
      [fields.loF, lo],
    ] as const) {
      const old = feed.pages.get(f.page);
      const ecuId = config.vt2ecu.get(f.page);
      if (!old || ecuId === undefined) throw new Error(`sayfa ${f.page} yok`);
      const next = old.slice();
      writeRawInt(next, f.offset, f.type, userToRaw(v, f.scale, f.translate));
      for (let i = 0; i < next.length; i++) if (next[i] !== old[i]) await client.writeByte(ecuId, i, next[i]!);
      feed.pages.set(f.page, next);
    }
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      await fn();
      return true;
    } catch (e) {
      setStatus(`${label} hatası: ${(e as Error).message}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function writeRam() {
    if (await run('yazılıyor', () => write(high, low))) {
      setWritten(true);
      setStatus('RAM\'e yazıldı — kalıcı olması için Bitir (Burn)');
    }
  }

  async function finish() {
    if (await run('yazılıyor + burn', async () => {
      await write(high, low);
      await client.burn();
    }))
      onClose();
  }

  async function cancel() {
    if (written && orig?.high !== undefined && orig.low !== undefined) {
      if (!(await run('orijinal değerler geri yükleniyor', () => write(orig.high!, orig.low!)))) return;
    }
    onClose();
  }

  function next() {
    if (step === 1) setHigh(live ?? 0);
    if (step === 2) setLow(live ?? 0);
    setStep(step + 1);
  }

  const swapped = step === 3 && high <= low;

  return (
    <div className="panel tps-wizard">
      <div className="panel-head">
        <strong>TPS min/max kalibrasyonu</strong>
        <span className="muted small">
          {STEPS.map((s, i) => (
            <span key={s} className={i === step ? 'on' : undefined}>
              {i > 0 && ' › '}
              {s}
            </span>
          ))}
        </span>
      </div>
      {!fields && <p className="bad">INI'de tps_high / tps_low tanımlı değil.</p>}
      {fields && step === 0 && (
        <p>
          Bu sihirbaz gaz kelebeği konum sensörünün (TPS) uç değerlerini ölçer. Motor <strong>çalışmıyorken</strong>,
          kontak açık olmalı. Mevcut değerler: TPS 100% = <span className="mono">{orig?.high ?? '—'}</span>, TPS 0% ={' '}
          <span className="mono">{orig?.low ?? '—'}</span> ADC.
        </p>
      )}
      {fields && (step === 1 || step === 2) && (
        <>
          <p>
            {step === 1
              ? 'Gaz pedalına sonuna kadar basılı tut ve İleri\'ye tıkla.'
              : 'Gaz pedalını bırak (en düşük konum) ve İleri\'ye tıkla.'}
          </p>
          <div className="tps-live">
            <span className="mono big">{live ?? '—'}</span> <span className="muted">tpsADC</span>
            <progress max={255} value={live ?? 0} />
          </div>
        </>
      )}
      {fields && step === 3 && (
        <>
          <p>
            Ölçülen: TPS 100% (tps_high) = <span className="mono">{high}</span>, TPS 0% (tps_low) ={' '}
            <span className="mono">{low}</span> ADC.
          </p>
          {swapped && <p className="warn">Uyarı: tam gaz değeri rölantiden büyük değil — sensör ters ya da ölçüm hatalı olabilir.</p>}
          <p className="muted small">Bitir değerleri yazar ve Burn ile kalıcı yapar. İptal, yazılan değerleri geri alır.</p>
        </>
      )}
      <div className="panel-head">
        <button onClick={cancel} disabled={busy}>
          İptal
        </button>
        <button onClick={() => setStep(step - 1)} disabled={busy || step === 0}>
          ‹ Geri
        </button>
        {step < 3 ? (
          <button className="primary" onClick={next} disabled={!fields || (step > 0 && live === undefined)}>
            İleri ›
          </button>
        ) : (
          <>
            <button onClick={writeRam} disabled={busy}>
              RAM'e yaz
            </button>
            <button className="primary" onClick={finish} disabled={busy}>
              Bitir (Burn)
            </button>
          </>
        )}
        <span className="status">{status}</span>
      </div>
    </div>
  );
}
