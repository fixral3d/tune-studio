import { useRef, useState } from 'react';
import { userToRaw, writeRawInt, type ArrayField, type VemsClient } from '@vems/core';

/** Writes a user value into element `index` of an array field, clamped to the INI lo/hi and the raw type range. */
export function writeUserClamped(buf: Uint8Array, f: ArrayField, index: number, v: number): void {
  let u = v;
  if (f.hi > f.lo) u = Math.max(f.lo, Math.min(f.hi, u));
  const bits = f.type.size * 8;
  const rlo = f.type.signed ? -(2 ** (bits - 1)) : 0;
  const rhi = f.type.signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1;
  const raw = Math.max(rlo, Math.min(rhi, userToRaw(u, f.scale, f.translate)));
  writeRawInt(buf, f.offset + index * f.type.size, f.type, raw);
}

/**
 * One ECU page under edit: local copy, undo/redo, and a serial write queue that sends only
 * the bytes that differ from what the ECU already has. `mirror` (the live feed's page map,
 * keyed by INI page like readAllPages) gets `vtPage` updated so computed channels see the edit.
 */
export function usePageEditor(
  client: VemsClient,
  ecuId: number | undefined,
  mirror?: Map<number, Uint8Array>,
  vtPage?: number,
) {
  const [page, setPage] = useState<Uint8Array>();
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState('');
  const [, setTick] = useState(0);
  const past = useRef<Uint8Array[]>([]);
  const future = useRef<Uint8Array[]>([]);
  const synced = useRef<Uint8Array>();
  const target = useRef<Uint8Array>();
  const busy = useRef(false);

  function load(pg: Uint8Array | undefined) {
    past.current = [];
    future.current = [];
    synced.current = pg?.slice();
    target.current = pg;
    setPage(pg);
  }

  async function flush() {
    if (busy.current || ecuId === undefined) return;
    busy.current = true;
    try {
      for (;;) {
        const t = target.current;
        const s = synced.current;
        if (!t || !s) break;
        let first = -1;
        let n = 0;
        for (let i = 0; i < t.length; i++)
          if (t[i] !== s[i]) {
            n++;
            if (first < 0) first = i;
          }
        setPending(n);
        if (first < 0) break;
        await client.writeByte(ecuId, first, t[first]!);
        s[first] = t[first]!;
      }
    } catch (e) {
      setStatus(`yazma hatası: ${(e as Error).message}`);
    } finally {
      busy.current = false;
    }
  }

  function commit(next: Uint8Array, msg: string, record = true) {
    if (record && page) {
      past.current.push(page);
      if (past.current.length > 200) past.current.shift();
      future.current = [];
    }
    setPage(next);
    setTick((n) => n + 1);
    target.current = next;
    if (mirror && vtPage !== undefined) mirror.set(vtPage, next);
    setStatus(msg);
    void flush();
  }

  function undo() {
    const prev = past.current.pop();
    if (!prev || !page) return;
    future.current.push(page);
    commit(prev, 'geri alındı', false);
  }
  function redo() {
    const next = future.current.pop();
    if (!next || !page) return;
    past.current.push(page);
    commit(next, 'yinelendi', false);
  }

  return {
    page,
    load,
    commit,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    pending,
    status,
    setStatus,
  };
}
