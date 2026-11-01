/** Shared heat colormap for the 2D grid and the 3D surface (blue → cyan → green → yellow → red). */
const STOPS: [number, number, number, number][] = [
  [0, 0.27, 0.42, 0.98],
  [0.25, 0.12, 0.78, 0.96],
  [0.5, 0.3, 0.88, 0.42],
  [0.7, 0.99, 0.86, 0.24],
  [0.85, 1, 0.56, 0.14],
  [1, 0.95, 0.22, 0.24],
];

export function heat(t: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, r1, g1, b1] = STOPS[i]!;
    if (v <= p1) {
      const [p0, r0, g0, b0] = STOPS[i - 1]!;
      const k = (v - p0) / (p1 - p0);
      return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
    }
  }
  const last = STOPS[STOPS.length - 1]!;
  return [last[1], last[2], last[3]];
}

export function heatCss(t: number): string {
  const [r, g, b] = heat(t);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/** sign colour for differences: grey at 0, red for positive, blue for negative (|v| = m → full) */
export function diverge(v: number, m: number): [number, number, number] {
  const a = Number.isFinite(v) ? Math.min(1, Math.abs(v) / (m || 1)) : 0;
  const to = v > 0 ? [1, 0.32, 0.38] : [0.27, 0.52, 1];
  const base = [0.42, 0.47, 0.55];
  return [0, 1, 2].map((k) => base[k]! + (to[k]! - base[k]!) * a) as [number, number, number];
}

export function divergeCss(v: number, m: number): string {
  const [r, g, b] = diverge(v, m);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

export const HEAT_GRADIENT = `linear-gradient(90deg, ${STOPS.map(([p]) => `${heatCss(p)} ${p * 100}%`).join(', ')})`;
