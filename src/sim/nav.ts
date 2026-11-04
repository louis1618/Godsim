import { Sim } from './sim';
import { World } from './world';
import { Unit } from './entities';
import { Feat, isTree } from './defs';
import { hash2 } from '../core/rng';

/**
 * Movement & collision helpers shared by every walker. Buildings block (except fields/ruins/fresh
 * foundations), water blocks walkers, and stance points are chosen so creatures visibly touch what
 * they work on: trunks when chopping, walls when building or smashing.
 */

export function free(w: World, t: number): boolean {
  if (t < 0 || !w.walkable(t)) return false;
  return !(w.bld[t] >= 0 && !w.bldPassable(t));
}
export const freeAt = (w: World, x: number, z: number) => free(w, w.tileAt(x, z));

/** Where a feature's trunk/rock actually sits inside its tile (same jitter the renderer uses). */
export function featureOffset(x: number, z: number, f: number): [number, number] {
  if (f === Feat.Crop) return [x + 0.5, z + 0.5];
  const r2 = hash2(x, z, 23), r3 = hash2(x, z, 37);
  return [x + 0.5 + (r2 - 0.5) * 0.56, z + 0.5 + (r3 - 0.5) * 0.56];
}

/** How far from the feature's centre a worker stands so the tool lands on it. */
export function featureReach(f: number, amt: number): number {
  if (isTree(f)) return 0.36 + 0.06 * Math.min(1, amt / 200);
  if (f === Feat.Boulder || f === Feat.Ore) return 0.58;
  if (f === Feat.Berry) return 0.5;
  return 0.42;
}

/** Nearest free tile centre within maxR tiles (ring search). */
export function nearestFree(w: World, x: number, z: number, maxR = 6): [number, number] | null {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  if (free(w, w.tileAt(x, z))) return [x, z];
  let best: [number, number] | null = null, bd = 1e9;
  for (let r = 1; r <= maxR; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const xx = x0 + dx, zz = z0 + dz;
      if (!w.inside(xx, zz) || !free(w, w.idx(xx, zz))) continue;
      const d = (xx + 0.5 - x) ** 2 + (zz + 0.5 - z) ** 2;
      if (d < bd) { bd = d; best = [xx + 0.5, zz + 0.5]; }
    }
    if (best) return best;
  }
  return null;
}

/** A spot right next to a building's footprint, on the side nearest the unit, touching the wall. */
export function standAtBuilding(sim: Sim, b: { x: number; z: number; size: number }, u: Unit, spread = 0): [number, number] {
  const w = sim.world;
  let best: [number, number] | null = null, bd = 1e9;
  const s = b.size;
  for (let i = -1; i <= s; i++) {
    for (const [xx, zz] of [[b.x + i, b.z - 1], [b.x + i, b.z + s], [b.x - 1, b.z + i], [b.x + s, b.z + i]] as [number, number][]) {
      if (!w.inside(xx, zz) || !free(w, w.idx(xx, zz))) continue;
      // nudge toward the footprint so tools reach the wall
      const cx = Math.max(b.x, Math.min(b.x + s, xx + 0.5)), cz = Math.max(b.z, Math.min(b.z + s, zz + 0.5));
      const px = xx + 0.5 + (cx - (xx + 0.5)) * 0.62, pz = zz + 0.5 + (cz - (zz + 0.5)) * 0.62;
      // spread workers around the building using their personal seed
      const jitter = spread ? hash2(xx, zz, (u.look & 255) + 1) * spread : 0;
      const d = (px - u.x) ** 2 + (pz - u.z) ** 2 + jitter;
      if (d < bd) { bd = d; best = [px, pz]; }
    }
  }
  return best ?? [b.x + s / 2, b.z + s + 0.4];
}

/** Stance next to a feature: reach distance from the trunk, on a free tile, facing it. */
export function standAtFeature(sim: Sim, u: Unit, t: number): [number, number] {
  const w = sim.world;
  const x = t % w.W, z = (t / w.W) | 0;
  const f = w.feat[t];
  const [fx, fz] = featureOffset(x, z, f);
  const reach = featureReach(f, w.featAmt[t]);
  let a0 = Math.atan2(u.z - fz, u.x - fx);
  for (let k = 0; k < 12; k++) {
    const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.55;
    const px = fx + Math.cos(a) * reach, pz = fz + Math.sin(a) * reach;
    if (freeAt(w, px, pz)) return [px, pz];
  }
  return [fx + Math.cos(a0) * reach, fz + Math.sin(a0) * reach];
}

/**
 * Advance toward (wx,wz) by at most `sp`, sliding along obstacles. Returns the distance moved.
 */
export function stepToward(w: World, u: Unit, wx: number, wz: number, sp: number, allowWater: boolean): number {
  const dx = wx - u.x, dz = wz - u.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return 0;
  const k = Math.min(1, sp / d);
  const ok = (x: number, z: number) => {
    const t = w.tileAt(x, z);
    if (t < 0) return false;
    if (w.bld[t] >= 0 && !w.bldPassable(t)) return false;
    return allowWater ? true : w.walkable(t);
  };
  const nx = u.x + dx * k, nz = u.z + dz * k;
  const here = w.tileAt(u.x, u.z);
  // already stuck inside something: let the unit walk out freely
  const inside = here >= 0 && !ok(u.x, u.z);
  if (inside || ok(nx, nz)) { u.x = nx; u.z = nz; return d * k; }
  // slide along whichever axis is open
  if (ok(nx, u.z)) { const m = Math.abs(nx - u.x); u.x = nx; return m; }
  if (ok(u.x, nz)) { const m = Math.abs(nz - u.z); u.z = nz; return m; }
  return 0;
}

/** If a creature ended up inside a blocking footprint (e.g. a building was placed on it), pop it out. */
export function resolveInside(sim: Sim, u: Unit) {
  const w = sim.world;
  const t = w.tileAt(u.x, u.z);
  if (t < 0 || !(w.bld[t] >= 0 && !w.bldPassable(t))) return;
  const p = nearestFree(w, u.x, u.z, 8);
  if (p) { u.x = u.px = p[0]; u.z = u.pz = p[1]; u.path = null; }
}
