import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run(): void;
}

const fold = (s: string) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');

/** Subsequence match; rewards consecutive hits and word starts. -1 = no match. */
function score(text: string, q: string): number {
  if (!q) return 0;
  const t = fold(text);
  let s = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return -1;
    run = at === ti ? run + 1 : 0;
    s += 1 + run * 2 + (at === 0 || t[at - 1] === ' ' ? 3 : 0);
    ti = at + 1;
  }
  return s - t.length * 0.01;
}

export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose(): void; commands: Command[] }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setIdx(0);
    setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  const hits = useMemo(() => {
    const fq = fold(q.trim()).replace(/\s+/g, '');
    return commands
      .map((c) => ({ c, s: Math.max(score(c.label, fq), score(`${c.group} ${c.label}`, fq) - 2) }))
      .filter((h) => h.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 80)
      .map((h) => h.c);
  }, [q, commands]);

  useEffect(() => {
    list.current?.querySelector('.cmd-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  if (!open) return null;

  const run = (c?: Command) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div className="cmd-veil" onMouseDown={onClose}>
      <div className="cmd" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder="Tablo, eğri, ayar diyaloğu ya da komut ara…"
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setIdx((i) => Math.min(hits.length - 1, i + 1));
            else if (e.key === 'ArrowUp') setIdx((i) => Math.max(0, i - 1));
            else if (e.key === 'Enter') run(hits[idx]);
            else if (e.key === 'Escape') onClose();
            else return;
            e.preventDefault();
          }}
        />
        <div className="cmd-list" ref={list}>
          {hits.length === 0 && <div className="cmd-empty">Sonuç yok</div>}
          {hits.map((c, i) => (
            <div
              key={c.id}
              className={`cmd-item ${i === idx ? 'on' : ''}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => run(c)}
            >
              <span className="cmd-group">{c.group}</span>
              <span className="cmd-label">{c.label}</span>
              {c.hint && <kbd>{c.hint}</kbd>}
            </div>
          ))}
        </div>
        <div className="cmd-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> gez
          </span>
          <span>
            <kbd>Enter</kbd> aç
          </span>
          <span>
            <kbd>Esc</kbd> kapat
          </span>
          <span className="muted">{commands.length} komut</span>
        </div>
      </div>
    </div>
  );
}
