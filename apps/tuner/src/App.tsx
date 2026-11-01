import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ecuIdForField,
  VemsClient,
  type FirmwareDetails,
  type MenuItem,
  type SiprDescriptor,
  type VemsConfig,
} from '@vems/core';
import { createDemoDevice, loadDemoSeed, type Device } from './lib/device';
import { WebSerialTransport } from './lib/webserial';
import { definesFor, loadSiprDescriptor, loadVemsConfig } from './lib/config';
import { RealtimeFeed } from './lib/realtime';
import { LogRecorder } from './components/LogRecorder';
import { GaugePanel } from './components/GaugePanel';
import { TablesPanel } from './components/TableEditor';
import { TunePanel } from './components/TunePanel';
import { CurvesPanel } from './components/CurveEditor';
import { VeTools } from './components/AnalyzerPanel';
import { TriggerLogPanel } from './components/TriggerLogPanel';
import { FirmwarePanel } from './components/FirmwarePanel';
import { DatalogPanel } from './components/DatalogPanel';
import { MenuPanel } from './components/MenuPanel';
import { badgeClass, runValidation, ValidationPanel, type ValidationRun } from './components/ValidationPanel';
import { ReplayBar } from './components/ReplayBar';
import type { ReplayFeed } from './lib/replay';
import { LiveChips, NAV, NavRail, type Tab } from './components/Shell';
import { Splash } from './components/Splash';
import { CommandPalette, type Command } from './components/CommandPalette';

export default function App() {
  const [config, setConfig] = useState<VemsConfig>();
  const [device, setDevice] = useState<Device>();
  const [details, setDetails] = useState<FirmwareDetails>();
  const [tab, setTab] = useState<Tab>('gauges');
  const [err, setErr] = useState('');

  const [sipr, setSipr] = useState<SiprDescriptor>();

  // INI condition table = base + defines detected from the connected firmware (KNOCK_ALTERNATIVE,
  // HIGHBOOST, …); reloaded when the firmware identity changes
  const definesKey = [...definesFor(details)].sort().join(',');
  useEffect(() => {
    const defines = new Set(definesKey.split(','));
    loadVemsConfig(undefined, defines).then(setConfig).catch((e) => setErr(String(e)));
    loadSiprDescriptor(undefined, defines).then(setSipr).catch((e) => setErr(String(e)));
  }, [definesKey]);

  // one realtime poll loop per connection, shared by gauges and the logger
  const feed = useMemo(() => device && new RealtimeFeed(device.client), [device]);
  useEffect(() => {
    feed?.start();
    return () => feed?.stop();
  }, [feed]);
  // config pages for computed live channels (re-read when the INI changes with firmware defines).
  // `pagesReady` lets Ayarlar/validation reuse this single read instead of reading every page again.
  const [pagesReady, setPagesReady] = useState<Promise<Map<number, Uint8Array>>>();
  useEffect(() => {
    if (!feed || !config) return setPagesReady(undefined);
    const p = feed.loadPages(config).then(() => feed.pages);
    p.catch((e) => setErr(`sayfa okuma hatası: ${(e as Error).message}`));
    setPagesReady(p);
  }, [feed, config]);

  // log replay (LOG-03): while active, gauges follow the log instead of the ECU
  const [replay, setReplay] = useState<ReplayFeed>();
  const [replayIndex, setReplayIndex] = useState<number>();
  useEffect(() => {
    if (!replay) return setReplayIndex(undefined);
    const off = replay.subscribe(() => setReplayIndex(replay.index));
    return () => {
      off();
      replay.dispose();
    };
  }, [replay]);
  function startReplay(r: ReplayFeed) {
    setReplay(r);
    setTab('gauges');
    r.play();
  }
  const gaugeFeed = replay ?? feed;

  // RAM writes from any editor stay "unburned" until Burn (TUNE-03)
  const [unburned, setUnburned] = useState(false);
  useEffect(() => {
    if (!device) return setUnburned(false);
    setUnburned(device.client.unburned);
    device.client.onUnburnedChange = setUnburned;
    return () => {
      device.client.onUnburnedChange = undefined;
    };
  }, [device]);
  useEffect(() => {
    if (!unburned) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unburned]);

  async function burn() {
    try {
      await device?.client.burn();
    } catch (e) {
      setErr(`burn hatası: ${(e as Error).message}`);
    }
  }

  // Config Sanity Check (VAL-01): runs automatically once connected, like VemsTune's auto check
  const [validation, setValidation] = useState<ValidationRun>();
  const [validating, setValidating] = useState(false);
  const [openRequest, setOpenRequest] = useState<MenuItem>();
  async function validate() {
    if (!device || !config) return;
    setValidating(true);
    try {
      setValidation(await runValidation(device.client, config, sipr, details?.version, await pagesReady?.catch(() => undefined)));
    } catch (e) {
      setErr(`doğrulama hatası: ${(e as Error).message}`);
    } finally {
      setValidating(false);
    }
  }
  useEffect(() => {
    setValidation(undefined);
    if (device && config && sipr && details) void validate();
  }, [device, config, sipr, details, pagesReady]);

  async function connectDemo() {
    // demo ECU starts from VemsTune's own default config (falls back to synthetic pages)
    const seed = config && sipr ? await loadDemoSeed(config, sipr).catch(() => ({})) : {};
    const d = createDemoDevice(seed);
    setDevice(d);
    try {
      setDetails(await d.client.readDetails());
    } catch (e) {
      setErr(String(e));
    }
  }

  async function connectSerial() {
    // VemsTune's supported baud rates, preferred first.
    const bauds = [19200, 115200, 57600, 9600];
    const t = new WebSerialTransport();
    try {
      await t.open(bauds[0]!); // prompts for the port once, opens + asserts DTR
    } catch (e) {
      setErr(String(e));
      return;
    }
    try {
      for (let i = 0; i < bauds.length; i++) {
        if (i > 0) await t.reopen(bauds[i]!);
        const client = new VemsClient(t);
        client.start();
        try {
          const details = await client.readDetails(); // probes the ECU at this baud
          const d: Device = { client, transport: t, stop: () => { client.stop(); void t.close(); } };
          setDevice(d);
          setDetails(details);
          return;
        } catch {
          client.stop(); // wrong baud / no reply — detach and try the next
        }
      }
      await t.close();
      setErr('ECU bulunamadı (19200/115200/57600/9600 denendi). Kabloyu ve baud ayarını kontrol et.');
    } catch (e) {
      await t.close();
      setErr(String(e));
    }
  }

  async function disconnect() {
    if (device?.client.unburned && window.confirm('Burn edilmemiş değişiklikler var; ECU kapanınca kaybolur.\nKesmeden önce burn edilsin mi?'))
      await burn();
    device?.stop();
    setDevice(undefined);
    setDetails(undefined);
    setSplash(true);
  }

  // ── shell: splash, command palette, shortcuts ─────────────────────────
  const [splash, setSplash] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tableReq, setTableReq] = useState<{ id: string }>();
  const [curveReq, setCurveReq] = useState<{ id: string }>();
  const showSplash = splash && !device && !replay;

  const enabled = (t: Tab) => {
    const n = NAV.find((x) => x.tab === t)!;
    return n.needs === 'none' || (n.needs === 'feed' ? !!device || !!replay : !!device);
  };
  const go = (t: Tab) => {
    if (enabled(t)) setTab(t);
  };

  const keys = useRef({ go, burn, unburned });
  keys.current = { go, burn, unburned };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.altKey && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        k.go(NAV[(Number(e.key) + 9) % 10]!.tab);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && k.unburned) {
        e.preventDefault();
        void k.burn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commands: Command[] = NAV.filter((n) => enabled(n.tab)).map((n) => ({
    id: `tab:${n.tab}`,
    group: 'Sayfa',
    label: `${n.label} — ${n.title}`,
    hint: `Alt+${(NAV.indexOf(n) + 1) % 10}`,
    run: () => setTab(n.tab),
  }));
  if (device && config) {
    if (unburned)
      commands.unshift({ id: 'act:burn', group: 'Komut', label: "Burn — RAM değişikliklerini flash'a yaz", hint: 'Ctrl+B', run: () => void burn() });
    commands.push(
      { id: 'act:validate', group: 'Komut', label: 'Config Sanity Check çalıştır', run: () => (setTab('validate'), void validate()) },
      { id: 'act:disconnect', group: 'Komut', label: 'Bağlantıyı kes', run: () => void disconnect() },
    );
    for (const t of config.tables.values()) {
      const z = t.zSym ? config.byName.get(t.zSym) : undefined;
      if (z?.kind !== 'array' || z.shape.dims.length !== 2 || ecuIdForField(config, z) === undefined) continue;
      commands.push({
        id: `table:${t.id3d}`,
        group: '3D Tablo',
        label: t.title || t.id3d,
        run: () => {
          setTableReq({ id: t.id3d });
          setTab('tables');
        },
      });
    }
    for (const c of config.curves.values())
      commands.push({
        id: `curve:${c.id}`,
        group: 'Eğri',
        label: c.title || c.id,
        run: () => {
          setCurveReq({ id: c.id });
          setTab('curves');
        },
      });
    config.menus.forEach((m, mi) =>
      m.items.forEach((it, ii) => {
        if (it === 'separator') return;
        commands.push({
          id: `menu:${mi}:${ii}`,
          group: m.title.replace(/&/g, ''),
          label: it.label.replace(/&/g, ''),
          run: () => {
            setOpenRequest({ ...it });
            setTab('settings');
          },
        });
      }),
    );
  } else {
    commands.push(
      { id: 'act:demo', group: 'Komut', label: 'Demo ECU (emülatör) ile bağlan', run: () => void connectDemo() },
      { id: 'act:serial', group: 'Komut', label: "Seri porttan ECU'ya bağlan", run: () => void connectSerial() },
    );
  }

  const nav = NAV.find((n) => n.tab === tab)!;
  const errors = validation?.messages.filter((m) => m.severity === 'error').length ?? 0;

  return (
    <div className="shell">
      <NavRail tab={tab} onTab={go} enabled={enabled} connected={!!device} onConnect={() => !device && setSplash(true)} />

      <div className="main">
        <header className="topbar">
          <div className="crumb">
            <b>{nav.label}</b>
            <span>{nav.title}</span>
          </div>
          <LiveChips feed={gaugeFeed} config={config} />
          <button className="cmdk" onClick={() => setPaletteOpen(true)}>
            <span>⌕ Ara</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="conn">
            {device ? (
              <>
                <span className="conn-pill" title={details?.serialNumber}>
                  <i /> {details?.version ? `fw ${details.version}` : 'bağlı'}
                </span>
                <button
                  className={unburned ? 'warn-btn burn' : 'burn'}
                  onClick={burn}
                  disabled={!unburned}
                  title={unburned ? "RAM'deki değişiklikleri flash'a kalıcı yaz (Ctrl+B)" : 'Burn edilmemiş değişiklik yok'}
                >
                  {unburned ? '⚡ Burn' : 'Burn'}
                </button>
                <button
                  className={`val-badge ${validation ? badgeClass(validation.buttonState) : ''}`}
                  onClick={() => setTab('validate')}
                  title="Config Sanity Check"
                >
                  {validating ? '✔ …' : validation ? `✔ ${errors} hata · ${validation.warnings} uyarı` : '✔ Doğrula'}
                </button>
                {config && feed && (
                  <LogRecorder client={device.client} config={config} sipr={sipr} feed={feed} details={details} />
                )}
                <button onClick={disconnect}>Kes</button>
              </>
            ) : (
              <button className="primary" onClick={() => setSplash(true)} disabled={!config}>
                Bağlan
              </button>
            )}
          </div>
        </header>

        {err && (
          <div className="err">
            <span>{err}</span>
            <button className="ghost" onClick={() => setErr('')}>
              ✕
            </button>
          </div>
        )}
        {replay && <ReplayBar replay={replay} onClose={() => setReplay(undefined)} />}

        <main className="content" key={tab} hidden={tab === 'datalog'}>
          {!config && tab !== 'firmware' && <div className="panel">Konfigürasyon yükleniyor…</div>}

          {tab === 'gauges' && gaugeFeed && config && <GaugePanel feed={gaugeFeed} config={config} />}
          {tab === 'settings' && device && config && (
            <MenuPanel
              client={device.client}
              config={config}
              openRequest={openRequest}
              sipr={sipr}
              firmware={details?.version}
              feed={feed}
              pagesReady={pagesReady}
            />
          )}
          {tab === 'validate' && device && config && (
            <ValidationPanel
              config={config}
              result={validation}
              busy={validating}
              onRun={validate}
              onOpen={(item) => {
                setOpenRequest(item);
                setTab('settings');
              }}
            />
          )}
          {tab === 'tables' && device && config && (
            <TablesPanel client={device.client} config={config} feed={gaugeFeed} request={tableReq} />
          )}
          {tab === 'curves' && device && config && (
            <CurvesPanel client={device.client} config={config} feed={gaugeFeed} request={curveReq} />
          )}
          {tab === 'analyzer' && device && config && (
            <VeTools client={device.client} config={config} feed={gaugeFeed} sipr={sipr} />
          )}
          {tab === 'tune' && device && config && (
            <TunePanel client={device.client} config={config} firmware={details?.version} sipr={sipr} details={details} />
          )}
          {tab === 'firmware' && <FirmwarePanel device={device} feed={feed} config={config} sipr={sipr} details={details} />}
          {tab === 'trigger' && <TriggerLogPanel device={device} feed={feed} details={details} />}

          {!enabled(tab) && config && (
            <div className="panel empty-state">
              <div className="empty-ico">{nav.icon}</div>
              <h3>{nav.label} için bağlantı gerekli</h3>
              <p className="muted">
                Demo ECU ile donanımsız dene ya da seri porttan gerçek ECU'na bağlan. Firmware ve Datalog ekranları
                bağlantı gerektirmez.
              </p>
              <button className="primary" onClick={() => setSplash(true)}>
                Bağlan
              </button>
            </div>
          )}
        </main>
        {/* kept mounted so the loaded log survives tab switches (replay keeps running from it) */}
        <div className="content" hidden={tab !== 'datalog'}>
          <DatalogPanel config={config} sipr={sipr} onReplay={startReplay} replayIndex={replayIndex} />
        </div>
      </div>

      {showSplash && (
        <Splash
          ready={!!config}
          stats={
            config && {
              constants: config.constants.length,
              channels: config.channels.length,
              tables: config.tables.size,
              menus: config.menus.length,
            }
          }
          onDemo={connectDemo}
          onSerial={connectSerial}
          onOpen={(t) => {
            setSplash(false);
            setTab(t);
          }}
        />
      )}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}
