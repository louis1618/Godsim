import { Sim } from './sim';
import { PENDING } from './pending';
import { Unit, UF, Anim, Emote, Building } from './entities';
import { SPECIES, Sp, Bk, Mat, Feat, TICK_DT, isCiv, isVehicle, isMonster, isTree } from './defs';
import { hurt, setTask, panic } from './ai';
import { stepToward, free } from './nav';
import { ignite } from './nature';
import { explode } from './disasters';
import { findEnemy } from './vehicles';

/**
 * Monsters and the elements they bring (WorldBox-style, original take):
 *  - Zombies: slow undead whose bite turns the fallen into more zombies; fire burns them twice over.
 *  - Mages (wandering sorcerers): fireballs from afar, blink away when wounded, raise the fresh dead.
 *  - UFOs: hover over the land, beam creatures up, laser buildings; shot down (or struck by lightning,
 *    which seeks metal) they crash and their alien crew fights on.
 *  - Demons: set the grass alight where they walk; water and rain burn them.
 *  - Cold ones: frost spreads under their feet - fires die, shallow water freezes into walkable ice;
 *    fire hurts them three times over. Demons and cold ones fight on sight.
 * Also: towers shoot (turrets in the industrial age), town mages heal and hurl fireballs, acid rain
 * corrodes metal and kills plants, napalm sets whole streets on fire.
 */

export type Faction = 'living' | 'undead' | 'alien' | 'demon' | 'cold' | 'mage';
export function faction(sp: Sp): Faction {
  switch (sp) {
    case Sp.Zombie: case Sp.Skeleton: case Sp.Troll: return 'undead';
    case Sp.UFO: case Sp.Alien: return 'alien';
    case Sp.Demon: return 'demon';
    case Sp.ColdOne: return 'cold';
    case Sp.Mage: return 'mage';
    default: return SPECIES[sp]?.undead ? 'undead' : 'living';
  }
}

/** Monster hostility (null = leave it to the ordinary rules). The sorcerer commands the dead. */
export function monsterHostile(a: Unit, b: Unit): boolean | null {
  if (!isMonster(a.sp) && !isMonster(b.sp)) return null;
  const fa = faction(a.sp), fb = faction(b.sp);
  if (fa === fb) return false;
  if ((fa === 'mage' && fb === 'undead') || (fa === 'undead' && fb === 'mage')) return false;
  if (b.sp === Sp.Fish || a.sp === Sp.Fish) return false;
  return true;
}

/** Items carried by monsters: 18 staff, 19 ray gun. */
export function monsterItem(sp: Sp) { return sp === Sp.Mage ? 18 : sp === Sp.Alien ? 19 : 0; }

const METAL_ITEMS = new Set([4, 8, 12, 13, 19]);

// ---------------------------------------------------------------------------------------- decisions

/** What a monster does when no threat is right on top of it: seek prey further out, else roam. */
export function decideMonster(sim: Sim, u: Unit) {
  const r = u.sp === Sp.Zombie ? 12 : 16;
  let best: Unit | null = null, bd = r * r;
  sim.near(u.x, u.z, r, (o, d2) => {
    if (o === u || d2 >= bd || o.flags & (UF.Held | UF.Jailed | UF.Aboard)) return;
    if (!sim.hostile(u, o) || o.sp === Sp.Fish) return;
    if (o.y > 1 && monsterItem(u.sp) === 0) return; // only casters and gunners reach fliers
    bd = d2; best = o;
  });
  if (best) { setTask(sim, u, { k: 'attack', u: (best as Unit).id }); return; }
  // demons and cold ones also wreck what they find; everyone else drifts toward the towns
  const w = sim.world;
  let tx = u.x + sim.rng.range(-10, 10), tz = u.z + sim.rng.range(-10, 10);
  if (sim.rng.chance(0.35)) {
    let vd = 60 * 60;
    for (const v of sim.villages.values()) { if (!v.alive) continue; const d2 = (v.cx - u.x) ** 2 + (v.cz - u.z) ** 2; if (d2 < vd) { vd = d2; tx = v.cx + 0.5; tz = v.cz + 0.5; } }
  }
  tx = Math.max(2, Math.min(w.W - 3, tx)); tz = Math.max(2, Math.min(w.H - 3, tz));
  const t = w.tileAt(tx, tz);
  if (t >= 0 && free(w, t)) setTask(sim, u, { k: 'move', tx, tz });
  else setTask(sim, u, { k: 'idle', t: 15 });
}

/** Per-tick traits of the monster breeds (called from unitTick before decisions). */
export function monsterTick(sim: Sim, u: Unit) {
  const w = sim.world;
  const t = w.tileAt(u.x, u.z);
  if (t < 0) return;
  switch (u.sp) {
    case Sp.Demon:
      // brimstone: the ground catches where a demon walks; water and rain scald it
      if ((sim.tick + u.id) % 6 === 0 && !w.isWater(t) && sim.rng.chance(0.35)) ignite(sim, t, 120);
      if ((sim.tick + u.id) % 10 === 0) {
        if (w.isWater(t)) hurt(sim, u, 14, undefined, 'drown');
        else if (sim.weather.rain > 0.5) hurt(sim, u, 4, undefined, 'rain');
      }
      u.flags &= ~UF.Burning;
      break;
    case Sp.ColdOne:
      if ((sim.tick + u.id) % 10 === 0) frostAura(sim, u.x, u.z, 2.2);
      break;
    case Sp.Mage:
      // a wounded sorcerer blinks away and, once safe, calls the fresh dead back up
      if (u.hp < u.maxHp * 0.45 && u.cd <= 0 && (sim.tick + u.id) % 5 === 0 && u.hitT > 0) blink(sim, u);
      if ((sim.tick + u.id) % 80 === 0) raiseDead(sim, u);
      break;
    case Sp.Zombie:
      // the hungry dead moan now and then
      if ((sim.tick + u.id) % 90 === 0) sim.emote(u, Emote.Skull, 20);
      break;
  }
}

/** Frost: fires die, grass turns to snow, shallow water freezes into walkable ice. */
export function frostAura(sim: Sim, x: number, z: number, r: number) {
  const w = sim.world;
  const R = Math.ceil(r);
  let changed = false;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dz * dz > r * r) continue;
    const xx = Math.floor(x) + dx, zz = Math.floor(z) + dz;
    if (!w.inside(xx, zz)) continue;
    const t = w.idx(xx, zz);
    if (w.fire[t]) w.fire[t] = 0;
    if (w.isWater(t)) {
      if (w.waterDepth(t) < 0.8 && w.bld[t] < 0) {
        // ice: the water surface becomes ground (kept as snow), so walkers can cross
        w.height[t] = w.water[t] + 0.02; w.mat[t] = Mat.Snow; w.grass[t] = 0;
        changed = true;
      }
      continue;
    }
    const m = w.mat[t];
    if (m === Mat.Grass || m === Mat.Lush || m === Mat.Savanna || m === Mat.Ash || m === Mat.Soil) {
      w.mat[t] = Mat.Snow; w.grass[t] = 0; w.markMat(xx, zz, xx, zz);
      const f = w.feat[t];
      if (f === Feat.Oak || f === Feat.Birch || f === Feat.Pine) w.setFeat(t, Feat.SnowPine, w.featAmt[t]);
      else if (f === Feat.Flower || f === Feat.Berry || f === Feat.Crop) w.setFeat(t, Feat.None, 0);
    } else if (m === Mat.Lava) { w.mat[t] = Mat.Rock; w.markMat(xx, zz, xx, zz); }
  }
  if (changed) {
    const x0 = Math.floor(x) - R, z0 = Math.floor(z) - R;
    w.markTerrain(x0, z0, x0 + 2 * R, z0 + 2 * R);
    w.islandsDirty = true;
    sim.fx.push({ t: 'freeze', x, z, a: r });
  }
}

function blink(sim: Sim, u: Unit) {
  const w = sim.world;
  for (let i = 0; i < 10; i++) {
    const a = sim.rng.range(0, Math.PI * 2), d = sim.rng.range(5, 9);
    const x = u.x + Math.cos(a) * d, z = u.z + Math.sin(a) * d;
    const t = w.tileAt(x, z);
    if (t < 0 || !free(w, t) || w.fire[t] > 0) continue;
    sim.fx.push({ t: 'blink', x: u.x, z: u.z, u: u.id });
    u.x = u.px = x; u.z = u.pz = z; u.path = null; u.task = null; u.think = 0;
    u.cd = 30;
    sim.fx.push({ t: 'blink', x, z, u: u.id });
    return;
  }
}

function raiseDead(sim: Sim, u: Unit) {
  let raised = 0;
  for (const c of sim.recentDead) {
    if (raised >= 2 || c.raised || sim.tick - c.tick > 200) continue;
    if ((c.x - u.x) ** 2 + (c.z - u.z) ** 2 > 64 || !(isCiv(c.sp) || c.sp === Sp.Bear || c.sp === Sp.Wolf)) continue;
    c.raised = true;
    const s = sim.spawnUnit(Sp.Skeleton, c.x, c.z);
    sim.fx.push({ t: 'rise', x: c.x, z: c.z, u: s.id });
    raised++;
  }
  if (raised) { u.anim = Anim.Cast; u.animT = 12; }
}

// ---------------------------------------------------------------------------------------- infection

/** Whoever falls to a zombie's bite gets up again as one of them. */
export function onMonsterKill(sim: Sim, u: Unit, cause: string, by?: Unit) {
  const living = !SPECIES[u.sp].undead && !isVehicle(u.sp) && !isMonster(u.sp) && u.sp !== Sp.Fish && u.sp !== Sp.Dragon && u.sp !== Sp.Chicken && u.sp !== Sp.Rabbit;
  if (!living) return;
  const bitten = by && by.sp === Sp.Zombie;
  const plague = cause === 'plague' && sim.laws.plague && sim.rng.chance(0.15);
  if (!bitten && !plague) return;
  sim.schedule(25, { k: 'rise', x: u.x, z: u.z, sp: Sp.Zombie });
}

// ---------------------------------------------------------------------------------------- UFOs

const HOVER = 2.6;
/** Flying saucer: roams, beams creatures up, burns buildings with a laser. */
export function ufoTick(sim: Sim, u: Unit) {
  u.px = u.x; u.pz = u.z;
  if (u.cd > 0) u.cd--;
  if (u.hitT > 0) u.hitT--;
  const w = sim.world;
  u.anim = Anim.Hover;
  u.y += (HOVER - u.y) * 0.08;
  let t = u.task;
  // beaming someone up: hold still over them while they rise
  if (t && t.k === 'abduct') {
    const o = sim.getUnit(t.u);
    if (!o || o.flags & UF.Dead) { u.task = null; return; }
    o.flags |= UF.Beamed; o.x = o.px = u.x; o.z = o.pz = u.z; o.y = Math.min(HOVER - 0.4, o.y + 0.11);
    if (sim.tick % 3 === 0) sim.fx.push({ t: 'beam', x: u.x, z: u.z, y: u.y, u: u.id });
    if (--t.t <= 0) {
      o.flags |= UF.Ragdoll; // gone without a body
      sim.killUnit(o, 'abducted');
      sim.fx.push({ t: 'abduct', x: u.x, z: u.z, u: u.id });
      sim.stats.abducted = (sim.stats.abducted ?? 0) + 1;
      u.task = null; u.think = 0;
    }
    return;
  }
  if (!t || --u.think <= 0) {
    u.think = 50 + sim.rng.int(0, 40);
    const prey = findPrey(sim, u, 7);
    if (prey && sim.rng.chance(0.55)) { u.task = t = { k: 'attack', u: prey.id }; }
    else {
      let tx = u.x + sim.rng.range(-24, 24), tz = u.z + sim.rng.range(-24, 24);
      if (sim.rng.chance(0.5)) { const vs = [...sim.villages.values()].filter((v) => v.alive); if (vs.length) { const v = sim.rng.pick(vs); tx = v.cx + sim.rng.range(-4, 4); tz = v.cz + sim.rng.range(-4, 4); } }
      u.task = t = { k: 'wander', tx: Math.max(3, Math.min(w.W - 4, tx)), tz: Math.max(3, Math.min(w.H - 4, tz)) };
    }
  }
  let tx = u.x, tz = u.z;
  let target: Unit | undefined;
  if (t && t.k === 'attack') { target = sim.getUnit(t.u); if (!target) { u.task = null; return; } tx = target.x; tz = target.z; }
  else if (t && t.k === 'wander') { tx = t.tx; tz = t.tz; }
  const dx = tx - u.x, dz = tz - u.z, d = Math.hypot(dx, dz);
  if (d > 0.3) {
    const sp = Math.min(d, SPECIES[Sp.UFO].speed * TICK_DT);
    u.x = Math.max(1, Math.min(w.W - 2, u.x + (dx / d) * sp));
    u.z = Math.max(1, Math.min(w.H - 2, u.z + (dz / d) * sp));
    u.dir = Math.atan2(dx, dz);
  } else if (t && t.k === 'wander') { u.task = null; u.think = 0; }
  // the tractor beam reaches a little way out: a fleeing villager is caught when it passes under the rim
  if (target && d < 1.6 && u.cd <= 0 && !(target.flags & (UF.Held | UF.Beamed))) {
    // tractor beam
    u.task = { k: 'abduct', u: target.id, t: 22 };
    setTask(sim, target, { k: 'idle', t: 40 });
    target.anim = Anim.Panic;
    u.cd = 60;
    return;
  }
  // laser: buildings below, or anyone shooting at us
  if (u.cd <= 0 && (sim.tick + u.id) % 7 === 0) {
    const shooter = u.lastHit >= 0 ? sim.getUnit(u.lastHit) : undefined;
    if (shooter && Math.hypot(shooter.x - u.x, shooter.z - u.z) < 7) { laser(sim, u, shooter.x, shooter.z, SPECIES[Sp.UFO].dmg); hurt(sim, shooter, SPECIES[Sp.UFO].dmg, u, 'laser'); u.cd = 16; return; }
    const b = nearBuilding(sim, u.x, u.z, 5);
    if (b && sim.rng.chance(0.35)) {
      const bx = b.x + b.size / 2, bz = b.z + b.size / 2;
      laser(sim, u, bx, bz, 0);
      sim.damageBuilding(b, 45, u);
      if (sim.rng.chance(0.3)) { b.fire = Math.max(b.fire, 120); sim.fx.push({ t: 'ignite', x: bx, z: bz }); }
      u.cd = 18;
    }
  }
}

function findPrey(sim: Sim, u: Unit, r: number): Unit | null {
  let best: Unit | null = null, bd = r * r;
  sim.near(u.x, u.z, r, (o, d2) => {
    if (o === u || d2 >= bd || o.flags & (UF.Held | UF.Jailed | UF.Aboard | UF.Ragdoll | UF.Beamed) || o.y > 0.5) return;
    if (faction(o.sp) === 'alien' || isVehicle(o.sp) || o.sp === Sp.Fish || o.sp === Sp.Dragon) return;
    bd = d2; best = o;
  });
  return best;
}

function nearBuilding(sim: Sim, x: number, z: number, r: number): Building | null {
  const w = sim.world;
  let best: Building | null = null, bd = r * r;
  const R = Math.ceil(r);
  for (let dz = -R; dz <= R; dz += 2) for (let dx = -R; dx <= R; dx += 2) {
    const t = w.tileAt(x + dx, z + dz);
    if (t < 0 || w.bld[t] < 0) continue;
    const b = sim.buildings.get(w.bld[t]);
    if (!b || !b.alive || b.kind === Bk.Ruin) continue;
    const d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; best = b; }
  }
  return best;
}

export function laser(sim: Sim, u: Unit, tx: number, tz: number, _dmg: number) {
  sim.fx.push({ t: 'laser', x: u.x, z: u.z, y: u.y, tx, tz, u: u.id, a: u.sp === Sp.Alien ? 1 : 0 });
}

/** A downed saucer crashes in a fireball; its crew climbs out of the wreck. */
export function onUfoDeath(sim: Sim, u: Unit) {
  // anyone caught in the beam drops out of it (and falls)
  for (const o of sim.units) if (o.flags & UF.Beamed && Math.abs(o.x - u.x) < 2 && Math.abs(o.z - u.z) < 2) { o.flags &= ~UF.Beamed; o.vy = 0; if (o.y < 0.01) o.y = 0.01; }
  explode(sim, u.x, u.z, 2.2, 90, { fire: true, fling: true });
  const n = 2 + sim.rng.int(0, 2);
  for (let i = 0; i < n; i++) {
    const a = sim.rng.range(0, Math.PI * 2);
    const x = u.x + Math.cos(a) * 0.8, z = u.z + Math.sin(a) * 0.8;
    const t = sim.world.tileAt(x, z);
    if (t < 0 || !sim.world.walkable(t)) continue;
    const al = sim.spawnUnit(Sp.Alien, x, z);
    sim.fx.push({ t: 'rise', x, z, u: al.id });
  }
}

// ---------------------------------------------------------------------------------------- spells

/** Fireball: flies for a moment, bursts, sets the spot alight; the dead burn twice as well. */
export function fireball(sim: Sim, by: Unit, tx: number, tz: number, dmg: number) {
  const d = Math.hypot(tx - by.x, tz - by.z);
  sim.fx.push({ t: 'fireball', x: by.x, z: by.z, y: by.y, tx, tz, u: by.id, a: Math.max(3, Math.round(d * 1.4)) });
  sim.schedule(Math.max(3, Math.round(d * 1.4)), { k: 'burst', x: tx, z: tz, by: by.id, dmg });
}
PENDING.burst = (sim, e) => {
  const tx = e.x!, tz = e.z!, dmg = e.dmg!;
  {
    const caster = e.by !== undefined ? sim.getUnit(e.by) : undefined;
    sim.fx.push({ t: 'fireburst', x: tx, z: tz });
    sim.near(tx, tz, 1.1, (o) => {
      if (o.flags & UF.Dead || (caster && !sim.hostile(caster, o) && o !== caster ? isCiv(o.sp) || faction(o.sp) === faction(caster.sp) : false)) return;
      if (caster && o === caster) return;
      const k = SPECIES[o.sp].undead ? 2 : o.sp === Sp.ColdOne ? 2.5 : o.sp === Sp.Demon ? 0.2 : 1;
      hurt(sim, o, dmg * k, caster, 'fire');
      if (!(o.flags & UF.Dead) && o.sp !== Sp.Demon) o.flags |= UF.Burning;
    });
    const t = sim.world.tileAt(tx, tz);
    if (t >= 0) ignite(sim, t, 150);
  }
};

/** Ranged spell / ray gun shot for runAttack. Returns true when handled. */
export function castAt(sim: Sim, u: Unit, o: Unit, dmg: number): boolean {
  if (u.item === 18) {
    u.anim = Anim.Cast; u.animT = 8;
    fireball(sim, u, o.x + (o.x - o.px) * 4, o.z + (o.z - o.pz) * 4, dmg * 1.15);
    return true;
  }
  if (u.item === 19) {
    laser(sim, u, o.x, o.z, dmg);
    hurt(sim, o, dmg, u, 'laser');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------- town mages

/** A town mage between battles: mend the most wounded neighbour, otherwise study at the library. */
export function mageWork(sim: Sim, u: Unit, villageId: number) {
  let best: Unit | null = null, bw = 0.3;
  sim.near(u.x, u.z, 12, (o) => {
    if (o === u || o.village !== villageId || !isCiv(o.sp) || o.flags & (UF.Dead | UF.Jailed)) return;
    const missing = 1 - o.hp / o.maxHp;
    if (missing > bw) { bw = missing; best = o; }
  });
  return best ? { k: 'heal' as const, u: (best as Unit).id, t: 40 } : null;
}

export function runHeal(sim: Sim, u: Unit, t: { k: 'heal'; u: number; t: number }, moveTo: (sim: Sim, u: Unit, tx: number, tz: number, arrive?: number) => boolean) {
  const o = sim.getUnit(t.u);
  if (!o || o.hp >= o.maxHp) { u.task = null; u.think = 0; return; }
  if (Math.hypot(o.x - u.x, o.z - u.z) > 2.2) { moveTo(sim, u, o.x, o.z, 2.0); return; }
  u.dir = Math.atan2(o.x - u.x, o.z - u.z);
  u.anim = Anim.Cast;
  if (--t.t % 10 === 0) {
    o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.12);
    o.flags &= ~(UF.Burning | UF.Sick);
    sim.fx.push({ t: 'heal', x: o.x, z: o.z, u: o.id });
  }
  if (t.t <= 0 || o.hp >= o.maxHp) { u.task = null; u.think = 0; }
}

// ---------------------------------------------------------------------------------------- towers

/** Watchtowers loose arrows at enemies; from the industrial age they are machine-gun turrets. */
export function towerTick(sim: Sim, b: Building) {
  if (b.progress < 1) return;
  const v = sim.villages.get(b.village);
  if (!v) return;
  const k = sim.kingdoms.get(v.kingdom);
  const turret = (k?.era ?? 0) >= 3;
  if (turret && b.level !== 1) b.level = 1;
  const every = turret ? 6 : 16;
  if ((sim.tick + b.id) % every !== 0) return;
  const cx = b.x + 0.5, cz = b.z + 0.5;
  const e = findEnemy(sim, cx, cz, turret ? 8 : 7, v.kingdom, true);
  if (!e) return;
  b.aim = Math.atan2(e.x - cx, e.z - cz);
  const d = Math.hypot(e.x - cx, e.z - cz);
  const dmg = turret ? 20 : 15;
  sim.fx.push({ t: turret ? 'shot' : 'arrow', x: cx, z: cz, y: turret ? 1.4 : 1.2, tx: e.x, tz: e.z, u: -1 });
  sim.schedule(Math.max(1, Math.round(d * (turret ? 0.4 : 1.1))), { k: 'hit', u: e.id, dmg, cause: 'attack' });
}

// ---------------------------------------------------------------------------------------- weather & metal

/** Lightning seeks metal: a strike near a tank, a turret, a saucer or an armed soldier hits them. */
export let lightningRod: Unit | null = null;
export function lightningTarget(sim: Sim, x: number, z: number): [number, number] {
  let best: [number, number] | null = null, bd = 4.5 * 4.5;
  lightningRod = null;
  for (const o of sim.units) {
    if (o.flags & UF.Dead || !(isVehicle(o.sp) || o.sp === Sp.UFO)) continue;
    const d2 = (o.x - x) ** 2 + (o.z - z) ** 2;
    if (d2 < bd) { bd = d2; best = [o.x, o.z]; lightningRod = o; }
  }
  sim.near(x, z, 4.5, (o, d2) => {
    if (d2 >= bd || !isCiv(o.sp) || !METAL_ITEMS.has(o.item)) return;
    bd = d2; best = [o.x, o.z];
  });
  if (best) return best;
  const w = sim.world;
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const t = w.tileAt(x + dx, z + dz);
    if (t < 0 || w.bld[t] < 0) continue;
    const b = sim.buildings.get(w.bld[t]);
    if (!b || !(b.kind === Bk.Cannon || b.kind === Bk.Factory || (b.kind === Bk.Tower && b.level === 1))) continue;
    const d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; best = [b.x + b.size / 2, b.z + b.size / 2]; }
  }
  return best ?? [x, z];
}

/** Acid rain: corrodes metal fastest, then flesh and stone; withers plants; still puts fires out. */
export function acidTick(sim: Sim) {
  const w = sim.world;
  for (const a of sim.acidRains) {
    a.life--;
    if (sim.tick % 10 === 0) {
      sim.near(a.x, a.z, a.r, (o) => {
        if (o.sp === Sp.Fish || o.flags & UF.Jailed) return;
        const metal = isVehicle(o.sp) || o.sp === Sp.UFO;
        const k = metal ? 6 : o.sp === Sp.Alien || o.sp === Sp.Demon ? 0.5 : SPECIES[o.sp].undead ? 1 : 1.6;
        hurt(sim, o, k, undefined, 'acid');
        if (!(o.flags & UF.Dead) && !metal && isCiv(o.sp) && sim.rng.chance(0.08) && o.task?.k !== 'flee') panic(sim, o, a.x, a.z);
      });
    }
    // a handful of tiles per tick: plants wither, fields burn out, fires hiss away
    for (let i = 0; i < 6; i++) {
      const ang = sim.rng.range(0, Math.PI * 2), d = Math.sqrt(sim.rng.next()) * a.r;
      const t = w.tileAt(a.x + Math.cos(ang) * d, a.z + Math.sin(ang) * d);
      if (t < 0 || w.isWater(t)) continue;
      if (w.fire[t]) w.fire[t] = 0;
      w.grass[t] = Math.max(0, w.grass[t] - 50);
      const f = w.feat[t];
      if (f === Feat.Crop || f === Feat.Flower || f === Feat.Berry) w.setFeat(t, Feat.None, 0);
      else if (isTree(f) && f !== Feat.Dead && f !== Feat.Cactus && sim.rng.chance(0.08)) w.setFeat(t, Feat.Dead, 120);
      if ((w.mat[t] === Mat.Grass || w.mat[t] === Mat.Lush) && sim.rng.chance(0.15)) { w.mat[t] = Mat.Soil; w.markMat(w.tx(t), w.tz(t), w.tx(t), w.tz(t)); }
      const b = w.bld[t] >= 0 ? sim.buildings.get(w.bld[t]) : undefined;
      if (b && b.alive) { b.fire = 0; sim.damageBuilding(b, b.kind === Bk.Factory || b.kind === Bk.Cannon ? 6 : 2.5); }
    }
  }
  if (sim.acidRains.length) sim.acidRains = sim.acidRains.filter((a) => a.life > 0);
}

export function spawnAcidRain(sim: Sim, x: number, z: number, r: number) {
  sim.acidRains.push({ id: sim.id(), x, z, r, life: 300 });
  sim.fx.push({ t: 'acid', x, z, a: r });
}

/** Napalm: a fire bomb that coats a street in burning jelly. */
export function napalmImpact(sim: Sim, x: number, z: number) {
  explode(sim, x, z, 1.2, 30, {});
  const w = sim.world;
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
    if (dx * dx + dz * dz > 16) continue;
    const t = w.tileAt(x + dx, z + dz);
    if (t < 0 || w.isWater(t)) continue;
    ignite(sim, t, 255);
    const b = w.bld[t] >= 0 ? sim.buildings.get(w.bld[t]) : undefined;
    if (b && b.alive) b.fire = Math.max(b.fire, 220);
  }
  sim.near(x, z, 4, (o) => { if (o.sp !== Sp.Demon && !(o.flags & UF.Dead)) { o.flags |= UF.Burning; hurt(sim, o, 12, undefined, 'fire'); } });
  sim.fx.push({ t: 'napalm', x, z });
}

/** Burning creatures make for the nearest water (rolling in it puts them out). */
export function seekWater(sim: Sim, u: Unit): boolean {
  if (u.sp === Sp.Demon) return false;
  const w = sim.world;
  const x0 = Math.floor(u.x), z0 = Math.floor(u.z);
  for (let r = 1; r <= 6; r++) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const t = w.tileAt(x0 + Math.cos(a) * r + 0.5, z0 + Math.sin(a) * r + 0.5);
      if (t < 0 || !w.isWater(t) || w.waterDepth(t) > 1.0) continue;
      setTask(sim, u, { k: 'flee', tx: (t % w.W) + 0.5, tz: ((t / w.W) | 0) + 0.5 });
      return true;
    }
  }
  return false;
}

void stepToward;
