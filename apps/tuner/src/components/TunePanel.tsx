import { useState } from 'react';
import {
  applyVemsCfg,
  canonicalKeys,
  compareConfigs,
  differencesDetails,
  differencesSummary,
  isIdentical,
  migrateConfig,
  type MigrationReport,
  deserializeTune,
  parseVemsCfg,
  readAllPages,
  serializeTune,
  VemsClient,
  writeAllPages,
  writeVemsCfg,
  type FirmwareDetails,
  type PageStore,
  type SiprDescriptor,
  type VemsCfgFile,
  type VemsConfig,
} from '@vems/core';
import { loadCriteria, loadFwLayout, loadMigrationData } from '../lib/config';

const two = (n: number) => String(n).padStart(2, '0');
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;

/** .vemscfg header lines as RawLogHelper::getVemsCfgHeader writes them. */
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

/** Project/tune management: read all pages from the ECU, save/load a .vtune snapshot or a
 *  VemsTune .vemscfg (FILE-02/03), and write a tune back to the device (optionally burning). */
export function TunePanel({
  client,
  config,
  firmware,
  sipr,
  details,
}: {
  client: VemsClient;
  config: VemsConfig;
  firmware?: string;
  sipr?: SiprDescriptor;
  details?: FirmwareDetails;
}) {
  const [store, setStore] = useState<PageStore>();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [cfgFile, setCfgFile] = useState<{ name: string; file: VemsCfgFile; eeprom?: number[] }>();
  const [migration, setMigration] = useState<MigrationReport>();
  const [compare, setCompare] = useState<string>();

  /** Open a .vemscfg on top of the ECU's current pages (bytes the file lacks keep their value). */
  async function openVemsCfg(f: File) {
    if (!sipr) return setStatus('SIPR tanımı yüklenmedi');
    setBusy(true);
    try {
      const raw = parseVemsCfg(await f.text());
      // names resolve into the ECU's pages → the ECU firmware's global.h (file version only offline)
      const target = firmware || raw.header.Version || '';
      const layout = await loadFwLayout(target);
      const ctx = { cfg: config, sipr, layout };
      // VemsTune's upload-config pipeline: ReplaceRules → FwRules → filter → defaults → prohibit
      const [criteria, mig] = await Promise.all([loadCriteria(), loadMigrationData(target)]);
      const { file, report } = migrateConfig({
        file: raw,
        ecu: { version: target, serialNumber: details?.serialNumber },
        ecuKeys: canonicalKeys(ctx),
        criteria,
        ...mig,
      });
      const base = store ?? (await readAllPages(client, config));
      const pages: PageStore = new Map([...base].map(([k, v]) => [k, v.slice()]));
      const r = applyVemsCfg(file, ctx, pages);
      setStore(pages);
      setCfgFile({ name: f.name, file, eeprom: r.eeprom });
      setMigration(report);
      const updated = report.fwRules.filter((l) => l.includes('has been updated')).length;
      setStatus(
        `${f.name} (fw ${report.cfgVersion} → ECU ${report.ecuVersion}): ${r.applied} satır uygulandı, ${r.unknown.length} yerleşmedi` +
          ` · FwRules ${updated} güncelleme · varsayılandan ${report.fromDefault.length}${report.partial ? ' · kısmi config' : ''}` +
          ` — ECU'ya yazmak için "ECU'ya yaz"`,
      );
    } catch (e) {
      setStatus(`.vemscfg hatası: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  /** FW-06: the loaded (migrated) config vs a fresh ECU dump, VemsTune's summary/details text. */
  async function compareWithEcu() {
    if (!sipr || !cfgFile) return;
    setBusy(true);
    try {
      const ecuPages = await readAllPages(client, config);
      const layout = await loadFwLayout(firmware || cfgFile.file.header.Version || '');
      const ecu = parseVemsCfg(writeVemsCfg({ cfg: config, sipr, layout }, ecuPages, { header: [] }));
      // reference = ECU, checked = the upload config (whose filtered keys count as intentional)
      const d = compareConfigs(ecu, cfgFile.file, migration?.filtered ?? []);
      setCompare(
        isIdentical(d)
          ? 'Config files are identical.'
          : `Config files aren't identical.\n${differencesSummary(d)}\n${differencesDetails(d)}`,
      );
    } catch (e) {
      setStatus(`karşılaştırma hatası: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveVemsCfg() {
    if (!sipr) return;
    setBusy(true);
    try {
      const pages = store ?? (await readAllPages(client, config));
      const layout = await loadFwLayout(firmware || cfgFile?.file.header.Version || '');
      const text = writeVemsCfg({ cfg: config, sipr, layout }, pages, {
        header: vemscfgHeader(details),
        template: cfgFile?.file,
        eeprom: cfgFile?.eeprom,
      });
      download(text, `${details?.serialNumber ?? 'vems'}-${stamp().replace(/[: ]/g, '-')}.vemscfg`);
      setStatus('.vemscfg kaydedildi');
    } catch (e) {
      setStatus(`kaydetme hatası: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function readAll() {
    setBusy(true);
    setStatus('tüm sayfalar okunuyor…');
    try {
      const s = await readAllPages(client, config);
      setStore(s);
      setStatus(`okundu: ${s.size} sayfa`);
    } catch (e) {
      setStatus(`hata: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!store) return;
    const snap = serializeTune(store, { firmware });
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tune-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.vtune`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function load(file: File) {
    try {
      const snap = JSON.parse(await file.text());
      setStore(deserializeTune(snap));
      setStatus(`yüklendi: ${file.name}`);
    } catch (e) {
      setStatus(`yükleme hatası: ${(e as Error).message}`);
    }
  }

  async function writeToDevice(burn: boolean) {
    if (!store) return;
    setBusy(true);
    try {
      await writeAllPages(client, config, store, {
        burn,
        onProgress: (d, t) => setStatus(`yazılıyor ${Math.round((d / t) * 100)}%`),
      });
      setStatus(burn ? 'yazıldı ve burn edildi' : 'yazıldı (burn yok)');
    } catch (e) {
      setStatus(`yazma hatası: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Proje / Tune</strong>
        <span className="muted">tüm config sayfalarını oku, kaydet, yükle, yaz</span>
        <span className="status">{status}</span>
      </div>
      <div className="btnrow">
        <button onClick={readAll} disabled={busy}>ECU'dan oku</button>
        <button onClick={save} disabled={!store}>.vtune kaydet</button>
        <label className="btn-file">
          .vtune yükle
          <input type="file" accept=".vtune,.json" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
        <label className="btn-file">
          .vemscfg aç
          <input type="file" accept=".vemscfg,.txt" hidden onChange={(e) => e.target.files?.[0] && openVemsCfg(e.target.files[0])} />
        </label>
        <button onClick={saveVemsCfg} disabled={busy || !sipr}>.vemscfg kaydet</button>
        <button onClick={compareWithEcu} disabled={busy || !cfgFile} title="Yüklenen config ile ECU'daki config'i karşılaştır (FW-06)">
          ECU ile karşılaştır
        </button>
        <button onClick={() => writeToDevice(false)} disabled={!store || busy}>ECU'ya yaz</button>
        <button onClick={() => writeToDevice(true)} disabled={!store || busy}>Yaz + Burn</button>
      </div>
      {compare && (
        <details className="migration" open>
          <summary>Karşılaştırma: {compare.split('\n')[0]}</summary>
          <pre className="small mono" style={{ maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', margin: '6px 0' }}>
            {compare.split('\n').slice(1).join('\n')}
          </pre>
        </details>
      )}
      {migration && (
        <details className="migration" open>
          <summary>
            Config taşıma raporu — fw {migration.cfgVersion} → ECU {migration.ecuVersion}
            {migration.defaultConfig && ` · varsayılan config_${migration.defaultConfig}`}
          </summary>
          <div className="small">
            <p>
              Eksik: {migration.missingScalars.length} skaler, {migration.missingTables.length} tablo · varsayılandan doldurulan:{' '}
              {migration.fromDefault.length} · filtrelenen: {migration.filtered.join(', ') || '—'}
              {migration.alien && ' · başka ECU dosyası: kalibrasyonlar atlandı'}
              {migration.prohibit && ` · prohibit_h/l = ${migration.prohibit.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('/')}`}
              {migration.partial && ' · kısmi config (varsayılan/güvenlik adımları atlandı)'}
            </p>
            {/* report lines are built from the shipped ConfigCriteria.xml + config values (local) */}
            <div dangerouslySetInnerHTML={{ __html: `<b>FW Rules replace result</b><ul>${migration.fwRules.map((l) => `<li>${l}</li>`).join('')}</ul>` }} />
            {migration.replace.length > 0 && <div dangerouslySetInnerHTML={{ __html: migration.replace.join('') }} />}
          </div>
        </details>
      )}
      {store && (
        <div className="fw-meta">
          {[...store.entries()].map(([vtPage, buf]) => (
            <div key={vtPage}>
              <span className="muted">page {vtPage} (ecu {config.vt2ecu.get(vtPage)})</span>
              <b>{buf.length} B</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
