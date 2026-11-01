import { useId } from 'react';
import type { FlagDesc, GaugeDesc, GaugeTheme } from '../lib/gauges';

const C = 110;
const rad = (a: number) => (a * Math.PI) / 180;
const pt = (a: number, r: number) => [C + r * Math.cos(rad(a)), C + r * Math.sin(rad(a))] as const;

function arc(a0: number, a1: number, r: number): string {
  const [x0, y0] = pt(a0, r);
  const [x1, y1] = pt(a1, r);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

export function gaugeTitle(d: GaugeDesc): string {
  const t = d.name.replace(/gauge/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || d.channel;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Analog gauge drawn from a VemsTune GaugeDesc (angles, divisions, coloured areas) in a WidgetThemes theme. */
export function AnalogGauge({
  desc,
  theme,
  value,
  onTitleClick,
}: {
  desc: GaugeDesc;
  theme: GaugeTheme;
  value: number | undefined;
  onTitleClick?: () => void;
}) {
  const id = useId().replace(/:/g, '');
  const { lo, hi, start, end } = desc;
  const span = hi - lo || 1;
  const ang = (v: number) => start + Math.max(0, Math.min(1, (v - lo) / span)) * (end - start);
  const a = value === undefined ? start : ang(value);
  const area = value === undefined ? undefined : desc.areas.find((r) => value >= r.min && value <= r.max);
  const k = hi >= 2000 ? 1000 : 1;
  const major = Math.max(1, desc.major);
  const minor = Math.max(1, desc.minor);
  const label = (v: number) => {
    const s = k > 1 ? +(v / k).toFixed(1) : +v.toFixed(desc.labelDigits);
    return String(s);
  };
  const glow = area ? theme.colors[area.color] ?? theme.text : theme.text;

  return (
    <div className={`agauge ${area?.color === 'danger' ? 'danger' : ''}`}>
      <svg viewBox="0 0 220 220">
        <defs>
          <radialGradient id={`f${id}`} cx="50%" cy="38%" r="70%">
            <stop offset="0" stopColor="#1d2533" />
            <stop offset="1" stopColor="#05070b" />
          </radialGradient>
          <linearGradient id={`b${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5b6575" />
            <stop offset=".5" stopColor="#1a1f28" />
            <stop offset="1" stopColor="#3a4250" />
          </linearGradient>
          <radialGradient id={`c${id}`}>
            <stop offset="0" stopColor="#9aa4b3" />
            <stop offset="1" stopColor="#20262f" />
          </radialGradient>
          <filter id={`g${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={C} cy={C} r={107} fill={`url(#b${id})`} />
        <circle cx={C} cy={C} r={101} fill={`url(#f${id})`} stroke="#000" strokeWidth={2} />
        {desc.areas.map((r, i) => (
          <path
            key={i}
            d={arc(ang(r.min), ang(r.max), 80)}
            stroke={theme.colors[r.color] ?? '#888'}
            strokeWidth={7}
            fill="none"
            opacity={0.75}
          />
        ))}
        <path d={arc(start, end, 91)} stroke="rgba(255,255,255,.07)" strokeWidth={4} fill="none" />
        {value !== undefined && a > start + 0.5 && (
          <path d={arc(start, a, 91)} stroke={glow} strokeWidth={4} fill="none" filter={`url(#g${id})`} strokeLinecap="round" />
        )}
        {Array.from({ length: major * minor + 1 }, (_, i) => {
          const at = start + (i / (major * minor)) * (end - start);
          const isMajor = i % minor === 0;
          const [x0, y0] = pt(at, isMajor ? 76 : 82);
          const [x1, y1] = pt(at, 88);
          return (
            <line
              key={i}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              stroke={theme.div}
              strokeWidth={isMajor ? 2 : 1}
              opacity={isMajor ? 0.9 : 0.45}
            />
          );
        })}
        {Array.from({ length: major + 1 }, (_, i) => {
          const at = start + (i / major) * (end - start);
          const [x, y] = pt(at, 65);
          return (
            <text key={i} x={x} y={y} className="ag-tick" fill={theme.text} textAnchor="middle" dominantBaseline="central">
              {label(lo + (i / major) * span)}
            </text>
          );
        })}
        <text x={C} y={C + 30} className="ag-title" fill={theme.text} textAnchor="middle" onClick={onTitleClick}>
          {gaugeTitle(desc)}
          {k > 1 ? ' ×1000' : ''}
        </text>
        <text x={C} y={C + 56} className="ag-value" fill={area ? glow : '#f2f5f9'} textAnchor="middle">
          {value === undefined ? '—' : value.toFixed(desc.digits)}
        </text>
        <text x={C} y={C + 71} className="ag-unit" fill={theme.text} textAnchor="middle">
          {desc.unit}
        </text>
        <g
          style={{
            transform: `rotate(${a}deg)`,
            transformOrigin: `${C}px ${C}px`,
            transformBox: 'view-box',
            transition: 'transform 140ms linear',
          }}
        >
          <path d={`M ${C - 16} ${C - 2.5} L ${C + 90} ${C - 0.6} L ${C + 90} ${C + 0.6} L ${C - 16} ${C + 2.5} Z`} fill={theme.pointer} filter={`url(#g${id})`} />
        </g>
        <circle cx={C} cy={C} r={10} fill={`url(#c${id})`} stroke="#000" />
        <ellipse cx={C} cy={C - 52} rx={70} ry={36} fill="#fff" opacity={0.035} />
      </svg>
    </div>
  );
}

/** VemsFlagDesc.xml indicator: shows the state text with VemsTune's own colours. */
export function FlagLed({ desc, value }: { desc: FlagDesc; value: number | undefined }) {
  const st = desc.states.find((s) => s.value === value);
  const on = !!value && !!st;
  return (
    <div
      className={`flag ${on ? 'on' : ''}`}
      style={on ? { background: st!.bg, color: st!.fg, boxShadow: `0 0 14px ${st!.bg}88` } : undefined}
      title={desc.name}
    >
      {st?.text ?? desc.states[0]?.text ?? desc.name}
    </div>
  );
}

/** Rolling history trace with a soft area fill. */
export function Spark({ data, color, label, unit, digits }: { data: number[]; color: string; label: string; unit: string; digits: number }) {
  const id = useId().replace(/:/g, '');
  const W = 300;
  const H = 54;
  const n = data.length;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of data) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const pts = data.map((v, i) => `${(i / Math.max(1, n - 1)) * W},${H - 4 - ((v - lo) / (hi - lo)) * (H - 8)}`).join(' ');
  return (
    <div className="spark">
      <div className="spark-head">
        <span>{label}</span>
        <b style={{ color }}>
          {n ? data[n - 1]!.toFixed(digits) : '—'} <small>{unit}</small>
        </b>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={0.35} />
            <stop offset="1" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {n > 1 && (
          <>
            <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#s${id})`} />
            <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
    </div>
  );
}
