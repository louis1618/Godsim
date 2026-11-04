import * as THREE from 'three';
import { ModelBuilder, T, geo, hex, vgrad, noisy } from './kit';
import { Feat } from '../../sim/defs';

/** Procedural stylised flora & rocks. Each returns [hi, lo] LOD geometries. */
export type LodPair = [THREE.BufferGeometry, THREE.BufferGeometry];

const BARK = 0x7a5235, BARK_D = 0x4f3420;

function trunk(b: ModelBuilder, h: number, r0: number, r1: number, col = BARK, seg = 7) {
  b.add(geo.cyl(r1, r0, h, seg, 2), { color: vgrad(BARK_D, col, 0, h * 0.6) }, T(0, h / 2, 0));
  b.add(geo.cone(r0 * 1.7, r0 * 2.2, seg), { color: BARK_D }, T(0, r0 * 0.9, 0));
}

function canopyColor(base: number, top: number, y0: number, y1: number) {
  const a = hex(base), c = hex(top);
  return (p: THREE.Vector3, n: THREE.Vector3) => {
    const t = Math.min(1, Math.max(0, (p.y - y0) / (y1 - y0)));
    const col = a.clone().lerp(c, t * 0.8 + Math.max(0, n.y) * 0.25);
    return col;
  };
}

export function oak(seed: number): LodPair {
  const hi = new ModelBuilder(seed), lo = new ModelBuilder(seed);
  const h = 0.62;
  trunk(hi, h, 0.11, 0.07);
  hi.add(geo.cyl(0.035, 0.05, 0.35, 5), { color: BARK }, T(0.12, h * 0.85, 0, 0, 0, -0.8));
  const cc = canopyColor(0x3f8a32, 0x8fd055, 0.55, 1.45);
  const blobs: [number, number, number, number][] = [[0, 1.0, 0, 0.5], [0.3, 0.88, 0.12, 0.36], [-0.26, 0.9, -0.1, 0.38], [0.05, 1.28, -0.05, 0.36], [-0.08, 0.92, 0.3, 0.32]];
  for (const [x, y, z, r] of blobs) hi.add(geo.ico(r, 1), { color: cc, leaf: 1, jitter: 0.06 }, T(x, y, z));
  trunk(lo, h, 0.11, 0.07, BARK, 5);
  lo.add(geo.ico(0.62, 0), { color: cc, leaf: 1, jitter: 0.05 }, T(0, 1.05, 0, 0, 0, 0, 1, 0.85, 1));
  return [hi.build(), lo.build()];
}

export function pine(seed: number, snow = false): LodPair {
  const hi = new ModelBuilder(seed), lo = new ModelBuilder(seed);
  trunk(hi, 0.5, 0.08, 0.05);
  trunk(lo, 0.5, 0.08, 0.05, BARK, 5);
  const dark = snow ? 0x2c5a4a : 0x2d6b45, light = snow ? 0x4f8a6a : 0x4f9a5a;
  const tiers = [[0.55, 0.56, 0.62], [0.95, 0.44, 0.55], [1.3, 0.32, 0.48], [1.6, 0.18, 0.38]];
  const snowCol = (p: THREE.Vector3, n: THREE.Vector3) => {
    const c = hex(dark).lerp(hex(light), Math.min(1, Math.max(0, n.y * 0.6 + 0.2)));
    if (snow && n.y > 0.35) return c.lerp(hex(0xf2f6fb), Math.min(1, (n.y - 0.35) * 3));
    return c;
  };
  for (const [y, r, h] of tiers) {
    hi.add(geo.cone(r, h, 9), { color: snowCol, leaf: snow ? 0 : 0.3, jitter: 0.025 }, T(0, y + h / 2, 0, 0, seed * 0.7));
  }
  lo.add(geo.cone(0.55, 1.5, 6), { color: snowCol, leaf: 0.3 }, T(0, 1.2, 0));
  return [hi.build(), lo.build()];
}

export function birch(seed: number): LodPair {
  const hi = new ModelBuilder(seed), lo = new ModelBuilder(seed);
  const bark = (p: THREE.Vector3) => (Math.sin(p.y * 31 + Math.atan2(p.z, p.x) * 2) > 0.82 ? hex(0x3b3631) : hex(0xeeeae0));
  hi.add(geo.cyl(0.045, 0.075, 1.0, 7, 6), { color: bark }, T(0, 0.5, 0));
  const cc = canopyColor(0x7fae3c, 0xd2e66a, 0.7, 1.75);
  hi.add(geo.ico(0.38, 1), { color: cc, leaf: 1, jitter: 0.05 }, T(0, 1.25, 0, 0, 0, 0, 1, 1.35, 1));
  hi.add(geo.ico(0.26, 1), { color: cc, leaf: 1, jitter: 0.05 }, T(0.2, 1.0, 0.1, 0, 0, 0, 1, 1.2, 1));
  lo.add(geo.cyl(0.045, 0.075, 1.0, 5), { color: 0xeeeae0 }, T(0, 0.5, 0));
  lo.add(geo.ico(0.4, 1), { color: cc, leaf: 1 }, T(0, 1.2, 0, 0, 0, 0, 1, 1.4, 1));
  return [hi.build(), lo.build()];
}

export function palm(seed: number): LodPair {
  const hi = new ModelBuilder(seed), lo = new ModelBuilder(seed);
  const segs = 6; let x = 0, y = 0; const bend = 0.09;
  for (let i = 0; i < segs; i++) {
    const a = bend * i;
    const h = 0.26;
    const r = 0.075 - i * 0.006;
    hi.add(geo.cyl(r * 0.85, r, h, 7), { color: i % 2 ? 0x9a7449 : 0x86623b }, T(x, y + h / 2, 0, 0, 0, -a));
    x += Math.sin(a) * h; y += Math.cos(a) * h;
  }
  const top = new THREE.Vector3(x, y, 0);
  const leafC = canopyColor(0x3c8f3a, 0x8dd257, -0.2, 0.2);
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2 + seed;
    // frond: 3 squashed segments drooping outward
    let fx = 0, fy = 0;
    for (let k = 0; k < 3; k++) {
      const pitch = 0.25 + k * 0.45;
      const len = 0.28;
      const cx = fx + Math.cos(pitch) * len * 0.5, cy = fy - Math.sin(pitch) * len * 0.5 + 0.02;
      const m = new THREE.Matrix4().makeRotationY(ang).multiply(T(cx, cy, 0, 0, 0, -pitch, 1, 1, 1));
      m.premultiply(new THREE.Matrix4().makeTranslation(top.x, top.y, top.z));
      hi.add(geo.sphere(1, 8, 4), { color: leafC, leaf: 0.6 }, m.multiply(new THREE.Matrix4().makeScale(len * 0.62, 0.025, 0.13 - k * 0.03)));
      fx += Math.cos(pitch) * len; fy -= Math.sin(pitch) * len;
    }
  }
  hi.add(geo.sphere(0.05, 6, 4), { color: 0x5b3a1e }, T(top.x + 0.06, top.y - 0.06, 0.04));
  hi.add(geo.sphere(0.05, 6, 4), { color: 0x5b3a1e }, T(top.x - 0.03, top.y - 0.07, -0.05));
  lo.add(geo.cyl(0.05, 0.07, 1.5, 5), { color: 0x86623b }, T(0.18, 0.75, 0, 0, 0, -0.22));
  lo.add(geo.cone(0.65, 0.25, 7), { color: leafC, leaf: 0.6 }, T(top.x, top.y - 0.05, 0));
  return [hi.build(), lo.build()];
}

export function cactus(seed: number): LodPair {
  const hi = new ModelBuilder(seed), lo = new ModelBuilder(seed);
  const ribs = (p: THREE.Vector3) => hex(0x4f9a46).multiplyScalar(0.85 + 0.25 * Math.max(0, Math.cos(Math.atan2(p.z, p.x) * 8)));
  hi.add(geo.capsule(0.12, 0.8, 4, 12), { color: ribs }, T(0, 0.52, 0));
  hi.add(geo.capsule(0.075, 0.28, 3, 10), { color: ribs }, T(0.2, 0.62, 0));
  hi.add(geo.capsule(0.075, 0.14, 3, 10), { color: ribs }, T(0.13, 0.42, 0, 0, 0, Math.PI / 2));
  hi.add(geo.capsule(0.065, 0.2, 3, 10), { color: ribs }, T(-0.18, 0.75, 0.02));
  hi.add(geo.capsule(0.065, 0.1, 3, 10), { color: ribs }, T(-0.11, 0.6, 0.02, 0, 0, Math.PI / 2));
  hi.add(geo.sphere(0.04, 6, 4), { color: 0xf06aa0 }, T(0, 1.06, 0));
  lo.add(geo.capsule(0.13, 0.8, 2, 6), { color: 0x4f9a46 }, T(0, 0.52, 0));
  return [hi.build(), lo.build()];
}

export function acacia(seed: number): LodPair {
  const hi = new ModelBuilder(seed), lo = new ModelBuilder(seed);
  hi.add(geo.cyl(0.05, 0.08, 0.8, 6), { color: BARK }, T(0, 0.4, 0, 0, 0, 0.12));
  hi.add(geo.cyl(0.03, 0.05, 0.5, 5), { color: BARK }, T(0.18, 0.85, 0, 0, 0, -0.7));
  hi.add(geo.cyl(0.03, 0.05, 0.45, 5), { color: BARK }, T(-0.12, 0.85, 0.05, 0, 0, 0.7));
  const cc = canopyColor(0x6f8f2c, 0xb8c95a, 0.95, 1.2);
  hi.add(geo.ico(0.6, 1), { color: cc, leaf: 1, jitter: 0.05 }, T(0.05, 1.08, 0, 0, 0, 0, 1, 0.26, 0.85));
  hi.add(geo.ico(0.35, 1), { color: cc, leaf: 1, jitter: 0.04 }, T(0.38, 1.0, 0.1, 0, 0, 0, 1, 0.28, 1));
  lo.add(geo.cyl(0.05, 0.08, 1.0, 5), { color: BARK }, T(0, 0.5, 0));
  lo.add(geo.ico(0.62, 1), { color: cc, leaf: 1 }, T(0.05, 1.06, 0, 0, 0, 0, 1, 0.28, 0.9));
  return [hi.build(), lo.build()];
}

export function deadTree(seed: number): LodPair {
  const hi = new ModelBuilder(seed), lo = new ModelBuilder(seed);
  const c = 0x5e5148;
  hi.add(geo.cyl(0.05, 0.1, 0.9, 6), { color: c }, T(0, 0.45, 0, 0, 0, 0.05));
  hi.add(geo.cyl(0.025, 0.045, 0.45, 5), { color: c }, T(0.14, 0.8, 0, 0, 0, -0.7));
  hi.add(geo.cyl(0.02, 0.04, 0.4, 5), { color: c }, T(-0.13, 0.7, 0.06, 0.2, 0, 0.8));
  hi.add(geo.cyl(0.015, 0.03, 0.3, 5), { color: c }, T(0.02, 1.0, -0.1, -0.5, 0, 0.1));
  lo.add(geo.cyl(0.05, 0.1, 0.9, 4), { color: c }, T(0, 0.45, 0));
  return [hi.build(), lo.build()];
}

export function berryBush(seed: number): LodPair {
  const hi = new ModelBuilder(seed), lo = new ModelBuilder(seed);
  const cc = canopyColor(0x2f6f35, 0x5aa44a, 0.0, 0.5);
  hi.add(geo.ico(0.28, 1), { color: cc, leaf: 0.7, jitter: 0.04 }, T(0, 0.22, 0, 0, 0, 0, 1.2, 0.9, 1.1));
  hi.add(geo.ico(0.2, 1), { color: cc, leaf: 0.7, jitter: 0.03 }, T(0.2, 0.16, 0.08));
  hi.add(geo.ico(0.19, 1), { color: cc, leaf: 0.7, jitter: 0.03 }, T(-0.18, 0.15, -0.06));
  const r = hi.rng;
  for (let i = 0; i < 11; i++) {
    const a = r.next() * Math.PI * 2, el = r.range(0.1, 1.2);
    const d = 0.3;
    hi.add(geo.sphere(0.04, 6, 4), { color: 0xd8304a }, T(Math.cos(a) * d * Math.cos(el) * 1.1, 0.2 + Math.sin(el) * 0.22, Math.sin(a) * d * Math.cos(el)));
  }
  lo.add(geo.ico(0.33, 1), { color: cc, leaf: 0.7 }, T(0, 0.22, 0, 0, 0, 0, 1.2, 0.9, 1.1));
  return [hi.build(), lo.build()];
}

export function boulder(seed: number, ore = false): LodPair {
  const hi = new ModelBuilder(seed), lo = new ModelBuilder(seed);
  const rockC = (p: THREE.Vector3, n: THREE.Vector3) => {
    const c = hex(0x8d8780).lerp(hex(0xaaa49b), Math.max(0, n.y) * 0.5);
    if (n.y > 0.75 && !ore) c.lerp(hex(0x6a8f46), (n.y - 0.75) * 2.2);
    return c;
  };
  hi.add(geo.ico(0.36, 1), { color: rockC, jitter: 0.08, flat: true }, T(0, 0.16, 0, 0.3, seed, 0, 1.15, 0.75, 1));
  hi.add(geo.ico(0.2, 1), { color: rockC, jitter: 0.05, flat: true }, T(0.32, 0.08, 0.12, 0, seed * 2, 0, 1, 0.7, 1));
  if (ore) {
    const gold = (p: THREE.Vector3, n: THREE.Vector3) => hex(0xffcf3a).lerp(hex(0xfff3a8), Math.max(0, n.y));
    hi.add(geo.octa(0.1), { color: gold, flat: true }, T(0.05, 0.42, 0.04, 0.2, 0, 0.3, 0.8, 1.8, 0.8));
    hi.add(geo.octa(0.07), { color: gold, flat: true }, T(-0.16, 0.34, 0.1, -0.4, 0, -0.5, 0.8, 1.6, 0.8));
    hi.add(geo.octa(0.06), { color: gold, flat: true }, T(0.2, 0.3, -0.12, 0.5, 0, 0.6, 0.8, 1.6, 0.8));
    lo.add(geo.octa(0.1), { color: 0xffcf3a, flat: true }, T(0.05, 0.4, 0.04, 0, 0, 0, 0.8, 1.8, 0.8));
  }
  lo.add(geo.ico(0.38, 0), { color: rockC, flat: true }, T(0, 0.16, 0, 0, 0, 0, 1.15, 0.75, 1));
  return [hi.build(), lo.build()];
}

export function flowers(seed: number): LodPair {
  const hi = new ModelBuilder(seed), lo = new ModelBuilder(seed);
  const r = hi.rng;
  const cols = [0xf7d84a, 0xf28bb8, 0xffffff, 0xb08cf0, 0xf2683c];
  for (let i = 0; i < 7; i++) {
    const a = r.next() * Math.PI * 2, d = r.range(0.05, 0.3);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, h = r.range(0.08, 0.16);
    hi.add(geo.cyl(0.008, 0.01, h, 3), { color: 0x4f8f3a }, T(x, h / 2, z));
    hi.add(geo.ico(0.035, 0), { color: r.pick(cols), leaf: 0 }, T(x, h, z));
    if (i < 4) hi.add(geo.ico(0.04, 0), { color: 0x5aa34a }, T(x + 0.03, 0.02, z, 0, 0, 0, 1.4, 0.4, 0.8));
  }
  lo.add(geo.ico(0.08, 0), { color: 0xf7d84a }, T(0, 0.08, 0));
  return [hi.build(), lo.build()];
}

export function crop(seed: number): LodPair {
  const hi = new ModelBuilder(seed), lo = new ModelBuilder(seed);
  const r = hi.rng;
  for (let i = 0; i < 9; i++) {
    const x = ((i % 3) - 1) * 0.28 + r.range(-0.05, 0.05), z = (Math.floor(i / 3) - 1) * 0.28 + r.range(-0.05, 0.05);
    const h = r.range(0.32, 0.42);
    hi.add(geo.cyl(0.012, 0.016, h, 3), { color: vgrad(0x7f9a3a, 0xd9b851, 0, h), leaf: 1 }, T(x, h / 2, z, r.range(-0.1, 0.1), 0, r.range(-0.1, 0.1)));
    hi.add(geo.capsule(0.03, 0.08, 2, 5), { color: 0xe8c45a, leaf: 1 }, T(x, h + 0.03, z));
  }
  lo.add(geo.box(0.85, 0.35, 0.85), { color: 0xd9b851, leaf: 1 }, T(0, 0.17, 0));
  return [hi.build(), lo.build()];
}

/** Build every feature's LOD pair; index = Feat id. */
export function buildFeatureModels(): (LodPair[] | null)[] {
  const out: (LodPair[] | null)[] = [];
  const variants = (fn: (s: number) => LodPair, n = 3) => Array.from({ length: n }, (_, i) => fn(i * 17 + 3));
  out[Feat.None] = null;
  out[Feat.Oak] = variants(oak);
  out[Feat.Pine] = variants((s) => pine(s));
  out[Feat.Birch] = variants(birch, 2);
  out[Feat.Palm] = variants(palm, 2);
  out[Feat.Cactus] = variants(cactus, 2);
  out[Feat.SnowPine] = variants((s) => pine(s, true), 2);
  out[Feat.Acacia] = variants(acacia, 2);
  out[Feat.Dead] = variants(deadTree, 2);
  out[Feat.Berry] = variants(berryBush, 2);
  out[Feat.Boulder] = variants((s) => boulder(s), 3);
  out[Feat.Ore] = variants((s) => boulder(s, true), 2);
  out[Feat.Crop] = variants(crop, 1);
  out[Feat.Flower] = variants(flowers, 3);
  void noisy;
  return out;
}
