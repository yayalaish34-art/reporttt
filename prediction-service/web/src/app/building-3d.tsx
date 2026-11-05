'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { api } from '@/lib/api';

type Scene = {
  bounds: [number, number, number, number];
  height_m: number;
  floors: { id: string; name: string; elevation_m: number; height_m: number }[];
  sources: { tag: string; type: string; kind: 'riser' | 'line' | 'box'; points: number[][] }[];
  bands: { label: string; color: string }[];
};

const SOURCE_COLOUR = 0x9b109b;

/**
 * The building in 3D: each floor's field as a coloured slab, the sources in place.
 *
 * World metres are x east, y north, z up; three.js has y up, so a point (x, y, z) sits at
 * (x, z × spread, −y). Spread stretches the height so the floors can be told apart.
 */
export function Building3D({ base, runId }: { base: string; runId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState('');
  const [spread, setSpread] = useState(3);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    api<Scene>(`${base}/runs/${runId}/scene`)
      .then(setScene)
      .catch((failure) => setError(failure instanceof Error ? failure.message : 'טעינת התצוגה נכשלה'));
  }, [base, runId]);

  useEffect(() => {
    const element = host.current;
    if (!scene || !element) return;
    const [x0, y0, x1, y1] = scene.bounds;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const at = (x: number, y: number, z: number) => new THREE.Vector3(x - cx, z * spread, -(y - cy));

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(element.clientWidth, element.clientHeight);
    element.appendChild(renderer.domElement);

    const world = new THREE.Scene();
    world.add(new THREE.AmbientLight(0xffffff, 1.0));
    const size = Math.max(x1 - x0, y1 - y0);
    const top = Math.max(...scene.floors.map((f) => f.elevation_m + (f.height_m || 3))) * spread;
    const bottom = Math.min(...scene.floors.map((f) => f.elevation_m)) * spread;
    const camera = new THREE.PerspectiveCamera(40, element.clientWidth / element.clientHeight, 0.5, 5000);
    camera.position.set(size * 0.9, (top + bottom) / 2 + size * 0.7, size * 1.1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, (top + bottom) / 2, 0);
    controls.update();

    const loader = new THREE.TextureLoader();
    const disposables: { dispose: () => void }[] = [];
    for (const floor of scene.floors) {
      if (hidden.has(floor.id)) continue;
      const texture = loader.load(`/api${base}/runs/${runId}/floors/${floor.id}/field.png`);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      const geometry = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
      const plane = new THREE.Mesh(geometry, material);
      plane.rotation.x = -Math.PI / 2;
      plane.position.copy(at(cx, cy, floor.elevation_m));
      world.add(plane);
      const slab = new THREE.Mesh(
        new THREE.PlaneGeometry(x1 - x0, y1 - y0),
        new THREE.MeshBasicMaterial({ color: 0xe6e9ee, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
      );
      slab.rotation.x = -Math.PI / 2;
      slab.position.copy(at(cx, cy, floor.elevation_m - 0.02));
      world.add(slab);
      disposables.push(geometry, material, texture, slab.geometry, slab.material as THREE.Material);
    }

    const visible = new Set(scene.floors.filter((f) => !hidden.has(f.id)).map((f) => f.elevation_m));
    const onVisibleFloor = (z: number) =>
      scene.floors.some((f) => visible.has(f.elevation_m) && z >= f.elevation_m - 0.01 && z <= f.elevation_m + (f.height_m || 3) + 0.01);
    const lineMaterial = new THREE.LineBasicMaterial({ color: SOURCE_COLOUR, linewidth: 2 });
    const boxMaterial = new THREE.MeshBasicMaterial({ color: SOURCE_COLOUR, transparent: true, opacity: 0.45 });
    disposables.push(lineMaterial, boxMaterial);
    for (const source of scene.sources) {
      if (!onVisibleFloor(source.points[0][2])) continue;
      if (source.kind === 'box') {
        const [[ax, ay, az], [bx, by, bz]] = source.points;
        const geometry = new THREE.BoxGeometry(bx - ax, (bz - az) * spread, by - ay);
        const box = new THREE.Mesh(geometry, boxMaterial);
        box.position.copy(at((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2));
        world.add(box);
        disposables.push(geometry);
      } else {
        const geometry = new THREE.BufferGeometry().setFromPoints(source.points.map(([x, y, z]) => at(x, y, z)));
        world.add(new THREE.Line(geometry, lineMaterial));
        disposables.push(geometry);
      }
    }

    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      controls.update();
      renderer.render(world, camera);
    };
    render();
    const resize = () => {
      camera.aspect = element.clientWidth / element.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(element.clientWidth, element.clientHeight);
    };
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      controls.dispose();
      disposables.forEach((item) => item.dispose());
      renderer.dispose();
      element.removeChild(renderer.domElement);
    };
  }, [scene, spread, hidden, base, runId]);

  if (error) return <div className="notice error">{error}</div>;
  if (!scene) return <p className="muted">טוען תצוגה תלת-ממדית…</p>;

  return (
    <div className="building-3d">
      <div ref={host} className="building-3d-stage" />
      <div className="building-3d-side">
        <label className="field">
          מרווח בין הקומות
          <input type="range" min={1} max={8} step={0.5} value={spread} onChange={(e) => setSpread(Number(e.target.value))} />
        </label>
        <div className="small muted">גרירה מסובבת, גלגלת מקרבת, גרירה ימנית מזיזה.</div>
        <div className="building-3d-floors">
          {[...scene.floors].reverse().map((floor) => (
            <label key={floor.id} className="small">
              <input
                type="checkbox"
                checked={!hidden.has(floor.id)}
                onChange={(e) => {
                  const next = new Set(hidden);
                  if (e.target.checked) next.delete(floor.id);
                  else next.add(floor.id);
                  setHidden(next);
                }}
              />{' '}
              {floor.name}
            </label>
          ))}
        </div>
        <div className="building-3d-legend">
          {scene.bands.map((band) => (
            <span key={band.label} style={{ background: band.color }}>
              {band.label}
            </span>
          ))}
          <span className="small muted">mG</span>
        </div>
      </div>
    </div>
  );
}
