import { useMemo, useState } from 'react';
import type { VemsConfig } from '@vems/core';
import { useChannels, useGaugeDb, type GaugeDesc, type RtSource } from '../lib/gauges';
import { AnalogGauge, FlagLed, gaugeTitle, Spark } from './Gauge';

export type { RtSource } from '../lib/gauges';

/** slot 0 = centre tachometer, 1–4 = wings, 5–8 = lower row (VemsTune "Main" gauge group spirit) */
const DEFAULT_CHANNELS = ['rpm', 'map', 'lambda', 'coolant', 'spark', 'mat', 'batteryVoltage', 'pulseWidth', 'egt'];
const SPARKS = [
  { channel: 'rpm', label: 'RPM', unit: '', digits: 0, color: '#3ee6c1' },
  { channel: 'map', label: 'MAP', unit: 'kPa', digits: 0, color: '#ffb547' },
  { channel: 'lambda', label: 'Lambda', unit: 'λ', digits: 3, color: '#ff5fd2' },
  { channel: 'coolant', label: 'CLT', unit: '°C', digits: 0, color: '#6aa8ff' },
];
const LS_SLOTS = 'vt.cockpit.slots';
const LS_THEME = 'vt.cockpit.theme';

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
}

/** Cockpit: VemsTune gauge descriptors, flags and themes driven by the live feed or a log replay. */
export function GaugePanel({ feed, config }: { feed: RtSource; config: VemsConfig }) {
  const db = useGaugeDb();
  const [saved, setSaved] = useState<string[] | undefined>(() => {
    try {
      return JSON.parse(lsGet(LS_SLOTS) ?? 'null') ?? undefined;
    } catch {
      return undefined;
    }
  });
  const [themeName, setThemeName] = useState(() => lsGet(LS_THEME) ?? '');
  const [editing, setEditing] = useState<number>();

  const slots: GaugeDesc[] = useMemo(() => {
    if (!db) return [];
    const byName = new Map(db.gauges.map((g) => [g.name, g]));
    return DEFAULT_CHANNELS.map(
      (ch, i) => byName.get(saved?.[i] ?? '') ?? db.gauges.find((g) => g.channel === ch) ?? db.gauges[i]!,
    );
  }, [db, saved]);
  const theme = db?.themes.find((t) => t.name === themeName) ?? db?.themes.find((t) => t.name === db.default) ?? db?.themes[0];

  const names = useMemo(
    () => [...slots.map((g) => g.channel), ...SPARKS.map((s) => s.channel), ...(db?.flags.map((f) => f.name) ?? [])],
    [slots, db],
  );
  const { values, hist } = useChannels(feed, config, names);

  if (!db || !theme) return <div className="panel">Gösterge tanımları yükleniyor…</div>;

  function choose(i: number, name: string) {
    const next = slots.map((g) => g.name);
    next[i] = name;
    setSaved(next);
    lsSet(LS_SLOTS, JSON.stringify(next));
    setEditing(undefined);
  }

  const cell = (i: number, cls: string) => {
    const g = slots[i];
    if (!g) return null;
    return (
      <div className={`cp-slot ${cls}`} key={i}>
        <AnalogGauge desc={g} theme={theme} value={values[g.channel]} onTitleClick={() => setEditing(i)} />
        <button className="cp-cfg" onClick={() => setEditing(editing === i ? undefined : i)} title="Göstergeyi değiştir">
          ⚙
        </button>
        {editing === i && (
          <div className="cp-pop">
            {db.gauges.map((d) => (
              <button
                key={d.name}
                className={`cp-pop-item${d.name === g.name ? ' on' : ''}`}
                onClick={() => choose(i, d.name)}
              >
                {gaugeTitle(d)} · {d.channel} ({d.lo}…{d.hi})
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="cockpit">
      <div className="cp-bar">
        <span className="cp-kicker">Kokpit</span>
        <span className="muted small">VemsTune gösterge tanımları · {db.gauges.length} gösterge · başlığa tıkla: değiştir</span>
        <div className="seg">
          {db.themes.map((t) => (
            <button
              key={t.name}
              className={t.name === theme.name ? 'on' : ''}
              onClick={() => {
                setThemeName(t.name);
                lsSet(LS_THEME, t.name);
              }}
            >
              {t.name}
            </button>
          ))}
        </div>
        <button
          className="ghost"
          onClick={() => {
            setSaved(undefined);
            lsSet(LS_SLOTS, 'null');
          }}
        >
          Varsayılan
        </button>
      </div>

      <div className="cp-main">
        <div className="cp-wing">{[1, 3].map((i) => cell(i, 'side'))}</div>
        {cell(0, 'hero')}
        <div className="cp-wing">{[2, 4].map((i) => cell(i, 'side'))}</div>
      </div>
      <div className="cp-row">{[5, 6, 7, 8].map((i) => cell(i, 'small'))}</div>

      <div className="cp-sparks">
        {SPARKS.map((s) => (
          <Spark key={s.channel} data={hist[s.channel] ?? []} color={s.color} label={s.label} unit={s.unit} digits={s.digits} />
        ))}
      </div>

      <div className="cp-flags">
        {db.flags.map((f) => (
          <FlagLed key={f.name} desc={f} value={values[f.name]} />
        ))}
      </div>
    </div>
  );
}
