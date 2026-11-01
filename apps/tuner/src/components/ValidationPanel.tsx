import { useState } from 'react';
import {
  FwSymbols,
  readAllPages,
  validateConfig,
  VemsClient,
  type MenuItem,
  type SiprDescriptor,
  type ValidationResult,
  type VemsConfig,
} from '@vems/core';
import { loadChannelDb, loadCriteria, loadFwLayout } from '../lib/config';

export type ValidationRun = ValidationResult & { layout?: string };

/** Read every page from the ECU and run the ConfigCriteria sanity check (VAL-01/02). */
export async function runValidation(
  client: VemsClient,
  config: VemsConfig,
  sipr: SiprDescriptor | undefined,
  firmware: string | undefined,
  /** already-read config pages (RealtimeFeed.pages); read from the ECU when absent/empty */
  shared?: Map<number, Uint8Array>,
): Promise<ValidationRun> {
  const [criteria, channels, pages, layout] = await Promise.all([
    loadCriteria(),
    loadChannelDb(),
    shared?.size ? Promise.resolve(new Map(shared)) : readAllPages(client, config),
    firmware ? loadFwLayout(firmware) : Promise.resolve(undefined),
  ]);
  const fw = layout && sipr ? new FwSymbols(layout, sipr, pages) : undefined;
  return { ...validateConfig(criteria, config, pages, { firmware, fw, channels }), layout: layout?.version };
}

/** Toolbar look of getButtonState: 1 green, 2/3 red, 4/5 gold. */
export const badgeClass = (s: ValidationRun['buttonState']) => (s === 1 ? 'ok' : s <= 3 ? 'bad' : 'warn');

/** Resolve a details link (dialog id, or "Menu:Dialog" text) to a menu item. */
function menuItemFor(config: VemsConfig, href: string, text: string): MenuItem | undefined {
  for (const m of config.menus)
    for (const it of m.items) {
      if (it === 'separator') continue;
      if (it.target === href || `${m.title}:${it.label}`.replace(/&/g, '') === text) return it;
    }
  return undefined;
}

const ICON = { warning: '⚠', error: '✖', info: 'ℹ' } as const;

export function ValidationPanel({
  config,
  result,
  busy,
  onRun,
  onOpen,
}: {
  config: VemsConfig;
  result?: ValidationRun;
  busy: boolean;
  onRun: () => void;
  onOpen: (item: MenuItem) => void;
}) {
  const [sel, setSel] = useState(0);
  const msg = result?.messages[sel];

  function onDetailClick(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const item = menuItemFor(config, a.getAttribute('href') ?? '', a.textContent ?? '');
    if (item) onOpen(item);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <strong>Config Sanity Check</strong>
        <span className="muted">VemsTune ConfigCriteria.xml kuralları + kanal/bit kontrolleri</span>
        <button onClick={onRun} disabled={busy}>{busy ? 'Doğrulanıyor…' : 'Yeniden doğrula'}</button>
        {result && (
          <span className="status">
            {result.layout ? `global.h ${result.layout}` : 'global.h yok'} · fw ile atlanan {result.skipped.length} kural
          </span>
        )}
      </div>
      {!result && <p className="muted">{busy ? 'ECU sayfaları okunuyor…' : 'Doğrulamak için düğmeye bas.'}</p>}
      {result && (
        <>
          <div className="table-wrap val-list">
            <table className="pages">
              <thead>
                <tr><th /><th>Kural</th><th>Mesaj</th></tr>
              </thead>
              <tbody>
                {result.messages.map((m, i) => (
                  <tr key={i} className={`${i === sel ? 'val-sel' : ''} ${m.severity === 'info' ? 'val-summary' : ''}`} onClick={() => setSel(i)}>
                    <td className={m.severity === 'error' ? 'bad' : m.severity === 'warning' ? 'warn' : 'muted'}>{ICON[m.severity]}</td>
                    <td>{m.key}</td>
                    <td>{m.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="val-detail" onClick={onDetailClick}>
            {/* detail HTML comes from the shipped ConfigCriteria.xml (local, trusted) + generated links */}
            {msg ? <div dangerouslySetInnerHTML={{ __html: msg.detail ?? msg.message }} /> : <span className="muted">Mesaj yok.</span>}
          </div>
        </>
      )}
    </div>
  );
}
