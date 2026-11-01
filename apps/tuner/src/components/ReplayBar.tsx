import { useEffect, useState } from 'react';
import type { ReplayFeed, ReplayState } from '../lib/replay';

/** "Replay on log" toolbar: start/pause, stop, speed ×1/×2/×4, repeat, position slider. */
export function ReplayBar({ replay, onClose }: { replay: ReplayFeed; onClose: () => void }) {
  const [st, setSt] = useState<ReplayState>(replay.state());
  useEffect(() => {
    replay.onState = setSt;
    return () => {
      replay.onState = undefined;
    };
  }, [replay]);

  return (
    <div className="replay-bar">
      <span className="muted small" title={replay.name}>▶ {replay.name || 'log'}</span>
      <button onClick={() => (st.playing ? replay.pause() : replay.play())} title={st.playing ? 'Duraklat' : 'Oynat'}>
        {st.playing ? '⏸' : '▶'}
      </button>
      <button onClick={() => replay.stop()} title="Durdur">■</button>
      {[1, 2, 4].map((x) => (
        <button key={x} className={st.speed === x ? 'on' : ''} onClick={() => replay.setSpeed(x)}>
          ×{x}
        </button>
      ))}
      <button className={st.repeat ? 'on' : ''} onClick={() => replay.setRepeat(!st.repeat)} title="Tekrar">⟲</button>
      <input
        type="range"
        min={0}
        max={Math.max(0, st.count - 1)}
        value={st.index}
        onChange={(e) => replay.seek(Number(e.target.value))}
      />
      <span className="mono small">
        {st.t.toFixed(1)} / {st.total.toFixed(1)} s · #{st.index}
      </span>
      <button onClick={onClose} title="Oynatmayı kapat">✕</button>
    </div>
  );
}
