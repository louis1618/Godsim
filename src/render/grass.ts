import * as THREE from 'three';
import { World, heightCubic } from '../sim/world';
import { Mat } from '../sim/defs';
import { hash2 } from '../core/rng';
import { patchInstanced, makeInstancedDepthMaterial, U } from './shared';

const MAX = 9000;

function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], leaf: number[] = [];
  const base = new THREE.Color(0x7ab84a), tip = new THREE.Color(0xe4f8a0);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + i * 0.7;
    const r = 0.02 + (i % 3) * 0.035;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 0.09 + ((i * 37) % 10) / 10 * 0.08;
    const w = 0.012;
    const lean = 0.03 + (i % 2) * 0.03;
    const tx = x + Math.cos(a) * lean, tz = z + Math.sin(a) * lean;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    // two-segment blade
    const mx = x + (tx - x) * 0.4, mz = z + (tz - z) * 0.4, mh = h * 0.55;
    const quads = [
      [x - px, 0, z - pz, x + px, 0, z + pz, mx + px * 0.7, mh, mz + pz * 0.7, mx - px * 0.7, mh, mz - pz * 0.7],
    ];
    for (const q of quads) {
      const v = (k: number) => [q[k * 3], q[k * 3 + 1], q[k * 3 + 2]];
      for (const k of [0, 1, 2, 0, 2, 3]) pos.push(...v(k));
      for (const k of [0, 1, 2, 0, 2, 3]) { const c = base.clone().lerp(tip, k >= 2 ? 0.55 : 0); col.push(c.r, c.g, c.b); leaf.push(0.3); }
    }
    // tip triangle
    pos.push(mx - px * 0.7, mh, mz - pz * 0.7, mx + px * 0.7, mh, mz + pz * 0.7, tx, h, tz);
    for (let k = 0; k < 3; k++) { const c = base.clone().lerp(tip, k === 2 ? 1 : 0.55); col.push(c.r, c.g, c.b); leaf.push(0.3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(leaf, 1));
  // normals pointing up give soft, uniform grass shading
  const nor = new Float32Array(pos.length); for (let i = 0; i < nor.length; i += 3) { nor[i + 1] = 1; }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  return g;
}

const TINT: Record<number, [number, number]> = { [Mat.Grass]: [0xf4ffe4, 0xd8f0bc], [Mat.Lush]: [0xc8eaa8, 0xa8d890], [Mat.Savanna]: [0xfff2b0, 0xf0dc98], [Mat.Swamp]: [0xc8d8a0, 0xa8c088], [Mat.Farmland]: [0xe0f0b0, 0xc8e0a0], [Mat.Sand]: [0xfff0c8, 0xf0dcae] };

/** Grass tufts scattered around the focus point; only alive in the close-up 3D view. */
export class GrassRenderer {
  readonly mesh: THREE.InstancedMesh;
  private lastX = -999; private lastZ = -999; private lastOn = false;
  private dirtyT = 0;
  constructor(private world: World) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    patchInstanced(mat, { wind: 1.2, seasonal: true });
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), mat, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.castShadow = false;
    this.mesh.layers.enable(0);
    this.mesh.count = 0;
    void makeInstancedDepthMaterial;
  }

  markDirty() { this.dirtyT = 0.25; }

  update(focus: THREE.Vector3, z01: number, dt: number) {
    const on = z01 < 0.3;
    this.mesh.visible = on;
    if (!on) { this.lastOn = false; return; }
    if (this.dirtyT > 0) { this.dirtyT -= dt; if (this.dirtyT <= 0) this.lastX = -999; }
    const moved = Math.abs(focus.x - this.lastX) > 2.5 || Math.abs(focus.z - this.lastZ) > 2.5;
    if (!moved && this.lastOn) return;
    this.lastOn = true; this.lastX = focus.x; this.lastZ = focus.z;
    const w = this.world;
    const R = 20;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color(), c2 = new THREE.Color();
    let n = 0;
    const x0 = Math.max(0, Math.floor(focus.x - R)), x1 = Math.min(w.W - 1, Math.ceil(focus.x + R));
    const z0 = Math.max(0, Math.floor(focus.z - R)), z1 = Math.min(w.H - 1, Math.ceil(focus.z + R));
    const col = this.mesh.instanceColor!.array as Float32Array;
    for (let z = z0; z <= z1 && n < MAX; z++) for (let x = x0; x <= x1 && n < MAX; x++) {
      const t = z * w.W + x;
      const mt = w.mat[t];
      const tint = TINT[mt];
      if (!tint || w.isWater(t) || w.bld[t] >= 0 && mt !== Mat.Farmland) continue;
      const d = Math.hypot(x + 0.5 - focus.x, z + 0.5 - focus.z);
      if (d > R) continue;
      const g = w.grass[t] / 255;
      let k = Math.round((mt === Mat.Sand ? 0.6 : 1) * (1.5 + g * 5) * (mt === Mat.Farmland ? 0.3 : 1));
      if (w.fire[t] > 0) k = 0;
      for (let i = 0; i < k && n < MAX; i++) {
        const r1 = hash2(x * 7 + i, z * 13, 5), r2 = hash2(x * 11, z * 3 + i, 9), r3 = hash2(x + i * 31, z, 21);
        if (mt === Mat.Sand && r3 > 0.3) continue;
        const px = x + r1, pz = z + r2;
        const fade = 1 - THREE.MathUtils.smoothstep(d, R - 6, R);
        const sc = (0.8 + r3 * 0.6) * fade * (0.6 + g * 0.5);
        if (sc < 0.08) continue;
        p.set(px, heightCubic(w.height, w.W, w.H, px, pz) - 0.02, pz);
        q.setFromAxisAngle(up, r3 * 6.28);
        s.set(sc * 1.3, sc * (0.9 + r1 * 0.5), sc * 1.3);
        m.compose(p, q, s);
        this.mesh.setMatrixAt(n, m);
        c.setHex(tint[0]).lerp(c2.setHex(tint[1]), r2);
        col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b;
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    void U;
  }
}
