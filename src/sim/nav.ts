import { Sim } from './sim';
import { World } from './world';
import { Unit } from './entities';
import { Feat, isTree, Sp, SPECIES } from './defs';
import { UF, Anim } from './entities';
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
function stepOk(w: World, x: number, z: number, allowWater: boolean): boolean {
  const t = w.tileAt(x, z);
  if (t < 0) return false;
  if (w.bld[t] >= 0 && !w.bldPassable(t)) return false;
  return allowWater ? true : w.walkable(t);
}
export function stepToward(w: World, u: Unit, wx: number, wz: number, sp: number, allowWater: boolean): number {
  const dx = wx - u.x, dz = wz - u.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return 0;
  const k = Math.min(1, sp / d);
  const nx = u.x + dx * k, nz = u.z + dz * k;
  const here = w.tileAt(u.x, u.z);
  // already stuck inside something: let the unit walk out freely
  const inside = here >= 0 && !stepOk(w, u.x, u.z, allowWater);
  if (inside || stepOk(w, nx, nz, allowWater)) { u.x = nx; u.z = nz; return d * k; }
  // slide along whichever axis is open
  if (stepOk(w, nx, u.z, allowWater)) { const m = Math.abs(nx - u.x); u.x = nx; return m; }
  if (stepOk(w, u.x, nz, allowWater)) { const m = Math.abs(nz - u.z); u.z = nz; return m; }
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

/** Personal space radius per creature (machines and big beasts need more room). */
export function bodyRadius(sp: Sp): number {
  switch (sp) {
    case Sp.Boat: return 0.75;
    case Sp.Tank: return 0.55;
    case Sp.Troll: case Sp.Bear: case Sp.Crocodile: return 0.42;
    case Sp.Rabbit: case Sp.Chicken: case Sp.Fish: return 0.14;
    default: return 0.22 * SPECIES[sp].size + 0.04;
  }
}

/**
 * Soft separation: creatures standing in each other's space drift apart a little every other tick.
 * Working, fighting and sleeping creatures hold their spot (others step around them). The push never
 * goes into walls or (for walkers) into water. Deterministic: depends only on the simulation.
 */
export const navOpts = { separation: true };
const NOPUSH = UF.Ragdoll | UF.Held | UF.Aboard | UF.Jailed | UF.Dead | UF.Beamed;
export function separate(sim: Sim, u: Unit) {
  // every 4th tick (pushes are twice as strong): a fifth of the old cost for the same drift speed
  if (!navOpts.separation || (sim.tick + u.id) & 3) return;
  if (u.flags & (UF.Ragdoll | UF.Held | UF.Jailed | UF.Aboard | UF.Escorted | UF.Dead) || u.y > 1) return;
  if (u.anim === Anim.Work || u.anim === Anim.Attack || u.anim === Anim.Sleep || u.anim === Anim.Eat) return;
  const r = bodyRadius(u.sp);
  const boat = u.sp === Sp.Boat;
  let px = 0, pz = 0;
  // walk the spatial hash directly (no closure, no allocation: this runs for every creature)
  const R = r + 0.8, CELLS = sim.cellSize;
  const cx0 = Math.max(0, ((u.x - R) / CELLS) | 0), cx1 = Math.min(sim.cw - 1, ((u.x + R) / CELLS) | 0);
  const cz0 = Math.max(0, ((u.z - R) / CELLS) | 0), cz1 = Math.min(sim.ch - 1, ((u.z + R) / CELLS) | 0);
  const units = sim.units, head = sim.cellHead, next = sim.cellNext;
  for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
    for (let i = head[cz * sim.cw + cx]; i >= 0; i = next[i]) {
      const o = units[i];
      if (!o || o === u || o.flags & NOPUSH || o.y > 1) continue;
      if ((o.sp === Sp.Boat) !== boat || o.sp === Sp.Fish) continue; // boats only shove boats; fish swim under
      const dx = u.x - o.x, dz = u.z - o.z, d2 = dx * dx + dz * dz;
      const rr = r + bodyRadius(o.sp);
      if (d2 >= rr * rr) continue;
      let d = Math.sqrt(d2), nx: number, nz: number;
      if (d < 1e-4) { const a = ((u.id * 2654435761) >>> 0) / 4294967296 * Math.PI * 2; nx = Math.cos(a); nz = Math.sin(a); d = 0; }
      else { nx = dx / d; nz = dz / d; }
      // the one standing still (working, fighting) does not budge, so the mover takes the whole push
      const share = o.anim === Anim.Work || o.anim === Anim.Attack || o.anim === Anim.Sleep ? 1 : 0.5;
      const k = (rr - d) * share;
      px += nx * k; pz += nz * k;
    }
  }
  if (px === 0 && pz === 0) return;
  const m = Math.hypot(px, pz), cap = Math.min(m, 0.16);
  const tx = u.x + (px / m) * cap, tz = u.z + (pz / m) * cap;
  const w = sim.world;
  const t = w.tileAt(tx, tz);
  if (t < 0) return;
  if (boat) { if (w.waterDepth(t) <= 0.3) return; }
  else if (!free(w, t) && !(u.sp === Sp.Crocodile && w.isWater(t))) return;
  u.x = tx; u.z = tz;
}
