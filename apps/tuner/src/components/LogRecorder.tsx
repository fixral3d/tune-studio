import { useEffect, useRef, useState } from 'react';
import {
  encodeMarkerPacket,
  encodeRealtimePacket,
  encodeRtTimePacket,
  pagePackets,
  readAllPages,
  vemslogFileName,
  vemslogHeader,
  VemsClient,
  VemsLogWriter,
  type FirmwareDetails,
  type SiprDescriptor,
  type VemsConfig,
} from '@vems/core';
import type { RealtimeFeed, RtSample } from '../lib/realtime';

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const mmss = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** VemsTune-compatible .vemslog logging (LOG-01/02/04): record, add marker, save the in-memory buffer. */
export function LogRecorder({
  client,
  config,
  sipr,
  feed,
  details,
}: {
  client: VemsClient;
  config: VemsConfig;
  sipr?: SiprDescriptor;
  feed: RealtimeFeed;
  details?: FirmwareDetails;
}) {
  const writer = useRef<VemsLogWriter>();
  const [rec, setRec] = useState<{ count: number; t0: number; ms: number }>();
  const [busy, setBusy] = useState(false);
  const [buffered, setBuffered] = useState(0);

  useEffect(() => feed.subscribe(() => setBuffered(feed.history.length)), [feed]);

  /** Header + config snapshot (SIPRFileLogger writes cached page packets right after the header). */
  async function newWriter(): Promise<VemsLogWriter> {
    const w = new VemsLogWriter(
      vemslogHeader({
        version: details?.version,
        serialNumber: details?.serialNumber,
        compilationTime: details?.compilationTime,
        signature: details?.mtCodeVer,
      }),
    );
    if (sipr) {
      // the feed's shared config copy is current (read on connect, editors mirror writes)
      const store = feed.pages?.size ? feed.pages : await readAllPages(client, config);
      for (const p of sipr.pages) {
        const data = store.get(p.pageNo);
        if (data) for (const pkt of pagePackets(sipr, p.pageNo, data)) w.add(pkt);
      }
    }
    return w;
  }

  const addSample = (w: VemsLogWriter, s: RtSample) => {
    w.add(encodeRtTimePacket(s.ms));
    w.add(encodeRealtimePacket(s.data));
  };

  useEffect(() => {
    if (!rec) return;
    return feed.subscribe((s) => {
      if (!writer.current) return;
      addSample(writer.current, s);
      setRec((r) => r && { ...r, count: r.count + 1, ms: s.ms - r.t0 });
    });
  }, [feed, rec !== undefined]);

  async function start() {
    setBusy(true);
    try {
      writer.current = await newWriter();
      const last = feed.history[feed.history.length - 1];
      setRec({ count: 0, t0: last?.ms ?? 0, ms: 0 });
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    if (writer.current) download(writer.current.bytes(), vemslogFileName(details?.serialNumber ?? 'vems'));
    writer.current = undefined;
    setRec(undefined);
  }

  // Alt+L = start a new vemslog (closing the current one), Alt+K = add marker (LOG-02)
  const keys = useRef({ start, stop, rec });
  keys.current = { start, stop, rec };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const k = keys.current;
      if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        if (k.rec) k.stop();
        void k.start();
      } else if (e.key.toLowerCase() === 'k' && k.rec) {
        e.preventDefault();
        writer.current?.add(encodeMarkerPacket());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function saveBuffer() {
    setBusy(true);
    try {
      const w = await newWriter();
      for (const s of feed.history) addSample(w, s);
      download(w.bytes(), vemslogFileName(details?.serialNumber ?? 'vems'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="recorder">
      {rec ? (
        <>
          <button className="rec-on" onClick={stop}>
            ■ Durdur · {rec.count} · {mmss(rec.ms)}
          </button>
          <button onClick={() => writer.current?.add(encodeMarkerPacket())} title="Alt+K">
            Marker
          </button>
        </>
      ) : (
        <button onClick={start} disabled={busy} title="Yeni .vemslog başlat">
          ● Log
        </button>
      )}
      <button onClick={saveBuffer} disabled={busy || buffered === 0} title="Bellekteki tüm realtime geçmişini .vemslog olarak kaydet">
        Tamponu kaydet ({buffered})
      </button>
    </div>
  );
}
