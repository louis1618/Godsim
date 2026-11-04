import { Mat, Feat, MATS } from './defs';

export const CHUNK = 32;

/** Region of the tile grid that changed (inclusive bounds). */
export class DirtyRect {
  x0 = Infinity; z0 = Infinity; x1 = -Infinity; z1 = -Infinity;
  add(x0: number, z0: number, x1: number, z1: number) {
    if (x0 < this.x0) this.x0 = x0; if (z0 < this.z0) this.z0 = z0;
    if (x1 > this.x1) this.x1 = x1; if (z1 > this.z1) this.z1 = z1;
  }
  get empty() { return this.x0 > this.x1; }
  clear() { this.x0 = this.z0 = Infinity; this.x1 = this.z1 = -Infinity; }
}

/**
 * Tile grid state. One tile = one world unit. Tile (x,z) covers [x,x+1]x[z,z+1].
 * Everything here is plain typed arrays so it serialises trivially and is renderer agnostic.
 */
export class World {
  readonly W: number;
  readonly H: number;
  readonly N: number;
  height: Float32Array;   // terrain height (world units, sea level 0)
  water: Float32Array;    // water surface level (sea = 0, rivers/lakes higher)
  mat: Uint8Array;        // surface material (Mat)
  feat: Uint8Array;       // feature on tile (Feat)
  featAmt: Uint8Array;    // growth for trees / remaining amount for resources
  grass: Uint8Array;      // grazing vegetation 0..255
  fire: Uint8Array;       // burning intensity 0..255
  owner: Int16Array;      // owning village id, -1 for none
  bld: Int32Array;        // building id occupying the tile, -1 none
  moist: Uint8Array;      // base moisture (variation)
  wet: Uint8Array;        // rain wetness (temporary)
  plague: Uint8Array;     // contamination
  island: Int32Array;     // walkable connected-component id (-1 = not walkable)

  // change tracking for renderers / caches
  dirtyTerrain = new DirtyRect();
  dirtyMat = new DirtyRect();
  featChunkDirty: Uint8Array;
  ownerDirty = true;
  islandsDirty = true;
  /** bumps whenever walkability changes (terrain edits, buildings placed/removed) */
  navVersion = 0;
  /** bumps on height edits (physics collider rebuilds follow it) */
  terrainVersion = 0;
  readonly CW: number;
  readonly CH: number;

  constructor(W: number, H: number) {
    this.W = W; this.H = H; this.N = W * H;
    const N = this.N;
    this.height = new Float32Array(N);
    this.water = new Float32Array(N);
    this.mat = new Uint8Array(N);
    this.feat = new Uint8Array(N);
    this.featAmt = new Uint8Array(N);
    this.grass = new Uint8Array(N);
    this.fire = new Uint8Array(N);
    this.owner = new Int16Array(N).fill(-1);
    this.bld = new Int32Array(N).fill(-1);
    this.moist = new Uint8Array(N);
    this.wet = new Uint8Array(N);
    this.plague = new Uint8Array(N);
    this.island = new Int32Array(N).fill(-1);
    this.CW = Math.ceil(W / CHUNK); this.CH = Math.ceil(H / CHUNK);
    this.featChunkDirty = new Uint8Array(this.CW * this.CH).fill(1);
  }

  idx(x: number, z: number) { return z * this.W + x; }
  inside(x: number, z: number) { return x >= 0 && z >= 0 && x < this.W && z < this.H; }
  tx(t: number) { return t % this.W; }
  tz(t: number) { return (t / this.W) | 0; }
  tileAt(x: number, z: number) {
    const ix = Math.floor(x), iz = Math.floor(z);
    if (ix < 0 || iz < 0 || ix >= this.W || iz >= this.H) return -1;
    return iz * this.W + ix;
  }

  isWater(t: number) { return this.water[t] > this.height[t]; }
  isDeep(t: number) { return this.water[t] - this.height[t] > 1.2; }
  waterDepth(t: number) { return this.water[t] - this.height[t]; }

  /** Bilinear interpolation of height at tile centres (tile centre = x+0.5). */
  heightAt(x: number, z: number): number {
    const W = this.W, H = this.H, h = this.height;
    let fx = x - 0.5, fz = z - 0.5;
    if (fx < 0) fx = 0; if (fz < 0) fz = 0;
    if (fx > W - 1.001) fx = W - 1.001; if (fz > H - 1.001) fz = H - 1.001;
    const ix = fx | 0, iz = fz | 0, ax = fx - ix, az = fz - iz;
    const i = iz * W + ix;
    const a = h[i], b = h[i + 1], c = h[i + W], d = h[i + W + 1];
    return (a * (1 - ax) + b * ax) * (1 - az) + (c * (1 - ax) + d * ax) * az;
  }

  /** Height of whatever surface stands at (x,z): terrain or water. */
  surfaceAt(x: number, z: number): number {
    const t = this.tileAt(x, z);
    const h = this.heightAt(x, z);
    if (t < 0) return h;
    return Math.max(h, this.water[t]);
  }

  walkable(t: number): boolean {
    if (t < 0) return false;
    if (this.water[t] > this.height[t]) return false;
    const m = this.mat[t];
    if (m === Mat.Lava) return false;
    return true;
  }

  /** Buildings that units may walk through (fields, ruins). Set by the sim. */
  bldPassable: (t: number) => boolean = () => false;

  walkCost(t: number): number {
    let c = MATS[this.mat[t]].walkCost;
    const f = this.feat[t];
    if (f !== Feat.None && f !== Feat.Flower && f !== Feat.Crop) c += 0.6;
    if (this.fire[t] > 0) c += 8;
    return c;
  }

  markTerrain(x0: number, z0: number, x1: number, z1: number) {
    this.dirtyTerrain.add(x0, z0, x1, z1);
    this.dirtyMat.add(x0, z0, x1, z1);
    this.islandsDirty = true;
    this.navVersion++;
    this.terrainVersion++;
    this.markFeat(x0, z0, x1, z1);
  }
  markMat(x0: number, z0: number, x1: number, z1: number) { this.dirtyMat.add(x0, z0, x1, z1); }
  markFeatTile(t: number) {
    const cx = (this.tx(t) / CHUNK) | 0, cz = (this.tz(t) / CHUNK) | 0;
    this.featChunkDirty[cz * this.CW + cx] = 1;
  }
  markFeat(x0: number, z0: number, x1: number, z1: number) {
    const cx0 = Math.max(0, Math.floor(x0 / CHUNK)), cz0 = Math.max(0, Math.floor(z0 / CHUNK));
    const cx1 = Math.min(this.CW - 1, Math.floor(x1 / CHUNK)), cz1 = Math.min(this.CH - 1, Math.floor(z1 / CHUNK));
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) this.featChunkDirty[cz * this.CW + cx] = 1;
  }

  setFeat(t: number, f: number, amt = 255) {
    if (this.feat[t] === f && this.featAmt[t] === amt) return;
    this.feat[t] = f; this.featAmt[t] = amt;
    this.markFeatTile(t);
  }

  /** Recompute walkable connected components (used to reject impossible paths quickly). */
  computeIslands() {
    const { W, H, N } = this;
    const isl = this.island;
    isl.fill(-1);
    const stack = new Int32Array(N);
    let id = 0;
    for (let s = 0; s < N; s++) {
      if (isl[s] !== -1 || !this.walkable(s)) continue;
      let sp = 0; stack[sp++] = s; isl[s] = id;
      while (sp > 0) {
        const t = stack[--sp];
        const x = t % W, z = (t / W) | 0;
        if (x > 0) { const n = t - 1; if (isl[n] === -1 && this.walkable(n)) { isl[n] = id; stack[sp++] = n; } }
        if (x < W - 1) { const n = t + 1; if (isl[n] === -1 && this.walkable(n)) { isl[n] = id; stack[sp++] = n; } }
        if (z > 0) { const n = t - W; if (isl[n] === -1 && this.walkable(n)) { isl[n] = id; stack[sp++] = n; } }
        if (z < H - 1) { const n = t + W; if (isl[n] === -1 && this.walkable(n)) { isl[n] = id; stack[sp++] = n; } }
      }
      id++;
    }
    this.islandsDirty = false;
  }
}

/** Catmull-Rom bicubic height sample at continuous world coords (tile centres at i+0.5). */
export function heightCubic(h: Float32Array, W: number, H: number, x: number, z: number): number {
  const fx = x - 0.5, fz = z - 0.5;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const wx0 = ((-0.5 * tx + 1) * tx - 0.5) * tx, wx1 = (1.5 * tx - 2.5) * tx * tx + 1;
  const wx2 = ((-1.5 * tx + 2) * tx + 0.5) * tx, wx3 = (0.5 * tx - 0.5) * tx * tx;
  const wz0 = ((-0.5 * tz + 1) * tz - 0.5) * tz, wz1 = (1.5 * tz - 2.5) * tz * tz + 1;
  const wz2 = ((-1.5 * tz + 2) * tz + 0.5) * tz, wz3 = (0.5 * tz - 0.5) * tz * tz;
  let s = 0;
  for (let j = 0; j < 4; j++) {
    let zz = iz - 1 + j; if (zz < 0) zz = 0; else if (zz >= H) zz = H - 1;
    const row = zz * W;
    let x0 = ix - 1, x1 = ix, x2 = ix + 1, x3 = ix + 2;
    if (x0 < 0) x0 = 0; if (x1 < 0) x1 = 0; if (x2 < 0) x2 = 0; if (x3 < 0) x3 = 0;
    if (x0 >= W) x0 = W - 1; if (x1 >= W) x1 = W - 1; if (x2 >= W) x2 = W - 1; if (x3 >= W) x3 = W - 1;
    const r = h[row + x0] * wx0 + h[row + x1] * wx1 + h[row + x2] * wx2 + h[row + x3] * wx3;
    s += r * (j === 0 ? wz0 : j === 1 ? wz1 : j === 2 ? wz2 : wz3);
  }
  return s;
}
