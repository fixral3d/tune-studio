import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { diverge, heat } from '../lib/colormap';

/** Inclusive cell rectangle (x = column/xBins index, y = row/yBins index). */
export interface CellRect {
  xa: number;
  xb: number;
  ya: number;
  yb: number;
}

export interface Table3DProps {
  xlen: number;
  ylen: number;
  /** user values, index y*xlen + x */
  values: number[];
  lo: number;
  hi: number;
  digits: number;
  xLabels: string[];
  yLabels: string[];
  xTitle: string;
  yTitle: string;
  zTitle: string;
  sel?: CellRect;
  /** live operating point as fractional cell indices */
  live?: { fx: number; fy: number };
  onSelect(x: number, y: number, extend: boolean): void;
  onHover(cell?: { x: number; y: number }): void;
  /** vertical drag on the selection: value delta, done=true on release */
  onDrag(delta: number, done: boolean): void;
  /** second, translucent surface on the same scale (Table Compare 3D "File 2") */
  ghost?: number[];
  /** solid surface colour instead of the heat map */
  tint?: string;
  /** colour by sign (red > 0 > blue) and draw the zero plane — for difference tables */
  diverging?: boolean;
  /** with `diverging`: colour by these values (e.g. A−B) instead of the heights; no zero plane */
  colorBy?: number[];
  /** extra tooltip line for cell index y*xlen + x */
  tipExtra?(i: number): string;
  help?: string;
}

// world size of the table box
const W = 10;
const D = 8;
const H = 4.2;
const TRAIL = 90;

const VIEWS: Record<string, [number, number, number]> = {
  '3B': [9.5, 11, 13],
  Üst: [0, 19, 0.01],
  Ön: [0, 3.2, 17],
  Yan: [17, 3.2, 0],
};

interface Scene3D {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  surface?: THREE.Mesh;
  wire?: THREE.LineSegments;
  floor?: THREE.Mesh;
  labels: THREE.Group;
  selPts: THREE.Points;
  hover: THREE.Mesh;
  live: THREE.Group;
  liveDot: THREE.Mesh;
  liveBeam: THREE.Line;
  trail: THREE.Line;
  trailPts: THREE.Vector3[];
  viewTarget?: THREE.Vector3;
}

const px = (i: number, n: number) => -W / 2 + (i * W) / Math.max(1, n - 1);
const pz = (j: number, n: number) => D / 2 - (j * D) / Math.max(1, n - 1);
const norm = (v: number, lo: number, hi: number) => (hi === lo ? 0.5 : (v - lo) / (hi - lo));

/** triangle + grid-line indices of an xlen×ylen vertex grid (vertex y*xlen + x) */
function gridIndex(xlen: number, ylen: number) {
  const tris: number[] = [];
  const lines: number[] = [];
  for (let y = 0; y < ylen; y++)
    for (let x = 0; x < xlen; x++) {
      const a = y * xlen + x;
      if (x < xlen - 1) lines.push(a, a + 1);
      if (y < ylen - 1) lines.push(a, a + xlen);
      if (x < xlen - 1 && y < ylen - 1) tris.push(a, a + 1, a + xlen, a + 1, a + xlen + 1, a + xlen);
    }
  return { tris, lines };
}

function textSprite(text: string, size: number, color = '#9fb0c3', weight = 500): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = `${weight} 44px ui-sans-serif, system-ui, Segoe UI, sans-serif`;
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + 16;
  c.height = 60;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set((size * c.width) / c.height, size, 1);
  return sp;
}

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.6, 'rgba(120,200,255,0.5)');
  g.addColorStop(1, 'rgba(120,200,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      (mat as THREE.SpriteMaterial).map?.dispose();
      mat.dispose();
    }
  });
}

/** Bilinear height of the surface at fractional cell indices. */
function sampleAt(values: number[], xlen: number, ylen: number, fx: number, fy: number): number {
  const x0 = Math.max(0, Math.min(xlen - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(ylen - 1, Math.floor(fy)));
  const x1 = Math.min(xlen - 1, x0 + 1);
  const y1 = Math.min(ylen - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const v = (x: number, y: number) => values[y * xlen + x] ?? 0;
  return (
    v(x0, y0) * (1 - tx) * (1 - ty) + v(x1, y0) * tx * (1 - ty) + v(x0, y1) * (1 - tx) * ty + v(x1, y1) * tx * ty
  );
}

export function Table3D(props: Table3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const p = useRef(props);
  p.current = props;
  const st = useRef<Scene3D>();
  const [tip, setTip] = useState<{ x: number; y: number; left: number; top: number }>();
  const [spin, setSpin] = useState(false);
  const [dragging, setDragging] = useState(false);

  // one-time scene, renderer, controls and pointer handling
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0e15, 26, 52);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    camera.position.set(...VIEWS['3B']!);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, H * 0.3, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 6;
    controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.autoRotateSpeed = 1.1;

    scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x1a2230, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(6, 14, 9);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x5b9dff, 0.5);
    rim.position.set(-10, 6, -12);
    scene.add(rim);

    // base plate under the box
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(W + 1.2, 0.12, D + 1.2),
      new THREE.MeshStandardMaterial({ color: 0x121924, roughness: 0.9, metalness: 0.2 }),
    );
    plate.position.y = -0.07;
    scene.add(plate);

    const labels = new THREE.Group();
    scene.add(labels);

    const selPts = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ size: 0.42, map: dotTexture(), transparent: true, depthWrite: false, depthTest: false }),
    );
    selPts.renderOrder = 10;
    scene.add(selPts);

    const hover = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x8be9ff, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    hover.renderOrder = 11;
    hover.visible = false;
    scene.add(hover);

    const live = new THREE.Group();
    const liveDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 28, 18),
      new THREE.MeshStandardMaterial({ color: 0xff4fd8, emissive: 0xff2fc8, emissiveIntensity: 1.4 }),
    );
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.42, 40),
      new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.name = 'halo';
    const liveBeam = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0xff4fd8, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.8 }),
    );
    live.add(liveDot, halo, liveBeam);
    live.visible = false;
    scene.add(live);
    const trail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xff7be3, transparent: true, opacity: 0.55 }),
    );
    scene.add(trail);

    const s: Scene3D = { renderer, scene, camera, controls, labels, selPts, hover, live, liveDot, liveBeam, trail, trailPts: [] };
    st.current = s;

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    const clock = new THREE.Clock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      if (s.viewTarget) {
        camera.position.lerp(s.viewTarget, 0.12);
        if (camera.position.distanceTo(s.viewTarget) < 0.03) s.viewTarget = undefined;
      }
      const k = 1 + Math.sin(t * 5) * 0.25;
      halo.scale.set(k, k, k);
      (halo.material as THREE.MeshBasicMaterial).opacity = 0.35 + (1.25 - k) * 0.6;
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    // pointer: click = select (shift extends), drag on selection = edit, otherwise orbit
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (e: PointerEvent) => {
      if (!s.surface) return;
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(s.surface)[0];
      if (!hit) return;
      const { xlen, ylen } = p.current;
      const x = Math.round(((hit.point.x + W / 2) * (xlen - 1)) / W);
      const y = Math.round(((D / 2 - hit.point.z) * (ylen - 1)) / D);
      return { x: Math.max(0, Math.min(xlen - 1, x)), y: Math.max(0, Math.min(ylen - 1, y)) };
    };
    const inSel = (c: { x: number; y: number }) => {
      const r = p.current.sel;
      return !!r && c.x >= r.xa && c.x <= r.xb && c.y >= r.ya && c.y <= r.yb;
    };
    let down: { x: number; y: number } | undefined;
    let drag: { y0: number; delta: number } | undefined;
    const dragDelta = (e: PointerEvent) => {
      const { lo, hi } = p.current;
      return ((drag!.y0 - e.clientY) * (hi - lo || 1)) / (el.clientHeight * 0.55);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const c = pick(e);
      if (c && !e.shiftKey && inSel(c)) {
        controls.enabled = false;
        drag = { y0: e.clientY, delta: 0 };
        el.setPointerCapture(e.pointerId);
        setDragging(true);
        setTip(undefined);
        return;
      }
      down = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (drag) {
        drag.delta = dragDelta(e);
        p.current.onDrag(drag.delta, false);
        return;
      }
      if (e.buttons) return;
      const c = pick(e);
      if (!c) {
        hover.visible = false;
        setTip(undefined);
        p.current.onHover(undefined);
        return;
      }
      const { xlen, ylen, values, lo, hi } = p.current;
      hover.visible = true;
      hover.position.set(px(c.x, xlen), norm(values[c.y * xlen + c.x]!, lo, hi) * H, pz(c.y, ylen));
      const r = el.getBoundingClientRect();
      setTip({ ...c, left: e.clientX - r.left, top: e.clientY - r.top });
      p.current.onHover(c);
    };
    const onUp = (e: PointerEvent) => {
      if (drag) {
        p.current.onDrag(dragDelta(e), true);
        drag = undefined;
        controls.enabled = true;
        setDragging(false);
        return;
      }
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const c = pick(e);
        if (c) p.current.onSelect(c.x, c.y, e.shiftKey);
      }
      down = undefined;
    };
    const onLeave = () => {
      hover.visible = false;
      setTip(undefined);
      p.current.onHover(undefined);
    };
    // capture phase so a drag on the selection disables orbiting before OrbitControls sees it
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      st.current = undefined;
    };
  }, []);

  const { xlen, ylen, values, lo, hi, digits, xLabels, yLabels, xTitle, yTitle, zTitle, sel, live, ghost, tint, diverging, colorBy } =
    props;

  // surface + wireframe + floor heatmap: rebuilt when the table shape changes
  useEffect(() => {
    const s = st.current!;
    const n = xlen * ylen;
    const pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    const col = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    const flat = new Float32Array(n * 3);
    for (let y = 0; y < ylen; y++)
      for (let x = 0; x < xlen; x++) {
        const i = (y * xlen + x) * 3;
        pos.array[i] = flat[i] = px(x, xlen);
        pos.array[i + 2] = flat[i + 2] = pz(y, ylen);
        flat[i + 1] = 0.005;
      }
    const { tris, lines } = gridIndex(xlen, ylen);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', pos);
    g.setAttribute('color', col);
    g.setIndex(tris);
    const surface = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.6,
        metalness: 0,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', pos);
    wg.setIndex(lines);
    const wire = new THREE.LineSegments(
      wg,
      new THREE.LineBasicMaterial({ color: 0x06090f, transparent: true, opacity: 0.55 }),
    );
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(flat, 3));
    fg.setAttribute('color', col);
    fg.setIndex(tris);
    const floor = new THREE.Mesh(
      fg,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    s.scene.add(floor, surface, wire);
    s.surface = surface;
    s.wire = wire;
    s.floor = floor;
    s.trailPts = [];
    return () => {
      s.scene.remove(surface, wire, floor);
      surface.geometry.dispose();
      (surface.material as THREE.Material).dispose();
      wire.geometry.dispose();
      (wire.material as THREE.Material).dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      s.surface = s.wire = s.floor = undefined;
    };
  }, [xlen, ylen]);

  // heights + colours
  useEffect(() => {
    const s = st.current!;
    const g = s.surface?.geometry;
    if (!g) return;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    const tmp = new THREE.Color();
    const solid = tint ? new THREE.Color(tint) : undefined;
    const m = colorBy ? Math.max(0, ...colorBy.map(Math.abs)) : Math.max(Math.abs(lo), Math.abs(hi));
    for (let i = 0; i < xlen * ylen; i++) {
      const v = values[i] ?? lo;
      const t = norm(v, lo, hi);
      pos.setY(i, t * H);
      if (solid) tmp.copy(solid);
      else tmp.setRGB(...(diverging ? diverge(colorBy?.[i] ?? v, m) : heat(t)), THREE.SRGBColorSpace);
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
  }, [values, lo, hi, xlen, ylen, tint, diverging, colorBy]);

  // compare overlay: translucent second surface + zero plane for difference tables
  useEffect(() => {
    const s = st.current!;
    const objs: THREE.Object3D[] = [];
    if (ghost && ghost.length >= xlen * ylen) {
      const pos = new Float32Array(xlen * ylen * 3);
      for (let y = 0; y < ylen; y++)
        for (let x = 0; x < xlen; x++) {
          const i = y * xlen + x;
          pos[i * 3] = px(x, xlen);
          pos[i * 3 + 1] = norm(ghost[i]!, lo, hi) * H;
          pos[i * 3 + 2] = pz(y, ylen);
        }
      const { tris, lines } = gridIndex(xlen, ylen);
      const attr = new THREE.BufferAttribute(pos, 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', attr);
      g.setIndex(tris);
      g.computeVertexNormals();
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', attr);
      wg.setIndex(lines);
      objs.push(
        new THREE.Mesh(
          g,
          new THREE.MeshStandardMaterial({
            color: 0x3ee68a,
            transparent: true,
            opacity: 0.32,
            roughness: 0.5,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        ),
        new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x5cffa8, transparent: true, opacity: 0.75 })),
      );
    }
    if (diverging && !colorBy && lo < 0 && hi > 0) {
      const h = norm(0, lo, hi) * H;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(W, D),
        new THREE.MeshBasicMaterial({ color: 0x9fb0c3, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = h;
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(plane.geometry),
        new THREE.LineBasicMaterial({ color: 0x9fb0c3, transparent: true, opacity: 0.45 }),
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.y = h;
      objs.push(plane, edge);
    }
    if (objs.length) s.scene.add(...objs);
    return () => {
      for (const o of objs) {
        s.scene.remove(o);
        disposeTree(o);
      }
    };
  }, [ghost, diverging, colorBy, lo, hi, xlen, ylen]);

  // selection markers
  useEffect(() => {
    const s = st.current!;
    const pts: number[] = [];
    if (sel)
      for (let y = sel.ya; y <= sel.yb; y++)
        for (let x = sel.xa; x <= sel.xb; x++)
          pts.push(px(x, xlen), norm(values[y * xlen + x] ?? lo, lo, hi) * H + 0.02, pz(y, ylen));
    s.selPts.geometry.dispose();
    s.selPts.geometry = new THREE.BufferGeometry();
    s.selPts.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }, [sel, values, lo, hi, xlen, ylen]);

  // live operating point + trail
  useEffect(() => {
    const s = st.current!;
    if (!live) {
      s.live.visible = false;
      return;
    }
    const v = sampleAt(values, xlen, ylen, live.fx, live.fy);
    const x = -W / 2 + (live.fx * W) / Math.max(1, xlen - 1);
    const z = D / 2 - (live.fy * D) / Math.max(1, ylen - 1);
    const h = norm(v, lo, hi) * H;
    s.live.visible = true;
    s.liveDot.position.set(x, h + 0.08, z);
    s.live.getObjectByName('halo')!.position.set(x, 0.02, z);
    s.liveBeam.geometry.setFromPoints([new THREE.Vector3(x, 0.02, z), new THREE.Vector3(x, h, z)]);
    s.liveBeam.computeLineDistances();
    s.trailPts.push(new THREE.Vector3(x, h + 0.05, z));
    if (s.trailPts.length > TRAIL) s.trailPts.shift();
    s.trail.geometry.dispose();
    s.trail.geometry = new THREE.BufferGeometry().setFromPoints(s.trailPts);
  }, [live, values, lo, hi, xlen, ylen]);

  // axes, ticks, walls and titles
  useEffect(() => {
    const s = st.current!;
    const grp = s.labels;
    for (const c of [...grp.children]) {
      grp.remove(c);
      disposeTree(c);
    }
    const lineMat = new THREE.LineBasicMaterial({ color: 0x2b3a4f, transparent: true, opacity: 0.7 });
    const seg: THREE.Vector3[] = [];
    const add = (a: THREE.Vector3, b: THREE.Vector3) => seg.push(a, b);
    const ticks = 5;
    for (let k = 0; k <= ticks; k++) {
      const h = (k / ticks) * H;
      add(new THREE.Vector3(-W / 2, h, -D / 2), new THREE.Vector3(W / 2, h, -D / 2));
      add(new THREE.Vector3(-W / 2, h, -D / 2), new THREE.Vector3(-W / 2, h, D / 2));
      const lab = textSprite((lo + ((hi - lo) * k) / ticks).toFixed(digits), 0.36);
      lab.position.set(-W / 2 - 0.55, h, -D / 2 - 0.2);
      grp.add(lab);
    }
    for (let x = 0; x < xlen; x++) {
      add(new THREE.Vector3(px(x, xlen), 0, D / 2), new THREE.Vector3(px(x, xlen), 0, -D / 2));
      add(new THREE.Vector3(px(x, xlen), 0, -D / 2), new THREE.Vector3(px(x, xlen), H, -D / 2));
      if (xlen <= 20 || x % 2 === 0) {
        const lab = textSprite(xLabels[x] ?? String(x), 0.34);
        lab.position.set(px(x, xlen), 0.05, D / 2 + 0.55);
        grp.add(lab);
      }
    }
    for (let y = 0; y < ylen; y++) {
      add(new THREE.Vector3(-W / 2, 0, pz(y, ylen)), new THREE.Vector3(W / 2, 0, pz(y, ylen)));
      add(new THREE.Vector3(-W / 2, 0, pz(y, ylen)), new THREE.Vector3(-W / 2, H, pz(y, ylen)));
      const lab = textSprite(yLabels[y] ?? String(y), 0.34);
      lab.position.set(-W / 2 - 0.7, 0.05, pz(y, ylen));
      grp.add(lab);
    }
    grp.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), lineMat));
    const tx = textSprite(xTitle, 0.48, '#d6e2ee', 700);
    tx.position.set(0, 0.05, D / 2 + 1.35);
    const ty = textSprite(yTitle, 0.48, '#d6e2ee', 700);
    ty.position.set(-W / 2 - 1.9, 0.05, 0);
    const tz = textSprite(zTitle, 0.48, '#d6e2ee', 700);
    tz.position.set(-W / 2 - 0.55, H + 0.65, -D / 2 - 0.2);
    grp.add(tx, ty, tz);
  }, [xLabels, yLabels, lo, hi, digits, xTitle, yTitle, zTitle, xlen, ylen]);

  useEffect(() => {
    if (st.current) st.current.controls.autoRotate = spin;
  }, [spin]);

  const setView = (k: string) => {
    const s = st.current;
    if (!s) return;
    setSpin(false);
    s.controls.target.set(0, H * 0.3, 0);
    s.viewTarget = new THREE.Vector3(...VIEWS[k]!);
  };

  const tipValue = tip ? values[tip.y * xlen + tip.x] : undefined;

  return (
    <div className={`t3 ${dragging ? 'dragging' : ''}`} ref={host}>
      <div className="t3-views">
        {Object.keys(VIEWS).map((k) => (
          <button key={k} onClick={() => setView(k)}>
            {k}
          </button>
        ))}
        <button className={spin ? 'on' : ''} onClick={() => setSpin(!spin)} title="Otomatik döndür">
          ⟳
        </button>
      </div>
      {tip && tipValue !== undefined && (
        <div className="t3-tip" style={{ left: tip.left + 14, top: tip.top + 14 }}>
          <b>{tipValue.toFixed(digits)}</b>
          {props.tipExtra && <span>{props.tipExtra(tip.y * xlen + tip.x)}</span>}
          <span>
            {xTitle} {xLabels[tip.x]} · {yTitle} {yLabels[tip.y]}
          </span>
        </div>
      )}
      <div className="t3-help">
        {props.help ??
          'Sürükle: döndür · Sağ tık: kaydır · Tekerlek: yakınlaş · Tık: seç · Shift+tık: alan · Seçimi dikey sürükle: değer'}
      </div>
    </div>
  );
}
