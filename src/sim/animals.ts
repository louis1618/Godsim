import { Sim } from './sim';
import { Unit, Anim, Emote, UF } from './entities';
import { Sp, SPECIES, YEAR_TICKS, TICK_DT, isCiv, Bk } from './defs';
import { ignite } from './nature';
import { eats } from './foodchain';

/**
 * Creatures with their own way of moving: fish swim in schools and never leave the water,
 * dragons fly between lairs and settlements breathing fire. Everything else walks (ai.ts).
 */

const AGE_STEP = 10 / YEAR_TICKS;

function waterOk(sim: Sim, x: number, z: number) {
  const t = sim.world.tileAt(x, z);
  return t >= 0 && sim.world.waterDepth(t) > 0.25;
}

export function fishTick(sim: Sim, u: Unit) {
  u.px = u.x; u.pz = u.z;
  if (u.hitT > 0) u.hitT--;
  if ((sim.tick + u.id) % 10 === 0) {
    u.age += AGE_STEP;
    if (u.age > u.maxAge) { sim.killUnit(u, 'age'); return; }
    if (u.breedT > 0) u.breedT -= 10;
  }
  const w = sim.world;
  if (!waterOk(sim, u.x, u.z)) {
    // stranded: flop toward water or die
    u.anim = Anim.Panic;
    if (sim.tick % 10 === 0) { u.hp -= 2; u.hitT = 3; if (u.hp <= 0) { sim.killUnit(u, 'stranded'); return; } }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (waterOk(sim, u.x + Math.cos(a) * 1.2, u.z + Math.sin(a) * 1.2)) { u.x += Math.cos(a) * 0.05; u.z += Math.sin(a) * 0.05; break; }
    }
    return;
  }
  u.anim = Anim.Walk;
  u.y = -0.18;
  const t = u.task;
  if (!t || t.k !== 'wander' || --u.think <= 0) {
    // school: drift toward kin, otherwise roam
    let cx = 0, cz = 0, n = 0;
    sim.near(u.x, u.z, 5, (o) => { if (o.sp === Sp.Fish && o !== u) { cx += o.x; cz += o.z; n++; } });
    let tx = u.x + sim.rng.range(-4, 4), tz = u.z + sim.rng.range(-4, 4);
    if (n > 0 && sim.rng.chance(0.6)) { tx = cx / n + sim.rng.range(-1.5, 1.5); tz = cz / n + sim.rng.range(-1.5, 1.5); }
    if (!waterOk(sim, tx, tz)) { tx = u.x + sim.rng.range(-2, 2); tz = u.z + sim.rng.range(-2, 2); }
    if (waterOk(sim, tx, tz)) u.task = { k: 'wander', tx, tz };
    u.think = 20 + sim.rng.int(0, 30);
    // spawning
    if (sim.laws.animals && u.breedT <= 0 && u.age >= SPECIES[Sp.Fish].adultAge && n > 0 && sim.count(Sp.Fish) < fishCap(sim)) {
      u.breedT = Math.floor(SPECIES[Sp.Fish].breedEvery * YEAR_TICKS * sim.rng.range(0.8, 1.4));
      for (let i = 0; i < SPECIES[Sp.Fish].litter; i++) sim.spawnUnit(Sp.Fish, u.x + sim.rng.range(-0.4, 0.4), u.z + sim.rng.range(-0.4, 0.4), { age: 0 });
    }
  }
  const tk = u.task;
  if (tk && tk.k === 'wander') {
    const dx = tk.tx - u.x, dz = tk.tz - u.z, d = Math.hypot(dx, dz);
    const sp = SPECIES[Sp.Fish].speed * TICK_DT * (0.6 + 0.4 * Math.sin((sim.tick + u.id) * 0.3) ** 2);
    if (d < 0.1) { u.task = null; return; }
    const nx = u.x + (dx / d) * Math.min(sp, d), nz = u.z + (dz / d) * Math.min(sp, d);
    if (waterOk(sim, nx, nz)) { u.x = nx; u.z = nz; u.dir = Math.atan2(dx, dz); } else u.task = null;
  }
  if (u.x === u.px && u.z === u.pz) u.anim = Anim.Idle;
  void w;
}

export function fishCap(sim: Sim) {
  // roughly proportional to open water; re-counted every 600 ticks. The count lives in the
  // simulation state (saved with it): a module-wide cache used to leak one world's water into the
  // next world of the same size, and into a freshly loaded save.
  const w = sim.world;
  const c = sim.waterCount;
  if (c.N !== w.N || sim.tick - c.t >= 600 || sim.tick < c.t) {
    let water = 0;
    for (let i = 0; i < w.N; i += 7) if (w.waterDepth(i) > 0.5) water++;
    c.n = water * 7; c.N = w.N; c.t = sim.tick;
  }
  return Math.min(260, c.n / 90);
}

// --------------------------------------------------------------------------- dragons

const CRUISE = 3.6;

export function dragonTick(sim: Sim, u: Unit) {
  u.px = u.x; u.pz = u.z;
  if (u.cd > 0) u.cd--;
  if (u.hitT > 0) u.hitT--;
  if (u.emoteT > 0 && --u.emoteT === 0) u.emote = Emote.None;
  if ((sim.tick + u.id) % 10 === 0) {
    u.hunger = Math.min(100, u.hunger + 0.35);
    if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + 2);
  }
  const w = sim.world;
  // pick a target: prey or a settlement to burn
  let t = u.task;
  if (!t || (t.k !== 'attack' && t.k !== 'wander') || --u.think <= 0) {
    u.think = 60 + sim.rng.int(0, 60);
    let best: Unit | null = null, bd = 30 * 30;
    if (u.hunger > 40) sim.near(u.x, u.z, 30, (o, d2) => { if (o !== u && eats(Sp.Dragon, o.sp) && !(o.flags & UF.Jailed) && d2 < bd) { bd = d2; best = o; } });
    if (best) u.task = t = { k: 'attack', u: (best as Unit).id };
    else {
      // roam between mountains and towns
      let tx = u.x + sim.rng.range(-30, 30), tz = u.z + sim.rng.range(-30, 30);
      if (sim.rng.chance(0.4)) {
        const vs = [...sim.villages.values()].filter((v) => v.alive);
        if (vs.length) { const v = sim.rng.pick(vs); tx = v.cx + 0.5; tz = v.cz + 0.5; }
      }
      tx = Math.max(4, Math.min(w.W - 5, tx)); tz = Math.max(4, Math.min(w.H - 5, tz));
      u.task = t = { k: 'wander', tx, tz };
    }
  }
  let tx = u.x, tz = u.z, target: Unit | undefined;
  if (t && t.k === 'attack') { target = sim.getUnit(t.u); if (!target) { u.task = null; return; } tx = target.x; tz = target.z; }
  else if (t && t.k === 'wander') { tx = t.tx; tz = t.tz; }
  const dx = tx - u.x, dz = tz - u.z, d = Math.hypot(dx, dz);
  // fly: glide in, swoop low over prey
  const wantY = target && d < 6 ? 1.6 : CRUISE;
  u.y += (wantY - u.y) * 0.06;
  u.anim = Anim.Fly;
  if (d > 1.2) {
    const want = Math.atan2(dx, dz);
    let dd = want - u.dir; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2;
    u.dir += Math.max(-0.12, Math.min(0.12, dd));
    const sp = SPECIES[Sp.Dragon].speed * TICK_DT;
    u.x = Math.max(1, Math.min(w.W - 2, u.x + Math.sin(u.dir) * sp));
    u.z = Math.max(1, Math.min(w.H - 2, u.z + Math.cos(u.dir) * sp));
  } else if (t && t.k === 'wander') u.task = null;
  // breathe fire in a cone ahead
  if (u.cd <= 0 && (target ? d < 5 : sim.rng.chance(0.02))) {
    u.cd = Math.round(SPECIES[Sp.Dragon].attackRate * 10);
    u.anim = Anim.Attack; u.animT = 8;
    breath(sim, u);
  }
}

function breath(sim: Sim, u: Unit) {
  const w = sim.world;
  const fx = Math.sin(u.dir), fz = Math.cos(u.dir);
  sim.fx.push({ t: 'breath', x: u.x, z: u.z, y: u.y, tx: u.x + fx * 5, tz: u.z + fz * 5, u: u.id });
  for (let s = 1; s <= 5; s++) {
    const cx = u.x + fx * s, cz = u.z + fz * s, r = 0.5 + s * 0.25;
    sim.near(cx, cz, r, (o) => {
      if (o === u || o.sp === Sp.Dragon) return;
      o.hp -= SPECIES[Sp.Dragon].dmg * 0.5; o.hitT = 6;
      o.flags |= UF.Burning;
      if (o.hp <= 0) {
        sim.killUnit(o, 'fire', u);
        if (eats(Sp.Dragon, o.sp)) u.hunger = Math.max(0, u.hunger - 35);
      }
    });
    const t = w.tileAt(cx, cz);
    if (t >= 0 && sim.rng.chance(0.6)) ignite(sim, t, 220);
    const b = t >= 0 ? sim.buildingAt(t) : undefined;
    if (b && b.kind !== Bk.Ruin) { if (b.fire === 0) b.fire = 160; sim.damageBuilding(b, 18); }
  }
}

/** Can this creature live in (and cross) water? */
export const aquatic = (sp: Sp) => sp === Sp.Fish || sp === Sp.Crocodile;
export const flying = (sp: Sp) => sp === Sp.Dragon;

void isCiv;
