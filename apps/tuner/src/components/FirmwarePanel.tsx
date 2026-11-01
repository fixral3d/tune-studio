import { useState } from 'react';
import {
  applyVemsCfg,
  canonicalKeys,
  compareConfigs,
  differencesSummary,
  loadFirmware,
  migrateConfig,
  parseVemsCfg,
  readAllPages,
  uploadFirmware,
  writeAllPages,
  writeVemsCfg,
  type FirmwareDetails,
  type FirmwareImage,
  type PageStore,
  type SiprDescriptor,
  type UploadProgress,
  type VemsConfig,
} from '@vems/core';
import { loadCriteria, loadFwLayout, loadMigrationData } from '../lib/config';
import type { Device } from '../lib/device';
import type { RealtimeFeed } from '../lib/realtime';

const two = (n: number) => String(n).padStart(2, '0');
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Re-read ECU details after a flash. The "E." leave command reboots the application, so the ECU is
 * silent for a while before it answers TF again (VemsTune re-probes too) — hence the retries. Some
 * ECUs, notably the ESP32 sim, also drop + re-enumerate their USB on bootloader exit, which kills
 * the open port's read stream; reopening the same port re-acquires it. A couple of plain retries
 * run first: a real ECU on an FTDI/UART cable just needs the reboot time, and reopening it early
 * would needlessly toggle DTR.
 */
async function redetect(device: Device, attempts = 10): Promise<FirmwareDetails> {
  const transport = device.transport as Device['transport'] & { reopen?: (b?: number) => Promise<void> };
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await device.client.readDetails();
    } catch (e) {
      last = e;
      // Plain retries first (a rebooting ECU on an FTDI/UART cable just needs a few seconds and its
      // port survives). Only after that fall back to reopening — for a device that dropped its USB.
      if (i >= 3 && transport.reopen) {
        try {
          await transport.reopen();
        } catch {
          /* keep trying */
        }
      }
      await sleep(800);
    }
  }
  throw last instanceof Error ? last : new Error('ECU yeniden bağlanmadı (timeout)');
}

/** .vemscfg header lines, matching TunePanel / RawLogHelper::getVemsCfgHeader. */
function vemscfgHeader(d?: FirmwareDetails) {
  const raw = d?.serialNumber ? [...d.serialNumber].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0') + ' ').join('') : '';
  return [
    { key: 'CurrentTime', value: stamp() },
    { key: 'Creator', value: 'VEMS Tuner 0.1' },
    { key: 'Version', value: d?.version ?? '' },
    { key: 'SerialNumber', value: d?.serialNumber ?? '' },
    { key: 'SerialNumber Raw', value: raw },
    { key: 'CompilationTime', value: d?.compilationTime ?? '' },
    { key: 'Signature', value: d?.mtCodeVer ?? '' },
  ];
}

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

type StepStatus = 'pending' | 'run' | 'ok' | 'err' | 'skip';
interface Step {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

const STEP_ICON: Record<StepStatus, string> = { pending: '○', run: '◐', ok: '✓', err: '✖', skip: '–' };

/** Offline firmware file inspector + (when connected) flash-to-ECU and FW-10 upgrade wizard. */
export function FirmwarePanel({
  device,
  feed,
  config,
  sipr,
  details,
  onDetails,
}: {
  device?: Device;
  feed?: RealtimeFeed;
  config?: VemsConfig;
  sipr?: SiprDescriptor;
  details?: FirmwareDetails;
  onDetails?: (d: FirmwareDetails) => void;
}) {
  const [img, setImg] = useState<FirmwareImage>();
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [progress, setProgress] = useState<UploadProgress>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const [steps, setSteps] = useState<Step[]>();

  async function onFile(file: File) {
    setErr('');
    setResult(undefined);
    setProgress(undefined);
    setSteps(undefined);
    try {
      const text = await file.text();
      const pageSize = /\.chex2?$|\.uclt$|round/i.test(file.name) ? 128 : 256;
      setImg(loadFirmware(text, { pageSize }));
      setName(file.name);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function loadMarker(): Promise<FirmwareImage | undefined> {
    if (img?.kind !== 'crypto-chex') return undefined;
    const base = import.meta.env.BASE_URL;
    const file = /\.chex2$/i.test(name) ? 'markerword_erase.chex2' : /\.chex$/i.test(name) ? 'markerword_erase.chex' : 'markerword_erase.uhex';
    const res = await fetch(`${base}config/fw/${file}`);
    if (!res.ok) throw new Error(`marker dosyası okunamadı (${file})`);
    return loadFirmware(await res.text(), { pageSize: file.endsWith('.uhex') ? 256 : 128 });
  }

  const confirmWarning = (extra = '') =>
    window.confirm(
      `${name} ECU'ya yüklenecek (${img!.pages.length} sayfa).\n\n` +
        'Yakıt pompasını kapatın, enjektör ve bobin bağlantılarını çıkarın, besleme gerilimi stabil olsun.\n' +
        'Yükleme sırasında bağlantıyı KESMEYİN.\n' +
        extra +
        '\nDevam edilsin mi?',
    );

  async function flash() {
    if (!device || !img) return;
    if (!confirmWarning('Yüklemeden sonra bir config yükleyip doğrulayın.\n')) return;
    setBusy(true);
    setResult(undefined);
    setProgress(undefined);
    setSteps(undefined);
    try {
      const marker = await loadMarker();
      // Hand the port to the raw bootloader protocol: stop realtime polling and the TF session first.
      feed?.stop();
      device.client.stop();
      const res = await uploadFirmware(device.transport, img, { marker, onProgress: setProgress });
      setResult(
        res.mismatches.length
          ? { ok: false, text: `Doğrulama HATASI — ${res.mismatches.length} sayfa farklı (ör. 0x${res.mismatches[0]!.toString(16)}). Yüklemeyi tekrarlayın.` }
          : { ok: true, text: `Tamam — ${res.pagesWritten} sayfa yazıldı, doğrulama: firmware aynı. ECU: ${res.serial}` },
      );
    } catch (e) {
      setResult({ ok: false, text: 'Hata: ' + (e as Error).message });
    } finally {
      device.client.start();
      feed?.start();
      try { onDetails?.(await redetect(device)); } catch { /* keep connect-time details */ }
      setBusy(false);
    }
  }

  // FW-10: back up config → flash → re-detect → (same version only) migrate + write config + verify.
  async function wizard() {
    if (!device || !img || !config || !sipr) return;
    if (!confirmWarning('Önce mevcut config indirilecek (yedek), sonra firmware yüklenecek.\n')) return;

    const init: Step[] = [
      { key: 'backup', label: 'Mevcut config yedeklen/ indiriliyor', status: 'pending' },
      { key: 'flash', label: 'Firmware yükleniyor + doğrulanıyor', status: 'pending' },
      { key: 'detect', label: 'Yeni firmware algılanıyor', status: 'pending' },
      { key: 'migrate', label: "Config yeni sürüme taşınıyor", status: 'pending' },
      { key: 'writecfg', label: "Config ECU'ya yazılıyor + burn", status: 'pending' },
      { key: 'verify', label: 'Config doğrulanıyor', status: 'pending' },
    ];
    setSteps(init);
    setBusy(true);
    setResult(undefined);
    const cur = [...init];
    const set = (key: string, status: StepStatus, detail?: string) => {
      const i = cur.findIndex((s) => s.key === key);
      cur[i] = { ...cur[i]!, status, detail: detail ?? cur[i]!.detail };
      setSteps([...cur]);
    };

    const client = device.client;
    try {
      // 1. backup current config (downloaded so the user always has a pre-flash copy)
      set('backup', 'run');
      const oldVer = details?.version ?? '';
      const ctxOld = { cfg: config, sipr, layout: await loadFwLayout(oldVer) };
      const backupText = writeVemsCfg(ctxOld, await readAllPages(client, config), { header: vemscfgHeader(details) });
      download(backupText, `${details?.serialNumber ?? 'vems'}-backup-${stamp().replace(/[: ]/g, '-')}.vemscfg`);
      const backup = parseVemsCfg(backupText);
      set('backup', 'ok', 'yedek indirildi');

      // 2. flash firmware
      set('flash', 'run');
      const marker = await loadMarker();
      feed?.stop();
      client.stop();
      const up = await uploadFirmware(device.transport, img, { marker, onProgress: (p) => set('flash', 'run', `${p.phase} ${p.page}/${p.total}`) });
      client.start();
      if (up.mismatches.length) {
        set('flash', 'err', `${up.mismatches.length} sayfa farklı — durduruldu`);
        throw new Error('firmware doğrulaması başarısız');
      }
      set('flash', 'ok', `${up.pagesWritten} sayfa, firmware aynı`);

      // 3. re-detect firmware on the now-rebooted ECU (retries while it reboots)
      set('detect', 'run');
      const nd = await redetect(device);
      const newVer = nd.version ?? '';
      onDetails?.(nd);
      set('detect', 'ok', `ECU: ${nd.serialNumber ?? '?'} · fw ${newVer || '?'}`);

      // 4+. config restore is only safe when the firmware version is unchanged: the app's loaded
      // INI/layout matches the ECU. On a version change the correct INI must be reloaded first.
      if (!newVer || newVer !== oldVer) {
        for (const k of ['migrate', 'writecfg', 'verify']) set(k, 'skip');
        set('migrate', 'skip', `fw ${oldVer || '?'} → ${newVer || '?'}: yeniden bağlanıp Tune sekmesinden yedeği geri yükleyin`);
        setResult({ ok: true, text: 'Firmware yüklendi. Config için: Kes → Bağlan, sonra Tune sekmesinde indirilen yedek .vemscfg dosyasını açın (doğru INI ile taşınır).' });
        return;
      }

      // 4. migrate the backup config to the (same) ECU version
      set('migrate', 'run');
      const ctxNew = { cfg: config, sipr, layout: await loadFwLayout(newVer) };
      const [criteria, mig] = await Promise.all([loadCriteria(), loadMigrationData(newVer)]);
      const { file, report } = migrateConfig({
        file: backup,
        ecu: { version: newVer, serialNumber: nd.serialNumber },
        ecuKeys: canonicalKeys(ctxNew),
        criteria,
        ...mig,
      });
      set('migrate', 'ok', `${report.fwRules.filter((l) => l.includes('has been updated')).length} FwRules · varsayılandan ${report.fromDefault.length}${report.partial ? ' · kısmi' : ''}`);

      // 5. apply + write config to ECU
      set('writecfg', 'run');
      const base: PageStore = new Map([...(await readAllPages(client, config))].map(([k, v]) => [k, v.slice()]));
      applyVemsCfg(file, ctxNew, base);
      await writeAllPages(client, config, base, { burn: true });
      set('writecfg', 'ok', 'yazıldı ve burn edildi');

      // 6. verify: fresh ECU dump vs migrated config
      set('verify', 'run');
      const ecuDump = parseVemsCfg(writeVemsCfg(ctxNew, await readAllPages(client, config), { header: [] }));
      const cmp = compareConfigs(ecuDump, file, report.filtered);
      // "intentionally filtered" scalars (calibration / serial-bound) are deliberately not written —
      // the ECU keeps its own values, so they are expected and don't count as a mismatch.
      const realDiff =
        cmp.missingScalars.length + cmp.extraScalars.length + cmp.differentScalars.length + cmp.missingTables.length + cmp.extraTables.length + cmp.differentTables.length;
      const ok = realDiff === 0;
      const note = cmp.filteredScalars.length ? ` (${cmp.filteredScalars.length} kasıtlı filtreli skaler — normal)` : '';
      set('verify', ok ? 'ok' : 'err', ok ? 'config ECU ile aynı' + note : differencesSummary(cmp).split('\n')[0]);
      setResult({
        ok,
        text: ok
          ? 'Firmware yüklendi ve config geri yazıldı — doğrulama tamam.' + note
          : 'Firmware yüklendi; config doğrulamasında fark var (detaylar yukarıda).',
      });
    } catch (e) {
      const running = cur.find((s) => s.status === 'run');
      if (running) set(running.key, 'err', (e as Error).message);
      setResult({ ok: false, text: 'Sihirbaz durdu: ' + (e as Error).message });
    } finally {
      client.start();
      feed?.start();
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Firmware Dosyası</strong>
        <span className="muted">.hex / .uhex / .chex — çevrimdışı inceleme; bağlıysa ECU'ya yükleme</span>
      </div>

      <details className="fw-guide">
        <summary>Yükleme rehberi — ilk gerçek ECU denemesi</summary>
        <ol>
          <li>
            <b>Önce yedek ECU'da dene.</b> İlk denemeyi çalışan/canlı beyinde değil, yedek bir beyinde yap. Yükleme
            yarıda kesilirse beyin bootloader'da kalır (tuğla olmaz, tekrar yüklenir), yine de riski yedekte tut.
          </li>
          <li>
            <b>Config'i yedekle.</b> Tune ekranından mevcut config'i <span className="mono">.vemscfg</span> olarak kaydet.
            Firmware sonrası kalibrasyonları geri yüklemek için şart. (Aşağıdaki “Sihirbaz” bunu otomatik yapar.)
          </li>
          <li>
            <b>Güvenli koşullar.</b> Motor kapalı, kontak açık, besleme gerilimi stabil. Zayıf güç, en sık yükleme
            hatası sebebidir.
          </li>
          <li>
            <b>Dosya tipi.</b> <span className="mono">.uhex</span>'i olduğu gibi yükle — gerçek bootloader kendi
            anahtarıyla içeride çözer. Düz <span className="mono">.hex</span> varsa o da olur. Checksum “geçti” olmalı.
          </li>
          <li>
            <b>Yüklerken bağlantıyı kesme.</b> İlerleme sırasında kabloyu/USB'yi çıkarma, sayfayı kapatma.
          </li>
          <li>
            <b>Doğrula ve config'i geri yükle.</b> “firmware is identical” bekle; sonra yedeklediğin config'i yükle.
            Farklı sürümse taşıma (migrate) tune'u aktarır, beyin kendi kalibrasyonunu korur.
          </li>
          <li>
            <b>Hata olursa panik yok.</b> Beyin bootloader'da bekler; yüklemeyi tekrarla. “Sihirbaz”, yedek→yükle→taşı
            adımlarını tek akışta yapar.
          </li>
        </ol>
      </details>

      <label className="dropzone">
        <input
          type="file"
          accept=".hex,.uhex,.chex,.chex2,.vhex,.shex,.lhex,.phex"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          hidden
        />
        <span>Bir firmware dosyası seç ya da buraya sürükle</span>
      </label>

      {err && <div className="err">{err}</div>}

      {img && (
        <>
          <div className="fw-meta">
            <div><span className="muted">Dosya</span><b>{name}</b></div>
            <div><span className="muted">Tip</span><b>{img.kind === 'crypto-chex' ? 'Şifreli (Crypto CHEX)' : 'Intel HEX (düz)'}</b></div>
            <div><span className="muted">Sayfa</span><b>{img.pages.length}</b></div>
            <div><span className="muted">Sayfa boyu</span><b>{img.pageSize} B</b></div>
            <div><span className="muted">Toplam</span><b>{img.totalBytes} B</b></div>
            <div><span className="muted">Checksum</span><b className={img.checksumOk ? 'ok' : 'bad'}>{img.checksumOk ? 'geçti' : 'HATA'}</b></div>
            <div><span className="muted">Adres aralığı</span><b>0x{Math.min(...img.pages.map((p) => p.address)).toString(16)}–0x{(Math.max(...img.pages.map((p) => p.address)) + img.pageSize).toString(16)}</b></div>
            <div><span className="muted">V3 marker</span><b>{img.hasV3Marker ? 'var' : '—'}</b></div>
            <div><span className="muted">Crypto etiketli sayfa</span><b>{img.pages.filter((p) => p.tag !== undefined).length}</b></div>
          </div>

          {img.kind === 'crypto-chex' && (
            <p className="muted small">
              Not: Şifreli firmware PC'de çözülmez (orijinal VemsTune de çözmez). Sayfalar şifreli
              olarak gösterilir ve ECU'ya olduğu gibi yüklenir; şifreyi ECU'nun bootloader'ı çözer.
              Stok .uhex yüklemesi oturum anahtarı/parola gerektirmez.
            </p>
          )}

          <div className="fw-upload">
            {device ? (
              <>
                <div className="fw-actions">
                  <button className="btn primary" onClick={flash} disabled={busy || !img.checksumOk}>
                    {busy ? 'Çalışıyor…' : "ECU'ya yükle"}
                  </button>
                  {config && sipr && (
                    <button className="btn" onClick={wizard} disabled={busy || !img.checksumOk}>
                      Firmware Upgrade Wizard
                    </button>
                  )}
                </div>
                {!img.checksumOk && <span className="muted small">Checksum hatalı dosya yüklenmez.</span>}

                {busy && progress && !steps && (
                  <div className="fw-progress">
                    <div className="fw-progress-label">
                      {progress.phase === 'enter' && 'Bootloader bekleniyor…'}
                      {progress.phase === 'erase' && 'Sayfalar siliniyor…'}
                      {progress.phase === 'marker' && 'Marker sayfası…'}
                      {progress.phase === 'upload' && `Yazılıyor ${progress.page}/${progress.total}`}
                      {progress.phase === 'verify' && `Doğrulanıyor ${progress.page}/${progress.total}`}
                      {progress.phase === 'done' && 'Tamamlandı'}
                    </div>
                    <div className="fw-progress-bar">
                      <span style={{ width: `${progress.total ? (progress.page / progress.total) * 100 : 0}%` }} />
                    </div>
                  </div>
                )}

                {steps && (
                  <ol className="fw-steps">
                    {steps.map((s) => (
                      <li key={s.key} className={`fw-step ${s.status}`}>
                        <span className="fw-step-ico">{STEP_ICON[s.status]}</span>
                        <span className="fw-step-label">{s.label}</span>
                        {s.detail && <span className="fw-step-detail muted">{s.detail}</span>}
                      </li>
                    ))}
                  </ol>
                )}

                {result && <div className={result.ok ? 'ok-box' : 'err'}>{result.text}</div>}
              </>
            ) : (
              <span className="muted small">ECU'ya yüklemek için önce bağlanın.</span>
            )}
          </div>

          <div className="table-wrap fw-pages">
            <table className="pages">
              <thead>
                <tr><th>#</th><th>Adres</th><th>Dolu (B)</th><th>Crypto etiket</th></tr>
              </thead>
              <tbody>
                {img.pages.map((p) => (
                  <tr key={p.index}>
                    <td>{p.index}</td>
                    <td>0x{p.address.toString(16).padStart(5, '0')}</td>
                    <td>{p.filledBytes}</td>
                    <td className="mono">{p.tag !== undefined ? '0x' + p.tag.toString(16).padStart(8, '0') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
