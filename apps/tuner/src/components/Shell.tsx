import type { ReactNode } from 'react';
import type { VemsConfig } from '@vems/core';
import { useChannels, type RtSource } from '../lib/gauges';

export type Tab = 'gauges' | 'settings' | 'tables' | 'curves' | 'analyzer' | 'tune' | 'validate' | 'firmware' | 'trigger' | 'datalog';

const I = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

export const NAV: { tab: Tab; label: string; title: string; needs: 'device' | 'feed' | 'none'; icon: ReactNode }[] = [
  {
    tab: 'gauges',
    label: 'Kokpit',
    title: 'Gerçek zamanlı göstergeler',
    needs: 'feed',
    icon: I(<><path d="M4 16a8 8 0 1 1 16 0" /><path d="M12 16l4.5-5" /><circle cx="12" cy="16" r="1.3" /></>),
  },
  {
    tab: 'settings',
    label: 'Ayarlar',
    title: 'INI menüleri ve diyaloglar',
    needs: 'device',
    icon: I(<><path d="M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>),
  },
  {
    tab: 'tables',
    label: 'Tablolar',
    title: '3D harita editörü',
    needs: 'device',
    icon: I(<><path d="M3 15l9 5 9-5-9-5z" /><path d="M3 15V9l9-5 9 5v6" /><path d="M12 10v10" /></>),
  },
  {
    tab: 'curves',
    label: 'Eğriler',
    title: '2D eğri editörü',
    needs: 'device',
    icon: I(<><path d="M4 20V4M4 20h16" /><path d="M6 17c4 0 5-9 9-9 2 0 3 1 4 2" /></>),
  },
  {
    tab: 'analyzer',
    label: 'VE Analiz',
    title: 'Live VE Analyzer · canlı lambda ile VE tune',
    needs: 'device',
    icon: I(<><path d="M3 12h3l2-6 4 12 3-9 2 3h4" /><circle cx="19" cy="5" r="2" /></>),
  },
  {
    tab: 'tune',
    label: 'Tune',
    title: 'Konfigürasyon dosyaları ve karşılaştırma',
    needs: 'device',
    icon: I(<><path d="M14 7l3-3 3 3-3 3" /><path d="M17 4v6" /><path d="M4 20l9-9" /><path d="M10 6a4 4 0 1 0 5 5" /></>),
  },
  {
    tab: 'validate',
    label: 'Doğrula',
    title: 'Config Sanity Check',
    needs: 'device',
    icon: I(<><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>),
  },
  {
    tab: 'firmware',
    label: 'Firmware',
    title: 'Firmware dosyası (.hex / .uhex)',
    needs: 'none',
    icon: I(<><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>),
  },
  {
    tab: 'trigger',
    label: 'Trigger log',
    title: 'Trigger log kaydı ve analizi',
    needs: 'none',
    icon: I(<><path d="M2 17h3V7h3v10h3V7h3v10h3V7h3v10h2" /></>),
  },
  {
    tab: 'datalog',
    label: 'Datalog',
    title: 'Multi Graph ve log oynatma',
    needs: 'none',
    icon: I(<><path d="M3 20h18" /><path d="M4 16l4-6 4 3 4-7 4 5" /></>),
  },
];

export function NavRail({
  tab,
  onTab,
  enabled,
  connected,
  onConnect,
}: {
  tab: Tab;
  onTab(t: Tab): void;
  enabled(t: Tab): boolean;
  connected: boolean;
  onConnect(): void;
}) {
  return (
    <nav className="rail">
      <div className="rail-logo" title="VEMS Tune NX">
        <span className="logo-dot" />
      </div>
      {NAV.map((n, i) => (
        <button
          key={n.tab}
          className={`rail-btn ${tab === n.tab ? 'on' : ''}`}
          disabled={!enabled(n.tab)}
          onClick={() => onTab(n.tab)}
          title={`${n.title}  (Alt+${(i + 1) % 10})`}
        >
          {n.icon}
          <span>{n.label}</span>
        </button>
      ))}
      <div className="rail-foot">
        <button className={`rail-conn ${connected ? 'on' : ''}`} onClick={onConnect} title={connected ? 'Bağlı' : 'Bağlan'}>
          <span />
        </button>
      </div>
    </nav>
  );
}

const CHIPS = [
  { ch: 'rpm', label: 'RPM', digits: 0, max: 8000 },
  { ch: 'map', label: 'MAP', digits: 0, max: 250 },
  { ch: 'lambda', label: 'λ', digits: 3, max: 1.5 },
  { ch: 'coolant', label: 'CLT', digits: 0, max: 120 },
];

/** Always-visible live readouts in the top bar. */
export function LiveChips({ feed, config }: { feed?: RtSource; config?: VemsConfig }) {
  const { values } = useChannels(feed, config, CHIPS.map((c) => c.ch), 2);
  if (!feed) return null;
  return (
    <div className="live-chips">
      {CHIPS.map((c) => {
        const v = values[c.ch];
        return (
          <div className="lchip" key={c.ch}>
            <span>{c.label}</span>
            <b>{v === undefined ? '—' : v.toFixed(c.digits)}</b>
            <i style={{ width: `${v === undefined ? 0 : Math.max(0, Math.min(1, v / c.max)) * 100}%` }} />
          </div>
        );
      })}
    </div>
  );
}
