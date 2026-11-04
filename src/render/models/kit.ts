import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../core/rng';
import { Noise2D } from '../../core/noise';

/**
 * A tiny procedural modelling kit. Parts are standard three geometries that get transformed,
 * vertex-coloured (with optional gradients / baked occlusion), tagged and merged into a single
 * geometry per model. Every model in the game is authored with this kit.
 */
export type ColorFn = (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color | number;

export interface PartOpts {
  color: number | ColorFn;
  leaf?: number;        // foliage weight (seasonal tinting)
  slot?: number;        // colour slot for instanced recolouring (0 = fixed, 1 = team, 2 = skin, 3 = hair, 4 = cloth2)
  part?: number;        // animation part id (characters)
  jitter?: number;      // random vertex displacement (organic shapes)
  flat?: boolean;       // faceted shading
  ao?: [number, number, number]; // [yMin, yMax, minFactor] vertical occlusion gradient
  pivot?: [number, number, number]; // animation pivot (characters)
  item?: number;        // which held item this vertex belongs to (characters)
}

const noise = new Noise2D(99);
const _c = new THREE.Color();

export class ModelBuilder {
  private parts: THREE.BufferGeometry[] = [];
  rng: Rng;
  rig = false;
  constructor(seed = 1, rig = false) { this.rng = new Rng(seed); this.rig = rig; }

  add(geo: THREE.BufferGeometry, opts: PartOpts, m?: THREE.Matrix4): this {
    let g = geo.index ? geo : geo;
    g = g.clone();
    // drop uvs: we only use vertex colours
    g.deleteAttribute('uv');
    if (opts.jitter) {
      g.deleteAttribute('normal');
      g = mergeVertices(g, 1e-4);
      const pos = g.attributes.position as THREE.BufferAttribute;
      const j = opts.jitter;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const s = noise.noise(x * 3.1 + y * 1.7 + this.rng.next() * 0.01, z * 3.3 - y * 2.1) * j;
        const len = Math.hypot(x, y, z) || 1;
        pos.setXYZ(i, x + (x / len) * s, y + (y / len) * s, z + (z / len) * s);
      }
      g.computeVertexNormals();
    }
    if (m) g.applyMatrix4(m);
    if (opts.flat) { g = g.index ? g.toNonIndexed() : g; g.computeVertexNormals(); }
    if (g.index) g = g.toNonIndexed();
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const p = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i); nn.fromBufferAttribute(nor, i);
      if (typeof opts.color === 'number') _c.setHex(opts.color);
      else { const r = opts.color(p, nn); if (typeof r === 'number') _c.setHex(r); else _c.copy(r); }
      if (opts.ao) {
        const [y0, y1, mn] = opts.ao;
        const t = Math.min(1, Math.max(0, (p.y - y0) / (y1 - y0)));
        _c.multiplyScalar(mn + (1 - mn) * t);
      }
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aLeaf', new THREE.BufferAttribute(new Float32Array(n).fill(opts.leaf ?? 0), 1));
    g.setAttribute('aSlot', new THREE.BufferAttribute(new Float32Array(n).fill(opts.slot ?? 0), 1));
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(opts.part ?? 0), 1));
    if (this.rig) {
      const pv = new Float32Array(n * 3);
      const [px, py, pz] = opts.pivot ?? [0, 0, 0];
      for (let i = 0; i < n; i++) { pv[i * 3] = px; pv[i * 3 + 1] = py; pv[i * 3 + 2] = pz; }
      g.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
      g.setAttribute('aItem', new THREE.BufferAttribute(new Float32Array(n).fill(opts.item ?? 0), 1));
    }
    this.parts.push(g);
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---------- transform helpers ----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _s.set(sx, sy, sz); _p.set(x, y, z);
  return new THREE.Matrix4().compose(_p, _q, _s);
}
void _m;

// ---------- colour helpers ----------
export function hex(h: number) { return new THREE.Color().setHex(h); }
export function mixHex(a: number, b: number, t: number) { return new THREE.Color().setHex(a).lerp(new THREE.Color().setHex(b), t); }
/** Vertical gradient between two colours across [y0,y1]. */
export function vgrad(a: number, b: number, y0: number, y1: number): ColorFn {
  const ca = hex(a), cb = hex(b);
  return (p) => ca.clone().lerp(cb, Math.min(1, Math.max(0, (p.y - y0) / (y1 - y0))));
}
/** Colour noise for organic variation. */
export function noisy(base: number, amt: number, freq = 4, seed = 0): ColorFn {
  const c = hex(base);
  return (p) => { const n = noise.noise(p.x * freq + seed, p.z * freq + p.y * freq * 0.7); return c.clone().multiplyScalar(1 + n * amt); };
}

// ---------- primitives ----------
export const geo = {
  box: (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d),
  /** rounded box (chamfered) for soft toy-like props */
  rbox: (w: number, h: number, d: number, r = 0.05, seg = 2) => roundedBox(w, h, d, r, seg),
  cyl: (rt: number, rb: number, h: number, seg = 8, hseg = 1, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, hseg, open),
  cone: (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg),
  sphere: (r: number, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs),
  ico: (r: number, detail = 1) => new THREE.IcosahedronGeometry(r, detail),
  capsule: (r: number, len: number, cap = 4, rad = 10) => new THREE.CapsuleGeometry(r, len, cap, rad),
  torus: (r: number, tube: number, rs = 6, ts = 12, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, rs, ts, arc),
  octa: (r: number) => new THREE.OctahedronGeometry(r, 0),
  dodeca: (r: number) => new THREE.DodecahedronGeometry(r, 0),
  /** triangular prism (roofs). Ridge along X, width along Z. */
  prism: (len: number, w: number, h: number) => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
    g.translate(0, 0, -len / 2); g.rotateY(Math.PI / 2);
    return g;
  },
  /** square pyramid */
  pyramid: (w: number, h: number) => { const g = new THREE.ConeGeometry(w * Math.SQRT1_2, h, 4, 1); g.rotateY(Math.PI / 4); return g; },
  lathe: (pts: [number, number][], seg = 10) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg),
  /** an extruded 2D outline lying in XY, extruded along Z */
  extrude: (pts: [number, number][], depth: number, bevel = 0) => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
    g.translate(0, 0, -depth / 2);
    return g;
  },
};

function roundedBox(w: number, h: number, d: number, r: number, seg: number) {
  // sphere-projected box: displace a subdivided box toward an inner box + radius
  const g = new THREE.BoxGeometry(w, h, d, seg * 2 + 1, seg * 2 + 1, seg * 2 + 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
    const dlt = v.clone().sub(c);
    if (dlt.lengthSq() > 1e-10) dlt.setLength(r);
    pos.setXYZ(i, c.x + dlt.x, c.y + dlt.y, c.z + dlt.z);
  }
  const m = mergeVertices(g, 1e-5);
  m.computeVertexNormals();
  return m;
}
