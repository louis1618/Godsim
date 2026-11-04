import { Sim } from './sim';
import { World, CHUNK } from './world';
import { Mat } from './defs';
import { fireTiles } from './nature';
import { clearClaims } from './ai';
import { clearFarmClaims } from './civ';

/** The world never ends: it grows by whole chunks (32 tiles) up to this many tiles per side. */
export const MAX_WORLD = 768;

const ARRAYS = ['height', 'water', 'mat', 'feat', 'featAmt', 'grass', 'fire', 'owner', 'bld', 'moist', 'wet', 'plague'] as const;

/**
 * Grow the world by `left/top/right/bottom` tiles (rounded up to chunks). New space is open ocean
 * that slopes into the abyss. Every entity is shifted so nothing moves on screen.
 * Returns the applied shift (dx, dz) or null when the world is already at its maximum size.
 */
export function growWorld(sim: Sim, left: number, top: number, right: number, bottom: number): { dx: number; dz: number } | null {
  const r = (n: number) => Math.ceil(Math.max(0, n) / CHUNK) * CHUNK;
  left = r(left); top = r(top); right = r(right); bottom = r(bottom);
  const old = sim.world;
  let W = old.W + left + right, H = old.H + top + bottom;
  if (W > MAX_WORLD) { const over = W - MAX_WORLD; right = Math.max(0, right - over); W = old.W + left + right; if (W > MAX_WORLD) { left = Math.max(0, MAX_WORLD - old.W - right); W = old.W + left + right; } }
  if (H > MAX_WORLD) { const over = H - MAX_WORLD; bottom = Math.max(0, bottom - over); H = old.H + top + bottom; if (H > MAX_WORLD) { top = Math.max(0, MAX_WORLD - old.H - bottom); H = old.H + top + bottom; } }
  if (W === old.W && H === old.H) return null;
  const w = new World(W, H);
  w.height.fill(-9); w.mat.fill(Mat.Sand);
  for (const k of ARRAYS) {
    const src = old[k] as any, dst = w[k] as any;
    for (let z = 0; z < old.H; z++) dst.set(src.subarray(z * old.W, (z + 1) * old.W), (z + top) * W + left);
  }
  // seabed in the new strips: continue the old edge downward so there is no cliff
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const ox = x - left, oz = z - top;
    if (ox >= 0 && oz >= 0 && ox < old.W && oz < old.H) continue;
    const cx = Math.min(old.W - 1, Math.max(0, ox)), cz = Math.min(old.H - 1, Math.max(0, oz));
    const edgeH = old.height[cz * old.W + cx];
    const d = Math.hypot(ox - cx, oz - cz);
    w.height[z * W + x] = Math.min(edgeH, 0) - Math.min(9, d * 0.45) - 0.3;
  }
  w.navVersion = old.navVersion + 1;
  w.terrainVersion = old.terrainVersion + 1;
  w.markTerrain(0, 0, W - 1, H - 1);
  w.ownerDirty = true;
  // shift everything that has a position
  const dx = left, dz = top;
  for (const u of sim.units) { u.x += dx; u.z += dz; u.px += dx; u.pz += dz; u.path = null; u.task = null; u.think = 0; }
  for (const b of sim.buildings.values()) { b.x += dx; b.z += dz; }
  for (const v of sim.villages.values()) { v.cx += dx; v.cz += dz; }
  for (const c of sim.rainClouds) { c.x += dx; c.z += dz; }
  for (const t of sim.tornadoes) { t.x += dx; t.z += dz; }
  for (const m of sim.meteors) { m.x += dx; m.z += dz; }
  for (const h of sim.history) { if (h.x !== undefined) h.x += dx; if (h.z !== undefined) h.z += dz; }
  const fires = [...fireTiles];
  fireTiles.clear();
  for (const t of fires) fireTiles.add((Math.floor(t / old.W) + dz) * W + (t % old.W) + dx);
  clearClaims(); clearFarmClaims();
  sim.bindWorld(w);
  w.computeIslands();
  return { dx, dz };
}
