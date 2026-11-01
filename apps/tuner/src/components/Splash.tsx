import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { heat } from '../lib/colormap';

/** Animated fuel-map terrain behind the connect screen. */
function Terrain() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x05070b, 14, 46);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);

    const NX = 72;
    const NZ = 48;
    const geo = new THREE.PlaneGeometry(44, 30, NX - 1, NZ - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
    geo.setAttribute('color', col);
    const base = Float32Array.from(pos.array);
    const surface = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.26, side: THREE.DoubleSide }),
    );
    const dots = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.13, vertexColors: true, transparent: true, opacity: 0.9 }),
    );
    scene.add(surface, dots);

    // a glowing "operating point" wandering over the map
    const probe = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), new THREE.MeshBasicMaterial({ color: 0xff5fd2 }));
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 40),
      new THREE.MeshBasicMaterial({ color: 0xff5fd2, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    halo.rotation.x = -Math.PI / 2;
    scene.add(probe, halo);

    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const tmp = new THREE.Color();
    const height = (x: number, z: number, t: number) =>
      2.2 * Math.exp(-((x - 4) ** 2 + (z + 2) ** 2) / 90) * (1.2 + 0.25 * Math.sin(t * 0.6)) +
      0.55 * Math.sin(x * 0.32 + t * 0.7) * Math.cos(z * 0.27 - t * 0.5) +
      0.25 * Math.sin((x + z) * 0.5 + t);
    let raf = 0;
    const clock = new THREE.Clock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3]!;
        const z = base[i * 3 + 2]!;
        const h = height(x, z, t);
        pos.setY(i, h);
        tmp.setRGB(...heat((h + 0.9) / 3.8), THREE.SRGBColorSpace);
        col.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      const px = Math.sin(t * 0.23) * 12;
      const pz = Math.cos(t * 0.17) * 7;
      const ph = height(px, pz, t);
      probe.position.set(px, ph + 0.3, pz);
      halo.position.set(px, ph + 0.05, pz);
      const k = 1 + Math.sin(t * 4) * 0.25;
      halo.scale.set(k, k, k);
      camera.position.set(Math.sin(t * 0.05) * 6, 9 + Math.sin(t * 0.11), 20);
      camera.lookAt(0, 0, -3);
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      geo.dispose();
      for (const m of [surface.material, dots.material, probe.material, halo.material]) m.dispose();
      probe.geometry.dispose();
      halo.geometry.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);
  return <div className="splash-bg" ref={host} />;
}

export function Splash({
  ready,
  stats,
  onDemo,
  onSerial,
  onOpen,
}: {
  ready: boolean;
  stats?: { constants: number; channels: number; tables: number; menus: number };
  onDemo(): void;
  onSerial(): void;
  onOpen(tab: 'firmware' | 'datalog'): void;
}) {
  return (
    <div className="splash">
      <Terrain />
      <div className="splash-veil" />
      <div className="splash-content">
        <div className="splash-mark">
          <span className="logo-dot" /> VEMS<span className="thin">TUNE</span> <em>NX</em>
        </div>
        <h1>Motorunu yeniden keşfet.</h1>
        <p className="lead">
          VemsTune 1.5.46 ile birebir uyumlu protokol, INI ve dosya biçimleri; üstüne canlı 3D haritalar,
          gerçek zamanlı kokpit ve komut paleti.
        </p>
        <div className="splash-cards">
          <button className="scard primary" onClick={onDemo} disabled={!ready}>
            <span className="scard-ico">◎</span>
            <span>
              <b>Demo ECU</b>
              <small>Dahili TriggerFrame emülatörü · donanım gerekmez</small>
            </span>
          </button>
          <button className="scard" onClick={onSerial} disabled={!ready}>
            <span className="scard-ico">⌁</span>
            <span>
              <b>ECU'ya bağlan</b>
              <small>Seri port (WebSerial) · 19200 baud</small>
            </span>
          </button>
        </div>
        <div className="splash-links">
          <button className="ghost" onClick={() => onOpen('datalog')}>
            Datalog aç (.vemslog)
          </button>
          <button className="ghost" onClick={() => onOpen('firmware')}>
            Firmware dosyası incele (.hex/.uhex)
          </button>
          <span className="muted small">Ctrl+K: her yerden komut paleti</span>
        </div>
        <div className="splash-stats">
          {ready && stats ? (
            <>
              <span>
                <b>{stats.constants}</b> sabit
              </span>
              <span>
                <b>{stats.channels}</b> kanal
              </span>
              <span>
                <b>{stats.tables}</b> 3D tablo
              </span>
              <span>
                <b>{stats.menus}</b> menü
              </span>
            </>
          ) : (
            <span className="muted">INI yükleniyor…</span>
          )}
        </div>
      </div>
    </div>
  );
}
