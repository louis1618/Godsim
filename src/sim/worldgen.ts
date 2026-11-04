import { Noise2D } from '../core/noise';
import { Rng, hash2 } from '../core/rng';
import { clamp, clamp01, smoothstep, lerp } from '../core/math';
import { World } from './world';
import { Mat, Feat } from './defs';

export type WorldShape = 'continents' | 'pangaea' | 'archipelago' | 'highlands';
export interface GenOptions { size: number; shape: WorldShape; seed: number; wide?: boolean; }

/** Binary min-heap keyed by float priority (for priority-flood). */
class Heap {
  private keys: Float64Array; private vals: Int32Array; size = 0;
  constructor(cap: number) { this.keys = new Float64Array(cap); this.vals = new Int32Array(cap); }
  push(k: number, v: number) {
    let i = this.size++;
    const K = this.keys, V = this.vals;
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = k; V[i] = v;
  }
  pop(): number {
    const K = this.keys, V = this.vals;
    const top = V[0]; const k = K[--this.size]; const v = V[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1; if (c >= this.size) break;
      if (c + 1 < this.size && K[c + 1] < K[c]) c++;
      if (K[c] >= k) break;
      K[i] = K[c]; V[i] = V[c]; i = c;
    }
    K[i] = k; V[i] = v;
    return top;
  }
}

export function generateWorld(opt: GenOptions): World {
  const W = opt.wide ? opt.size * 2 : opt.size, H = opt.size;
  const aspect = W / H;
  const world = new World(W, H);
  const rng = new Rng(opt.seed);
  const nBase = new Noise2D(opt.seed * 7 + 1);
  const nWarp = new Noise2D(opt.seed * 7 + 2);
  const nMount = new Noise2D(opt.seed * 7 + 3);
  const nMoist = new Noise2D(opt.seed * 7 + 4);
  const nTemp = new Noise2D(opt.seed * 7 + 5);
  const nDetail = new Noise2D(opt.seed * 7 + 6);
  const nForest = new Noise2D(opt.seed * 7 + 7);
  const { height, mat, moist } = world;
  const scale = 192 / H; // keep feature size roughly constant in tiles

  // continent seeds for 'continents' shape
  const blobs: { x: number; z: number; r: number }[] = [];
  const nb = Math.round((opt.shape === 'continents' ? rng.int(2, 3) : opt.shape === 'archipelago' ? rng.int(6, 9) : 1) * (opt.shape === 'pangaea' || opt.shape === 'highlands' ? 1 : aspect));
  for (let i = 0; i < nb; i++) {
    if (opt.shape === 'pangaea' || opt.shape === 'highlands') blobs.push({ x: 0.5 + rng.range(-0.05, 0.05), z: 0.5 + rng.range(-0.05, 0.05), r: 0.43 * (aspect > 1 ? 1.25 : 1) });
    else if (opt.shape === 'continents' && aspect > 1) {
      // a wide world: continents strung along the long axis
      blobs.push({ x: (i + 0.5) / nb + rng.range(-0.04, 0.04), z: 0.5 + rng.range(-0.14, 0.14), r: rng.range(0.24, 0.3) });
    } else if (opt.shape === 'continents') {
      const a = (i / nb) * Math.PI * 2 + rng.range(-0.4, 0.4);
      blobs.push({ x: 0.5 + Math.cos(a) * 0.22, z: 0.5 + Math.sin(a) * 0.22, r: rng.range(0.22, 0.28) });
    } else blobs.push({ x: rng.range(0.15, 0.85), z: rng.range(0.15, 0.85), r: rng.range(0.07, 0.15) });
  }

  const elev = new Float32Array(W * H);
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = z / H;
      const wx = nWarp.fbm(u * aspect * 3, v * 3, 3) * 0.12, wz = nWarp.fbm(u * aspect * 3 + 17, v * 3 - 9, 3) * 0.12;
      const uu = u + wx, vv = v + wz;
      let mask = 0;
      for (const b of blobs) {
        const d = Math.hypot((uu - b.x) * (opt.shape === 'pangaea' || opt.shape === 'highlands' ? 1 : aspect), vv - b.z) / b.r;
        mask = Math.max(mask, 1 - d);
      }
      const freq = opt.shape === 'archipelago' ? 5 : 3.2;
      const n = nBase.fbm(uu * aspect * freq, vv * freq, 5);
      let e: number;
      if (opt.shape === 'highlands') e = mask * 0.9 + n * 0.55 + 0.12;
      else e = mask * 0.95 + n * 0.5 - 0.05;
      // edge falloff: guarantee ocean ring
      const edge = Math.min(u, v, 1 - u, 1 - v);
      e -= (1 - smoothstep(0.0, 0.12, edge)) * 1.3;
      elev[z * W + x] = e;
    }
  }

  // elevation -> height
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x, u = x / W, v = z / H;
      const e = elev[i];
      let h: number;
      if (e < 0) {
        h = -Math.pow(-e, 0.8) * 9 - 0.25;
      } else {
        const hills = Math.pow(e, 1.15) * 5.5 + nDetail.fbm(u * aspect * 14 * scale, v * 14 * scale, 3) * 0.6 * smoothstep(0, 0.2, e);
        const ridge = nMount.ridged(u * aspect * 4.2, v * 4.2, 5);
        const mMask = smoothstep(0.12, 0.45, e) * smoothstep(0.35, 0.75, nMount.fbm(u * aspect * 1.6 + 5, v * 1.6 - 3, 3) * 0.5 + 0.5 + (opt.shape === 'highlands' ? 0.2 : 0));
        h = 0.18 + hills + Math.pow(ridge, 2.2) * 15 * mMask;
      }
      height[i] = h;
    }
  }
  blur(height, W, H, 1);
  shapeSeabed(height, W, H, nDetail);

  // climate
  const temp = new Float32Array(W * H);
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x, u = x / W, v = z / H;
      const lat = Math.abs(v - 0.5) * 2;
      temp[i] = 1 - Math.pow(lat, 1.6) * 0.95 - Math.max(0, height[i]) * 0.045 + nTemp.fbm(u * aspect * 3, v * 3, 3) * 0.28;
      moist[i] = clamp(Math.round((nMoist.fbm(u * aspect * 3.5, v * 3.5, 4) * 0.5 + 0.5) * 255), 0, 255);
    }
  }

  carveRivers(world, rng, temp);

  // materials
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      const h = height[i];
      const t = temp[i], m = moist[i] / 255;
      let mt: Mat;
      if (world.isWater(i)) {
        mt = h > -2.2 ? Mat.Sand : Mat.Sand;
      } else if (h < 0.55 && nearSea(world, x, z, 2)) mt = Mat.Sand;
      else if (h > 11.5 || (h > 7.5 && t < 0.45)) mt = Mat.Snow;
      else if (h > 7.2) mt = Mat.Rock;
      else if (t < 0.18) mt = Mat.Snow;
      else if (t > 0.8 && m < 0.33) mt = Mat.Desert;
      else if (t > 0.68 && m < 0.42) mt = Mat.Savanna;
      else if (m > 0.72 && h < 2.2 && t > 0.45) mt = Mat.Swamp;
      else if (m > 0.55) mt = Mat.Lush;
      else mt = Mat.Grass;
      mat[i] = mt;
    }
  }
  // rocky cliffs on steep slopes
  for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) {
    const i = z * W + x;
    if (world.isWater(i)) continue;
    const s = Math.max(Math.abs(height[i + 1] - height[i - 1]), Math.abs(height[i + W] - height[i - W])) * 0.5;
    if (s > 1.45 && mat[i] !== Mat.Snow) mat[i] = Mat.Rock;
  }

  // vegetation & resources
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      if (world.isWater(i)) continue;
      const u = x / W, v = z / H;
      const forest = nForest.fbm(u * aspect * 6, v * 6, 4) * 0.5 + 0.5 + (moist[i] / 255 - 0.5) * 0.5;
      const r = hash2(x, z, opt.seed);
      const mt = mat[i];
      let f = Feat.None;
      switch (mt) {
        case Mat.Grass:
          if (forest > 0.58 && r < (forest - 0.5) * 1.6) f = r < 0.25 ? Feat.Birch : Feat.Oak;
          else if (r > 0.985) f = Feat.Berry;
          else if (r > 0.95) f = Feat.Flower;
          break;
        case Mat.Lush:
          if (forest > 0.48 && r < (forest - 0.4) * 1.5) f = temp[i] < 0.45 ? Feat.Pine : (r < 0.2 ? Feat.Birch : Feat.Oak);
          else if (r > 0.97) f = Feat.Berry;
          else if (r > 0.93) f = Feat.Flower;
          break;
        case Mat.Savanna:
          if (forest > 0.55 && r < 0.12) f = Feat.Acacia;
          else if (r > 0.992) f = Feat.Boulder;
          break;
        case Mat.Desert:
          if (r < 0.025) f = Feat.Cactus;
          else if (r > 0.993) f = Feat.Boulder;
          break;
        case Mat.Sand:
          if (temp[i] > 0.55 && r < 0.05) f = Feat.Palm;
          break;
        case Mat.Snow:
          if (height[i] < 8 && forest > 0.5 && r < 0.35) f = Feat.SnowPine;
          break;
        case Mat.Rock:
          if (r < 0.06) f = Feat.Boulder;
          else if (r < 0.085) f = Feat.Ore;
          break;
        case Mat.Swamp:
          if (r < 0.12) f = Feat.Dead; else if (r < 0.2) f = Feat.Oak;
          break;
      }
      if (f === Feat.Oak && temp[i] < 0.42 && r < 0.6) f = Feat.Pine;
      world.feat[i] = f;
      world.featAmt[i] = f === Feat.None ? 0 : 160 + Math.floor(hash2(z, x, 3) * 95);
      world.grass[i] = mt === Mat.Grass || mt === Mat.Lush ? 220 : mt === Mat.Savanna ? 150 : mt === Mat.Swamp ? 120 : 0;
    }
  }

  world.markTerrain(0, 0, W - 1, H - 1);
  world.computeIslands();
  return world;
}

/** Continental shelves: shallow turquoise rings hugging every coast, deep blue beyond. */
function shapeSeabed(h: Float32Array, W: number, H: number, n: Noise2D) {
  const N = W * H;
  const dist = new Float32Array(N).fill(1e9);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (h[i] >= 0) { dist[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const t = q[qh++];
    const x = t % W, z = (t / W) | 0;
    const d = dist[t] + 1;
    if (x > 0 && dist[t - 1] > d) { dist[t - 1] = d; q[qt++] = t - 1; }
    if (x < W - 1 && dist[t + 1] > d) { dist[t + 1] = d; q[qt++] = t + 1; }
    if (z > 0 && dist[t - W] > d) { dist[t - W] = d; q[qt++] = t - W; }
    if (z < H - 1 && dist[t + W] > d) { dist[t + W] = d; q[qt++] = t + W; }
  }
  for (let i = 0; i < N; i++) {
    if (h[i] >= 0) continue;
    const x = i % W, z = (i / W) | 0;
    const d = dist[i] + n.noise(x * 0.09, z * 0.09) * 2.2;
    const shelf = -(0.35 + Math.pow(Math.max(0, d), 1.25) * 0.42);
    h[i] = Math.max(-13, Math.min(h[i] * 0.6, shelf));
  }
}

function nearSea(world: World, x: number, z: number, r: number) {
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const xx = x + dx, zz = z + dz;
    if (!world.inside(xx, zz)) continue;
    const t = world.idx(xx, zz);
    if (world.height[t] < 0) return true;
  }
  return false;
}

function blur(a: Float32Array, W: number, H: number, passes: number) {
  const tmp = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
        const w = dx === 0 && dz === 0 ? 4 : (dx === 0 || dz === 0 ? 2 : 1);
        s += a[zz * W + xx] * w; n += w;
      }
      tmp[z * W + x] = s / n;
    }
    a.set(tmp);
  }
}

/**
 * Priority-flood the heightmap from the ocean, derive drainage, accumulate flow and carve
 * rivers + lakes where enough water collects. Produces natural branching river networks.
 */
function carveRivers(world: World, rng: Rng, temp: Float32Array) {
  const { W, H, N, height, water } = world;
  const filled = new Float32Array(N);
  const parent = new Int32Array(N).fill(-1);
  const order = new Int32Array(N);
  const done = new Uint8Array(N);
  const heap = new Heap(N * 2);
  let oc = 0;
  for (let i = 0; i < N; i++) {
    const x = i % W, z = (i / W) | 0;
    if (height[i] < 0 || x === 0 || z === 0 || x === W - 1 || z === H - 1) {
      filled[i] = Math.max(height[i], height[i] < 0 ? height[i] : 0);
      done[i] = 1; heap.push(filled[i], i);
    }
  }
  const dx8 = [1, -1, 0, 0, 1, 1, -1, -1], dz8 = [0, 0, 1, -1, 1, -1, 1, -1];
  while (heap.size > 0) {
    const t = heap.pop();
    order[oc++] = t;
    const x = t % W, z = (t / W) | 0;
    for (let k = 0; k < 8; k++) {
      const xx = x + dx8[k], zz = z + dz8[k];
      if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
      const n = zz * W + xx;
      if (done[n]) continue;
      done[n] = 1;
      filled[n] = Math.max(height[n], filled[t] + 0.0005);
      parent[n] = t;
      heap.push(filled[n], n);
    }
  }
  // flow accumulation (reverse topological order)
  const acc = new Float32Array(N);
  for (let i = 0; i < N; i++) acc[i] = height[i] > 0 ? (0.5 + world.moist[i] / 255) * clamp01(temp[i] + 0.4) : 0;
  for (let k = oc - 1; k >= 0; k--) {
    const t = order[k];
    const p = parent[t];
    if (p >= 0) acc[p] += acc[t];
  }
  let land = 0;
  for (let i = 0; i < N; i++) if (height[i] > 0) land++;
  const thr = Math.max(60, land * 0.011);

  // lakes: depressions deeper than a margin
  for (let i = 0; i < N; i++) {
    if (height[i] > 0 && filled[i] - height[i] > 0.35) {
      water[i] = filled[i];
      height[i] = Math.min(height[i], filled[i] - 0.6);
    }
  }
  // rivers
  const riverW = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (height[i] <= 0 || acc[i] < thr) continue;
    riverW[i] = clamp(Math.log2(acc[i] / thr) * 0.5 + 0.6, 0.6, 2.2);
  }
  const newH = height.slice();
  for (let i = 0; i < N; i++) {
    if (riverW[i] <= 0) continue;
    const x = i % W, z = (i / W) | 0;
    const lvl = Math.max(0.02, filled[i] - 0.12);
    const r = riverW[i];
    const R = Math.ceil(r);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
      const n = zz * W + xx;
      const d = Math.hypot(dx, dz);
      if (d <= r * 0.75) {
        if (water[n] < lvl) water[n] = lvl;
        newH[n] = Math.min(newH[n], lvl - 0.35 - 0.25 * (1 - d / r));
      } else if (d <= r + 1.2) {
        // soften banks
        const bank = lvl + 0.15 + (d - r * 0.75) * 0.45;
        if (newH[n] > bank && height[n] > 0) newH[n] = lerp(newH[n], bank, 0.6);
      }
    }
  }
  height.set(newH);
  void rng;
}
