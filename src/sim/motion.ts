import { Sim } from './sim';
import { Unit, UF, Anim } from './entities';
import { SPECIES, Sp, Feat, isVehicle } from './defs';
import { free, featureOffset, bodyRadius } from './nav';
import { hurt } from './ai';

/**
 * Body physics the simulation itself owns (deterministic, camera-independent; the Rapier ragdolls
 * in the browser handle big throws on top of this):
 *  - momentum: a knockback or a fling gives a creature velocity that slides it along the ground and
 *    bleeds off with friction, instead of teleporting it; walls and water stop the slide
 *  - gravity: anything off the ground (thrown, dropped by a downed saucer...) falls, lands with a
 *    puff of dust and takes damage from a hard landing
 *  - solid obstacles: tree trunks, boulders and ore rocks push bodies out instead of being walked
 *    through (the one a worker is busy with is exempt - its stance is placed against it)
 */
const GRAVITY = 0.16;        // tiles / tick^2: 16 tiles/s^2, the same pull as the browser's ragdoll physics
const FRICTION = 0.62;       // velocity kept per tick while sliding on the ground
const AIR_DRAG = 0.98;

export function impulse(u: Unit, vx: number, vz: number, vy = 0) {
  u.vx += vx; u.vz += vz; u.vy += vy;
  u.lod = 0;
}

/** Integrate a creature's own momentum for one tick. Returns true while it is off its feet. */
export function motionTick(sim: Sim, u: Unit): boolean {
  if (u.flags & (UF.Ragdoll | UF.Held | UF.Beamed | UF.Aboard) || isVehicle(u.sp) || u.sp === Sp.Dragon || u.sp === Sp.UFO || u.sp === Sp.Fish) return false;
  const airborne = u.y > 0.001 || u.vy > 0;
  if (!airborne && Math.abs(u.vx) + Math.abs(u.vz) < 0.002) { u.vx = u.vz = 0; return false; }
  const w = sim.world;
  // horizontal: slide, stopped by walls (and by water for walkers)
  const nx = u.x + u.vx, nz = u.z + u.vz;
  const t = w.tileAt(nx, nz);
  const ok = t >= 0 && (free(w, t) || (!airborne && w.isWater(t) && false) || (airborne && w.isWater(t)));
  if (ok) { u.x = nx; u.z = nz; }
  else { u.vx *= -0.2; u.vz *= -0.2; } // bounce off the wall a little
  if (airborne) {
    u.vy -= GRAVITY;
    u.y += u.vy;
    u.vx *= AIR_DRAG; u.vz *= AIR_DRAG;
    u.anim = Anim.Fly;
    if (u.y <= 0) {
      const impact = -u.vy * 10; // tiles per second at touchdown
      u.y = 0; u.vy = 0;
      sim.fx.push({ t: 'land', x: u.x, z: u.z, a: impact });
      if (impact > 7 && !SPECIES[u.sp].undead) hurt(sim, u, (impact - 7) * 9, undefined, 'fall');
      u.anim = Anim.Idle;
      const here = w.tileAt(u.x, u.z);
      if (here >= 0 && !free(w, here) && !w.isWater(here)) { u.vx = u.vz = 0; }
    }
    return true;
  }
  u.vx *= FRICTION; u.vz *= FRICTION;
  return false;
}

/** Solid features (trunks, boulders) push a body out; the one being worked on does not. */
export const motionOpts = { features: true };
export function featureCollide(sim: Sim, u: Unit) {
  if (!motionOpts.features) return;
  if (u.flags & (UF.Ragdoll | UF.Held | UF.Beamed | UF.Aboard | UF.Jailed) || u.y > 0.5 || isVehicle(u.sp) || u.sp === Sp.Fish || u.sp === Sp.Dragon || u.sp === Sp.UFO) return;
  const w = sim.world;
  const x0 = Math.floor(u.x), z0 = Math.floor(u.z);
  const work = u.task && (u.task.k === 'gather' || u.task.k === 'farm') ? u.task.tile : -1;
  const r = bodyRadius(u.sp) * 0.8;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x0 + dx, zz = z0 + dz;
    if (xx < 0 || zz < 0 || xx >= w.W || zz >= w.H) continue;
    const t = zz * w.W + xx;
    const f = w.feat[t];
    if (f === Feat.None || t === work) continue;
    const solid = f >= Feat.Oak && f <= Feat.Dead ? 0.09 + 0.05 * Math.min(1, w.featAmt[t] / 200) : f === Feat.Boulder || f === Feat.Ore ? 0.2 + 0.12 * Math.min(1, w.featAmt[t] / 160) : 0;
    if (!solid) continue;
    const [fx, fz] = featureOffset(xx, zz, f);
    const ddx = u.x - fx, ddz = u.z - fz, d = Math.hypot(ddx, ddz), min = solid + r;
    if (d >= min) continue;
    const nx = d > 1e-4 ? ddx / d : 1, nz = d > 1e-4 ? ddz / d : 0;
    const px = fx + nx * min, pz = fz + nz * min;
    const pt = w.tileAt(px, pz);
    if (pt >= 0 && free(w, pt)) { u.x = px; u.z = pz; }
  }
}
