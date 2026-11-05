import { Sim, setTimeout0 } from './sim';
import { Unit, Task, Job, Anim, Emote, UF, Res, Mem } from './entities';
import { SPECIES, Sp, Feat, TICK_DT, YEAR_TICKS, isCiv, isVehicle, Trait, Bk, BUILDINGS, isWoodTree, Mat } from './defs';
import { tryFoundVillage, joinVillage, deliverTarget, findWork, villageOf, loot } from './civ';
import { stepToward, nearestFree, standAtBuilding, standAtFeature, featureOffset, resolveInside, free, separate } from './nav';
import { mindTick, socialise, remember } from './mind';
import { addWanted, runPost, runArrest, runEscort, runTrade, jailTick, escortedTick, suspectFlee } from './jobs';
import { vehicleTick } from './vehicles';
import { fishTick, dragonTick, aquatic } from './animals';
import { eats, grazes, hunts } from './foodchain';

const AGE_STEP = 10 / YEAR_TICKS;

export function unitTick(sim: Sim, u: Unit) {
  u.px = u.x; u.pz = u.z;
  if (u.flags & (UF.Ragdoll | UF.Held)) return;
  if (isVehicle(u.sp)) { vehicleTick(sim, u); return; }
  if (u.sp === Sp.Fish) { fishTick(sim, u); return; }
  if (u.sp === Sp.Dragon) { dragonTick(sim, u); return; }
  if (u.flags & UF.Aboard) {
    // riding a ferry: the boat carries us (it also puts us ashore)
    const b = u.task?.k === 'board' ? sim.getUnit(u.task.boat) : undefined;
    if (!b) { u.flags &= ~UF.Aboard; u.y = 0; u.task = null; u.think = 0; }
    return;
  }
  if (u.cd > 0) u.cd--;
  if (u.hitT > 0) u.hitT--;
  if (u.emoteT > 0 && --u.emoteT === 0) u.emote = Emote.None;
  if (u.animT > 0) u.animT--;
  const def = SPECIES[u.sp];
  if ((sim.tick + u.id) % 10 === 0) {
    metabolism(sim, u);
    if (u.flags & UF.Dead) return;
    mindTick(sim, u);
  }
  if (u.flags & UF.Jailed) { jailTick(sim, u); return; }
  if (u.flags & UF.Escorted) { escortedTick(sim, u); return; }
  // standing in fire / lava / deep water
  const w = sim.world;
  const t = w.tileAt(u.x, u.z);
  if (t >= 0) {
    if (w.fire[t] > 40 && sim.tick % 4 === 0) {
      hurt(sim, u, 4 + w.fire[t] * 0.03, undefined, 'fire');
      if (!(u.flags & UF.Dead) && (!u.task || u.task.k !== 'flee')) panic(sim, u, u.x, u.z);
    }
    if (w.mat[t] === Mat.Lava) hurt(sim, u, 25, undefined, 'fire');
    if (w.isWater(t)) {
      u.anim = Anim.Swim;
      if (!aquatic(u.sp)) {
        if (w.isDeep(t) && sim.tick % 8 === 0 && !def.undead) hurt(sim, u, 3, undefined, 'drown');
        if (!u.task || u.task.k === 'idle') escapeWater(sim, u);
      }
    }
    if (u.flags & UF.Dead) return;
  }
  if (--u.think <= 0 || !u.task) decide(sim, u);
  if (u.task) run(sim, u, u.task);
  // walking animations only while the creature really changes position (judged before the
  // separation nudge, so being shuffled aside never shows as walking in place)
  if ((u.anim === Anim.Walk || u.anim === Anim.Panic) && Math.abs(u.x - u.px) + Math.abs(u.z - u.pz) < 1e-4) u.anim = Anim.Idle;
  separate(sim, u);
}

/** Work speed from mood (content workers are productive; miserable ones slack). */
export function workRate(u: Unit) { const m = u.mood ?? 60; return m >= 70 ? 1.2 : m >= 40 ? 1 : m >= 20 ? 0.8 : 0.6; }

function metabolism(sim: Sim, u: Unit) {
  const def = SPECIES[u.sp];
  u.age += AGE_STEP;
  if (!def.undead) {
    const winter = sim.season === 3 ? 1.3 : 1;
    u.hunger += (isCiv(u.sp) ? 0.62 : 0.7) * winter * (u.age < def.adultAge ? 0.6 : 1);
    if (u.hunger >= 100) { u.hunger = 100; hurt(sim, u, 3, undefined, 'hunger'); }
    if (u.age > u.maxAge) { sim.killUnit(u, 'age'); return; }
    if (u.hp < u.maxHp && u.hunger < 70 && !(u.flags & UF.Sick)) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.015);
  }
  if (u.flags & UF.Sick) {
    hurt(sim, u, u.maxHp * 0.03, undefined, 'plague');
    if (u.flags & UF.Dead) return;
    if (sim.rng.chance(0.03)) { u.flags &= ~UF.Sick; sim.fx.push({ t: 'heal', x: u.x, z: u.z, u: u.id }); }
    else if (sim.rng.chance(0.5)) {
      sim.near(u.x, u.z, 1.8, (o) => { if (o !== u && !SPECIES[o.sp].undead && !(o.flags & UF.Sick) && sim.rng.chance(0.25)) { o.flags |= UF.Sick; sim.emote(o, Emote.Sick, 30); } });
    }
  }
  if (u.flags & UF.Burning) {
    hurt(sim, u, 6, undefined, 'fire');
    if (sim.rng.chance(0.15)) u.flags &= ~UF.Burning;
  }
  if (u.breedT > 0) u.breedT -= 10;
}

export function hurt(sim: Sim, u: Unit, dmg: number, by?: Unit, cause = 'attack') {
  if (u.flags & UF.Dead) return;
  if (u.traits & Trait.Lucky && sim.rng.chance(0.15)) return;
  u.hp -= dmg;
  u.hitT = 6;
  if (by) u.lastHit = by.id;
  if (u.hp <= 0) sim.killUnit(u, cause, by);
}

// ------------------------------------------------------------------ decisions

function decide(sim: Sim, u: Unit) {
  u.think = 8 + (u.id % 6);
  const def = SPECIES[u.sp];
  const civ = isCiv(u.sp);
  const adult = u.age >= def.adultAge;

  // trolls keep smashing once they have picked a building, unless they get hurt
  if (u.sp === Sp.Troll && u.task?.k === 'raze' && sim.buildings.get(u.task.b)?.alive && u.hitT === 0) return;
  if (u.sp === Sp.Troll && sim.rng.chance(0.5)) {
    let bb = -1, bbd = 14 * 14;
    for (const b of sim.buildings.values()) { if (!b.alive || b.kind === Bk.Ruin || b.kind === Bk.Farm) continue; const d = (b.x - u.x) ** 2 + (b.z - u.z) ** 2; if (d < bbd) { bbd = d; bb = b.id; } }
    if (bb >= 0) { setTask(sim, u, { k: 'raze', b: bb }); return; }
  }
  // 1. threats & targets
  const threat = scanThreat(sim, u);
  if (threat) {
    const { enemy, dist } = threat;
    const fighter = !civ ? (def.aggressive || u.hp > u.maxHp * 0.6 && SPECIES[enemy.sp].hp < def.hp * 0.7)
      : adult && ((u.flags & UF.King && !(u.traits & (Trait.Brave | Trait.Bloodlust))) ? dist < 1.2 : (u.job === Job.Warrior || u.job === Job.Guard || u.traits & (Trait.Brave | Trait.Bloodlust) || u.flags & (UF.Hero | UF.Mad) || (enemy.sp >= Sp.Sheep && !SPECIES[enemy.sp].aggressive) || dist < 1.5));
    if (fighter && !(u.traits & Trait.Peaceful && !(u.flags & UF.Mad) && enemy.sp <= Sp.Orc)) {
      if (!u.task || u.task.k !== 'attack' || u.task.u !== enemy.id) {
        setTask(sim, u, { k: 'attack', u: enemy.id });
        if (civ && sim.rng.chance(0.4)) sim.emote(u, Emote.Angry, 20);
      }
      return;
    }
    if (dist < 7 && (!u.task || u.task.k !== 'flee')) {
      fleeFrom(sim, u, enemy.x, enemy.z);
      if (civ && sim.rng.chance(0.5)) sim.emote(u, Emote.Alert, 20);
      return;
    }
    if (u.task?.k === 'flee') return;
    // a distant threat: keep an eye on it but carry on living
  }
  // urgent needs break into anything that is not life-or-death
  const urgent = isCiv(u.sp) && u.hunger > 78 && u.task && !['eat', 'attack', 'flee', 'hunt', 'steal', 'arrest', 'escort', 'trade', 'board', 'escorted', 'jailed'].includes(u.task.k) && !(u.task.k === 'gather' && u.task.res === Res.Food);
  if (urgent) u.task = null;
  // keep committed work going; only idle/wander are re-decided
  if (u.task && u.task.k !== 'idle' && u.task.k !== 'wander' && taskValid(sim, u, u.task)) return;

  if (!civ) return decideAnimal(sim, u);

  // 2. homeless civ: join or found a village
  if (u.village < 0) {
    if (u.task && u.task.k === 'settle') return;
    if (joinVillage(sim, u)) return;
    if (adult && sim.tick - u.born > 25 && tryFoundVillage(sim, u)) return;
    wanderNear(sim, u, u.x, u.z, 4);
    return;
  }
  const v = villageOf(sim, u);
  if (!v) { u.village = -1; return; }

  // 2b. wanted: run from the guard on our heels
  const chaser = suspectFlee(sim, u, v);
  if (chaser) { fleeFrom(sim, u, chaser[0], chaser[1]); sim.emote(u, Emote.Alert, 15); return; }

  // 3. carrying something: deliver
  if (u.carry !== Res.None && u.carryAmt > 0) { setTask(sim, u, { k: 'deliver' }); return; }

  // 4. hunger (soldiers on campaign live off supplies)
  if (u.hunger > 60 && u.job === Job.Warrior && v.food >= 1 && sim.kingdoms.get(u.kingdom)?.wars.length) { v.food -= 1; u.hunger = 5; }
  if (u.hunger > 60) {
    if (v.food >= 1) { setTask(sim, u, { k: 'eat' }); return; }
    const berry = findFeature(sim, u.x, u.z, 14, (f) => f === Feat.Berry);
    if (berry >= 0) { setTask(sim, u, { k: 'gather', tile: berry, res: Res.Food, work: 0 }); return; }
  }

  // 4b. needs & mood
  if (u.energy < 20 || (!adult && u.energy < 35)) { setTask(sim, u, { k: 'sleep', t: 200 }); return; }
  if (adult && u.job === Job.Warrior && u.mood < 12 && sim.rng.chance(0.2)) {
    // morale breaks: the soldier throws down their weapon
    u.job = Job.Gatherer; u.item = 9; sim.emote(u, Emote.Sad, 40);
    sim.fx.push({ t: 'desert', x: u.x, z: u.z, u: u.id });
  }
  if (adult && u.mood < 18 && (u.hunger > 65 || u.traits & Trait.Greedy) && v.food >= 2 && sim.rng.chance(0.25)) {
    setTask(sim, u, { k: 'steal', v: v.id }); return;
  }
  const single = adult && u.partner < 0;
  if ((u.social < 25 || (single && u.social < 60)) && sim.rng.chance(0.5)) {
    const near = sim.unitsNear(u.x, u.z, single ? 14 : 8).filter((o) => o !== u && o.village === u.village && o.sp === u.sp && o.task?.k !== 'sleep');
    const mate = single ? near.find((o) => o.partner < 0 && o.female !== u.female && o.age >= SPECIES[o.sp].adultAge) : undefined;
    const pick = mate ?? [u.partner, u.friend].map((id) => sim.getUnit(id)).find((o) => o && Math.hypot(o.x - u.x, o.z - u.z) < 16) ?? near[0];
    if (pick) {
      const t = 30 + sim.rng.int(0, 20);
      setTask(sim, u, { k: 'chat', u: pick.id, t });
      if (!pick.task || pick.task.k === 'idle' || pick.task.k === 'wander') setTask(sim, pick, { k: 'chat', u: u.id, t });
      sim.emote(u, pick.id === u.partner ? Emote.Heart : Emote.Music, 20);
      return;
    }
  }
  if (adult && u.mood > 82 && sim.rng.chance(0.06)) {
    setTask(sim, u, { k: 'dance', t: 40 });
    sim.emote(u, Emote.Music, 30);
    // joy is contagious
    sim.near(u.x, u.z, 4, (o) => { if (o !== u && o.village === u.village && o.mood > 55 && (!o.task || o.task.k === 'idle' || o.task.k === 'wander')) { setTask(sim, o, { k: 'dance', t: 35 }); remember(sim, o, Mem.Party, 6, 0.3); } });
    remember(sim, u, Mem.Party, 6, 0.3);
    return;
  }

  // 5. children play (older ones help pick berries)
  if (!adult && u.age >= SPECIES[u.sp].adultAge * 0.55 && sim.rng.chance(0.35)) {
    const berry = findFeature(sim, u.x, u.z, 10, (f) => f === Feat.Berry);
    if (berry >= 0) { setTask(sim, u, { k: 'gather', tile: berry, res: Res.Food, work: 0 }); return; }
  }
  if (!adult) {
    if (sim.rng.chance(0.3)) {
      const pal = sim.unitsNear(u.x, u.z, 6).find((o) => o !== u && o.village === u.village && o.age < SPECIES[o.sp].adultAge);
      if (pal) { setTask(sim, u, { k: 'wander', tx: pal.x + sim.rng.range(-1, 1), tz: pal.z + sim.rng.range(-1, 1) }); return; }
    }
    wanderNear(sim, u, v.cx + 0.5, v.cz + 0.5, 6);
    return;
  }

  // 6. work
  const work = findWork(sim, u, v);
  if (work) { setTask(sim, u, work); return; }

  // 7. socialising
  if (sim.rng.chance(0.12)) {
    const other = sim.unitsNear(u.x, u.z, 5).find((o) => o !== u && o.village === u.village && isCiv(o.sp) && o.age >= SPECIES[o.sp].adultAge && (!o.task || o.task.k === 'idle' || o.task.k === 'wander'));
    if (other) {
      const t = 25 + sim.rng.int(0, 25);
      setTask(sim, u, { k: 'chat', u: other.id, t });
      setTask(sim, other, { k: 'chat', u: u.id, t });
      const e = sim.rng.pick([Emote.Music, Emote.Heart, Emote.Food, Emote.Star]);
      sim.emote(u, e, 20); setTimeout0(sim, 12, () => sim.emote(other, sim.rng.pick([Emote.Music, Emote.Heart, Emote.Star]), 20));
      return;
    }
  }
  if (sim.rng.chance(0.5)) setTask(sim, u, { k: 'idle', t: 10 + sim.rng.int(0, 20) });
  else wanderNear(sim, u, v.cx + 0.5, v.cz + 0.5, v.radius * 0.7);
}

function decideAnimal(sim: Sim, u: Unit) {
  const def = SPECIES[u.sp];
  if (def.undead) {
    // hunt anything living
    let best: Unit | null = null, bd = 1e9;
    sim.near(u.x, u.z, 14, (o, d2) => { if (!SPECIES[o.sp].undead && d2 < bd) { bd = d2; best = o; } });
    if (best) { setTask(sim, u, { k: 'attack', u: (best as Unit).id }); return; }
    // trolls also go smashing buildings
    if (u.sp === Sp.Troll) {
      let bb = -1, bbd = 18 * 18;
      for (const b of sim.buildings.values()) { if (!b.alive || b.kind === Bk.Ruin) continue; const d = (b.x - u.x) ** 2 + (b.z - u.z) ** 2; if (d < bbd) { bbd = d; bb = b.id; } }
      if (bb >= 0) { setTask(sim, u, { k: 'raze', b: bb }); return; }
    }
    wanderNear(sim, u, u.x, u.z, 8);
    return;
  }
  if (u.hunger > 50) {
    const starving = u.hunger > 85;
    // grazers (and omnivores half the time) eat plants
    if (grazes(u.sp) && (!hunts(u.sp) || sim.rng.chance(0.5) || u.sp === Sp.Boar)) {
      const t = sim.world.tileAt(u.x, u.z);
      if (t >= 0 && sim.world.grass[t] > 40) { setTask(sim, u, { k: 'graze', work: 0 }); return; }
      const g = findGrass(sim, u.x, u.z, 8);
      if (g >= 0) { setTask(sim, u, { k: 'move', tx: (g % sim.world.W) + 0.5, tz: ((g / sim.world.W) | 0) + 0.5, then: { k: 'graze', work: 0 } }); return; }
    }
    // hunters pick prey from the food chain (desperation widens the menu)
    if (hunts(u.sp)) {
      let prey: Unit | null = null, bd = 1e9;
      const range = (u.sp === Sp.Crocodile ? 8 : 12) * (u.hunger > 75 ? 1.6 : 1);
      sim.near(u.x, u.z, range, (o, d2) => {
        if (o.sp === u.sp || o.flags & (UF.Held | UF.Jailed | UF.Aboard)) return;
        if (!eats(u.sp, o.sp, starving)) return;
        if (o.sp === Sp.Fish && d2 > 16) return;          // fish only near the shore
        if (o.y > 1) return;                               // can't reach fliers
        const w2 = d2 * (SPECIES[o.sp].hp > SPECIES[u.sp].hp ? 3 : 1); // prefer manageable prey
        if (w2 < bd) { bd = w2; prey = o; }
      });
      if (prey) { setTask(sim, u, { k: 'hunt', u: (prey as Unit).id }); return; }
    }
  }
  // breeding
  if (sim.laws.animals && u.breedT <= 0 && u.age >= def.adultAge && u.hunger < 45 && def.breedEvery > 0) {
    const pop = sim.count(u.sp);
    const cap = speciesCap(sim, u.sp);
    if (pop < cap) {
      let mate: Unit | null = null;
      sim.near(u.x, u.z, 4, (o) => { if (o !== u && o.sp === u.sp && o.age >= def.adultAge && o.female !== u.female) { mate = o; return true; } });
      if (mate) {
        u.breedT = (mate as Unit).breedT = Math.floor(def.breedEvery * YEAR_TICKS * sim.rng.range(0.8, 1.3));
        sim.emote(u, Emote.Heart, 25); sim.emote(mate, Emote.Heart, 25);
        for (let i = 0; i < def.litter; i++) {
          const b = sim.spawnUnit(u.sp, u.x + sim.rng.range(-0.4, 0.4), u.z + sim.rng.range(-0.4, 0.4), { age: 0 });
          sim.fx.push({ t: 'birth', x: b.x, z: b.z, u: b.id });
        }
        sim.stats.births++;
        return;
      }
      // rare animals go looking for a mate
      let far: Unit | null = null, fd = 22 * 22;
      sim.near(u.x, u.z, 22, (o, d2) => { if (o !== u && o.sp === u.sp && o.age >= def.adultAge && o.female !== u.female && d2 < fd) { fd = d2; far = o; } });
      if (far && fd > 16) { setTask(sim, u, { k: 'wander', tx: (far as Unit).x, tz: (far as Unit).z }); return; }
    }
  }
  // herd behaviour: drift toward kin
  if (!def.aggressive && sim.rng.chance(0.4)) {
    let cx = 0, cz = 0, n = 0;
    sim.near(u.x, u.z, 7, (o) => { if (o.sp === u.sp && o !== u) { cx += o.x; cz += o.z; n++; } });
    if (n > 0) { wanderNear(sim, u, cx / n, cz / n, 3); return; }
  }
  // hungry hunters roam far in search of prey
  const roam = hunts(u.sp) ? (u.hunger > 55 ? 26 : 10) : 6;
  if (sim.rng.chance(u.hunger > 55 && hunts(u.sp) ? 0.1 : 0.35)) setTask(sim, u, { k: 'idle', t: 10 + sim.rng.int(0, 30) });
  else wanderNear(sim, u, u.x, u.z, roam);
}

export function speciesCap(sim: Sim, sp: Sp) {
  const area = sim.world.N / (192 * 192);
  switch (sp) {
    case Sp.Rabbit: return 110 * area;
    case Sp.Fox: return 18 * area;
    case Sp.Boar: return 40 * area;
    case Sp.Crocodile: return 12 * area;
    case Sp.Dragon: return 3;
    case Sp.Sheep: return 90 * area;
    case Sp.Deer: return 70 * area;
    case Sp.Chicken: return 60 * area;
    case Sp.Wolf: return 28 * area;
    case Sp.Bear: return 10 * area;
    default: return 50 * area;
  }
}

function scanThreat(sim: Sim, u: Unit): { enemy: Unit; dist: number } | null {
  const def = SPECIES[u.sp];
  let best: Unit | null = null, bd = 1e9;
  const r = isCiv(u.sp) ? (u.job === Job.Warrior ? 9 : 6) : 6;
  sim.near(u.x, u.z, r, (o, d2) => {
    if (o === u || o.flags & (UF.Held | UF.Ragdoll)) return;
    let threat = sim.hostile(u, o);
    if (!threat) {
      const od = SPECIES[o.sp];
      // predators are threats to everyone smaller; herbivores avoid civs a bit
      if (od.aggressive && o.sp !== u.sp && !def.undead && (o.task?.k === 'hunt' || o.task?.k === 'attack') && (o.task as any).u === u.id) threat = true;
      if (od.aggressive && o.sp !== u.sp && !def.aggressive && !isCiv(u.sp) && d2 < 25) threat = true;
      if (isCiv(u.sp) && od.aggressive && o.sp !== Sp.Skeleton && d2 < 9) threat = true;
      if (isCiv(u.sp) && od.undead) threat = true;
      if (def.aggressive && isCiv(o.sp) && o.task?.k === 'attack' && (o.task as any).u === u.id) threat = true;
      // prey keeps an eye on whoever eats it
      if (!isCiv(u.sp) && eats(o.sp, u.sp) && (d2 < 16 || ((o.task?.k === 'hunt' || o.task?.k === 'attack') && (o.task as any).u === u.id))) threat = true;
      if (o.sp === Sp.Dragon) threat = d2 < 49;
    }
    if (threat && d2 < bd) { bd = d2; best = o; }
  });
  return best ? { enemy: best, dist: Math.sqrt(bd) } : null;
}

function taskValid(sim: Sim, u: Unit, t: Task): boolean {
  if (t.k === 'attack' || t.k === 'hunt') { const o = sim.getUnit(t.u); return !!o && !(o.flags & UF.Held); }
  if (t.k === 'love' || t.k === 'chat') return t.t > 0;
  if (t.k === 'arrest') { const o = sim.getUnit(t.u); return !!o && !(o.flags & (UF.Jailed | UF.Escorted)); }
  return true;
}

export function setTask(sim: Sim, u: Unit, t: Task) {
  u.task = t;
  u.path = null; u.pathI = 0; u.stuck = 0;
  if (t.k === 'flee' || t.k === 'attack' || t.k === 'hunt') u.think = 6;
}

function fleeFrom(sim: Sim, u: Unit, x: number, z: number) {
  let dx = u.x - x, dz = u.z - z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  const v = villageOf(sim, u);
  let tx = u.x + dx * 8, tz = u.z + dz * 8;
  if (v && Math.hypot(v.cx - x, v.cz - z) > 5) { tx = v.cx + 0.5 + dx * 2; tz = v.cz + 0.5 + dz * 2; }
  // never flee into the water (unless at home there)
  if (!aquatic(u.sp)) {
    const w = sim.world;
    const a0 = Math.atan2(tz - u.z, tx - u.x), d0 = Math.hypot(tx - u.x, tz - u.z);
    for (let k = 0; k < 9; k++) {
      const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
      const xx = u.x + Math.cos(a) * d0, zz = u.z + Math.sin(a) * d0;
      const t = w.tileAt(xx, zz);
      if (t >= 0 && w.walkable(t)) { tx = xx; tz = zz; break; }
    }
  }
  setTask(sim, u, { k: 'flee', tx, tz });
}

export function panic(sim: Sim, u: Unit, x: number, z: number) {
  const a = sim.rng.range(0, Math.PI * 2);
  setTask(sim, u, { k: 'flee', tx: x + Math.cos(a) * 6, tz: z + Math.sin(a) * 6 });
  u.anim = Anim.Panic;
}

function escapeWater(sim: Sim, u: Unit) {
  const w = sim.world;
  const x0 = Math.floor(u.x), z0 = Math.floor(u.z);
  for (let r = 1; r < 12; r++) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = Math.floor(x0 + Math.cos(a) * r), z = Math.floor(z0 + Math.sin(a) * r);
      if (!w.inside(x, z)) continue;
      const t = w.idx(x, z);
      if (w.walkable(t)) { u.task = { k: 'move', tx: x + 0.5, tz: z + 0.5 }; u.path = new Int32Array([t]); u.pathI = 0; return; }
    }
  }
}

function wanderNear(sim: Sim, u: Unit, cx: number, cz: number, r: number) {
  const w = sim.world;
  for (let i = 0; i < 6; i++) {
    const a = sim.rng.range(0, Math.PI * 2), d = sim.rng.range(1, r);
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    const t = w.tileAt(x, z);
    if (t >= 0 && w.walkable(t) && w.bld[t] < 0) { setTask(sim, u, { k: 'wander', tx: x, tz: z }); return; }
  }
  setTask(sim, u, { k: 'idle', t: 20 });
}

export function findFeature(sim: Sim, x: number, z: number, r: number, pred: (f: number, t: number) => boolean): number {
  const w = sim.world;
  const x0 = Math.floor(x), z0 = Math.floor(z);
  let best = -1, bd = 1e9;
  const R = Math.ceil(r);
  // sample ring-wise outward; stop at first ring that has candidates
  for (let rr = 0; rr <= R; rr++) {
    for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== rr) continue;
      const xx = x0 + dx, zz = z0 + dz;
      if (!w.inside(xx, zz)) continue;
      const t = w.idx(xx, zz);
      const f = w.feat[t];
      if (f === Feat.None || !pred(f, t)) continue;
      if (claimed.get(t) && claimed.get(t)! > sim.tick) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = t; }
    }
    if (best >= 0) break;
  }
  if (best >= 0) claimed.set(best, sim.tick + 60);
  return best;
}
const claimed = new Map<number, number>();
export function clearClaims() { claimed.clear(); }
export function releaseClaim(t: number) { claimed.delete(t); }

function findGrass(sim: Sim, x: number, z: number, r: number) {
  const w = sim.world;
  for (let i = 0; i < 10; i++) {
    const xx = Math.floor(x + sim.rng.range(-r, r)), zz = Math.floor(z + sim.rng.range(-r, r));
    if (!w.inside(xx, zz)) continue;
    const t = w.idx(xx, zz);
    if (w.grass[t] > 80 && w.walkable(t)) return t;
  }
  return -1;
}

// ------------------------------------------------------------------ execution

/** Move toward (tx,tz) following a path. Returns true when arrived. */
export function moveTo(sim: Sim, u: Unit, tx: number, tz: number, arriveDist = 0.35, speedMul = 1): boolean {
  const dx0 = tx - u.x, dz0 = tz - u.z;
  if (dx0 * dx0 + dz0 * dz0 <= arriveDist * arriveDist) { u.path = null; return true; }
  const w = sim.world;
  if (!u.path) {
    if (sim.pathCalls > 60 || sim.pf.budget < 2500) { u.anim = Anim.Idle; return false; }
    sim.pathCalls++;
    // never aim into a wall: retarget to the nearest free tile
    let goal = w.tileAt(tx, tz);
    if (goal >= 0 && !free(w, goal)) {
      const nf = nearestFree(w, tx, tz, 5);
      if (nf) goal = w.tileAt(nf[0], nf[1]);
    }
    const near = arriveDist >= 1.5 ? Math.floor(arriveDist) : 0;
    // idle strolls may not cost a full search: an unreachable stroll target is simply dropped
    const budget = u.task?.k === 'wander' || u.task?.k === 'idle' ? 500 : 5000;
    const p = sim.pf.find(u.x, u.z, goal, budget, near);
    if (!p) {
      u.stuck++;
      if (u.stuck > 3) { u.task = null; u.think = 0; }
      return false;
    }
    u.path = p; u.pathI = 0; u.pathNav = sim.navVersion;
  }
  // the world changed (building placed/destroyed): re-check the next waypoint
  if (u.pathNav !== sim.navVersion) {
    u.pathNav = sim.navVersion;
    for (let i = u.pathI; i < Math.min(u.path.length, u.pathI + 6); i++) if (!free(w, u.path[i])) { u.path = null; return false; }
  }
  const last = u.pathI >= u.path.length - 1;
  const wt = u.path[Math.min(u.pathI, u.path.length - 1)];
  // personal lateral offset spreads crowds, but never pushes into a blocked tile
  let wx: number, wz: number;
  if (last) { wx = tx; wz = tz; }
  else {
    const cx = (wt % w.W) + 0.5, cz = ((wt / w.W) | 0) + 0.5;
    const ox = ((u.look & 15) / 15 - 0.5) * 0.44, oz = (((u.look >> 4) & 15) / 15 - 0.5) * 0.44;
    if (w.tileAt(cx + ox, cz + oz) === wt) { wx = cx + ox; wz = cz + oz; } else { wx = cx; wz = cz; }
  }
  const dx = wx - u.x, dz = wz - u.z;
  const d = Math.hypot(dx, dz);
  const t = w.tileAt(u.x, u.z);
  const cost = t >= 0 ? (w.isWater(t) ? 2.2 : w.walkCost(t)) : 1;
  let sp = SPECIES[u.sp].speed * u.speedMul * speedMul * TICK_DT / Math.sqrt(cost);
  if (u.age < SPECIES[u.sp].adultAge) sp *= 0.85;
  if (u.flags & UF.Sick) sp *= 0.7;
  sp *= moodSpeed(u);
  const moved = stepToward(w, u, wx, wz, sp, true);
  if (moved <= 1e-5) {
    // blocked: re-plan a few times, then give up on this errand
    if (++u.stuck > 6) { u.path = null; u.blocked = (u.blocked ?? 0) + 1; u.stuck = 0; }
    if ((u.blocked ?? 0) > 3) { u.blocked = 0; u.task = null; u.think = 0; }
    return false;
  }
  u.blocked = 0;
  if (d <= sp + 1e-4) {
    if (!last) u.pathI++;
    else { u.path = null; return Math.hypot(tx - u.x, tz - u.z) <= arriveDist + 0.05; }
  }
  u.dir = Math.atan2(dx, dz);
  if (u.anim !== Anim.Panic || u.task?.k !== 'flee') u.anim = Anim.Walk;
  return false;
}

/** Mood nudges walking pace a little (happy folk stride, miserable folk drag their feet). */
export function moodSpeed(u: Unit) { return 0.9 + Math.max(0, Math.min(1, (u.mood ?? 60) / 100)) * 0.2; }

function face(u: Unit, x: number, z: number) { u.dir = Math.atan2(x - u.x, z - u.z); }

function run(sim: Sim, u: Unit, t: Task) {
  const w = sim.world;
  switch (t.k) {
    case 'idle':
      u.anim = t.plant !== undefined ? Anim.Work : Anim.Idle;
      if (--t.t <= 0) {
        if (t.plant !== undefined && w.feat[t.plant] === Feat.None) {
          const m = w.mat[t.plant];
          w.setFeat(t.plant, m === Mat.Savanna ? Feat.Acacia : u.sp === Sp.Elf ? (sim.rng.chance(0.5) ? Feat.Birch : Feat.Oak) : Feat.Oak, 30);
          sim.fx.push({ t: 'sprout', x: (t.plant % w.W) + 0.5, z: ((t.plant / w.W) | 0) + 0.5, u: t.plant });
        }
        u.task = null; u.think = 0;
      }
      break;
    case 'wander':
    case 'move':
    case 'rally':
      if (moveTo(sim, u, t.tx, t.tz, 0.3, t.k === 'wander' ? 0.6 : 1)) {
        u.anim = Anim.Idle;
        if (t.k === 'move' && t.then) setTask(sim, u, t.then);
        else if (t.k === 'rally') { u.task = { k: 'idle', t: 30 }; }
        else { u.task = null; u.think = 0; }
      }
      break;
    case 'flee':
      if (moveTo(sim, u, t.tx, t.tz, 0.6, 1.15)) { u.task = null; u.think = 0; }
      if (u.anim === Anim.Walk) u.anim = Anim.Panic;
      break;
    case 'settle':
      if (moveTo(sim, u, t.tx, t.tz, 1.5)) { u.task = null; tryFoundVillage(sim, u, true); }
      break;
    case 'gather': runGather(sim, u, t); break;
    case 'deliver': {
      const tgt = deliverTarget(sim, u);
      if (!tgt) { u.carry = Res.None; u.carryAmt = 0; u.task = null; break; }
      const [sx, sz] = tgt;
      if (moveTo(sim, u, sx, sz, 0.8)) {
        const v = villageOf(sim, u);
        if (v) {
          const amt = u.carryAmt * (u.traits & Trait.Greedy ? 0.7 : 1);
          if (u.carry === Res.Food) v.food += amt;
          else if (u.carry === Res.Wood) v.wood += amt;
          else if (u.carry === Res.Stone) v.stone += amt;
          else if (u.carry === Res.Gold) v.gold += amt;
          sim.fx.push({ t: 'deliver', x: u.x, z: u.z, a: u.carry, u: u.id });
        }
        u.carry = Res.None; u.carryAmt = 0; u.task = null; u.think = 0;
      }
      break;
    }
    case 'eat': {
      const tgt = deliverTarget(sim, u);
      const v = villageOf(sim, u);
      if (!tgt || !v) { u.task = null; break; }
      if (moveTo(sim, u, tgt[0], tgt[1], 0.9)) {
        if (v.food >= 1) { v.food -= 1; u.hunger = 0; u.anim = Anim.Eat; u.animT = 15; sim.emote(u, Emote.Food, 15); }
        u.task = { k: 'idle', t: 15 };
      }
      break;
    }
    case 'build': {
      const b = sim.buildings.get(t.b);
      if (!b || !b.alive || b.progress >= 1) { u.task = null; u.think = 0; break; }
      const cx = b.x + b.size / 2, cz = b.z + b.size / 2;
      // stand right against the footprint (tools touch the wall)
      if (t.sx === undefined || t.sz === undefined) { [t.sx, t.sz] = standAtBuilding(sim, b, u, 3); }
      if (moveTo(sim, u, t.sx, t.sz!, 0.12)) {
        face(u, cx, cz);
        u.anim = Anim.Work;
        const def = BUILDINGS[b.kind];
        const bs = SPECIES[u.sp].buildSpeed * (u.traits & Trait.Wise ? 1.2 : 1) * workRate(u);
        const before = b.progress;
        b.progress = Math.min(1, b.progress + (bs * TICK_DT) / def.work);
        if (before < 0.15 && b.progress >= 0.15) {
          // walls go up: the footprint becomes solid
          w.navVersion++;
          sim.near(b.x + b.size / 2, b.z + b.size / 2, b.size + 1, (o) => resolveInside(sim, o));
        }
        b.hp = Math.max(b.hp, b.maxHp * b.progress);
        if (sim.tick % 6 === u.id % 6) sim.fx.push({ t: 'hammer', x: u.x, z: u.z, u: u.id, tx: cx, tz: cz });
        if (b.progress >= 1) {
          b.hp = b.maxHp;
          sim.fx.push({ t: 'built', x: cx, z: cz, a: b.kind, b: b.size });
          if (b.kind === Bk.Farm) {
            for (let dz = 0; dz < b.size; dz++) for (let dx = 0; dx < b.size; dx++) {
              const tt = w.idx(b.x + dx, b.z + dz);
              w.setFeat(tt, Feat.Crop, 30);
            }
          }
          u.task = null; u.think = 0;
          sim.emote(u, Emote.Star, 15);
        }
      }
      break;
    }
    case 'farm': {
      const b = sim.buildings.get(t.b);
      if (!b || !b.alive) { u.task = null; break; }
      const tx = (t.tile % w.W) + 0.5, tz = ((t.tile / w.W) | 0) + 0.5;
      if (moveTo(sim, u, tx, tz, 0.45)) {
        u.anim = Anim.Work;
        t.work += workRate(u);
        if (t.work >= 25) {
          if (w.feat[t.tile] === Feat.Crop && w.featAmt[t.tile] >= 230) {
            w.featAmt[t.tile] = 10; w.markFeatTile(t.tile);
            u.carry = Res.Food; u.carryAmt = 4;
            sim.fx.push({ t: 'harvest', x: tx, z: tz, u: u.id });
            setTask(sim, u, { k: 'deliver' });
          } else if (w.feat[t.tile] !== Feat.Crop) {
            w.setFeat(t.tile, Feat.Crop, 10);
            u.task = null;
          } else {
            // tend: speeds growth
            w.featAmt[t.tile] = Math.min(255, w.featAmt[t.tile] + 25); w.markFeatTile(t.tile);
            u.task = null;
          }
          releaseClaim(t.tile);
        }
      }
      break;
    }
    case 'attack': runAttack(sim, u, t.u, false); break;
    case 'hunt': runAttack(sim, u, t.u, true); break;
    case 'raze': {
      const b = sim.buildings.get(t.b);
      if (!b || !b.alive) { u.task = null; u.think = 0; break; }
      const cx = b.x + b.size / 2, cz = b.z + b.size / 2;
      if (t.sx === undefined || t.sz === undefined) { [t.sx, t.sz] = standAtBuilding(sim, b, u, 3); }
      const ex = t.sx, ez = t.sz!;
      if (moveTo(sim, u, ex, ez, 0.2)) {
        face(u, cx, cz);
        if (u.cd <= 0) {
          u.anim = Anim.Attack; u.animT = 6;
          u.cd = Math.round(SPECIES[u.sp].attackRate * 10);
          const bv = sim.villages.get(b.village);
          sim.damageBuilding(b, SPECIES[u.sp].dmg * u.dmgMul * (u.job === Job.Warrior ? 2.4 : u.sp === Sp.Troll ? 3 : 1), u);
          if (!b.alive && bv && isCiv(u.sp) && (b.kind === Bk.Storage || b.kind === Bk.TownHall)) loot(sim, u, bv);
          if (u.sp === Sp.Troll) sim.fx.push({ t: 'quakelet', x: ex, z: ez });
          sim.fx.push({ t: 'bhit', x: ex, z: ez, u: u.id, tx: cx, tz: cz });
          if (sim.rng.chance(0.07) && b.fire === 0) { b.fire = 160; sim.fx.push({ t: 'ignite', x: cx, z: cz }); }
        }
      }
      break;
    }
    case 'graze': {
      u.anim = Anim.Eat;
      const tt = w.tileAt(u.x, u.z);
      if (++t.work > 30) {
        if (tt >= 0 && w.grass[tt] > 20) { w.grass[tt] = Math.max(0, w.grass[tt] - 70); u.hunger = Math.max(0, u.hunger - 60); }
        u.task = null; u.think = 0;
      }
      break;
    }
    case 'march': {
      const v = sim.villages.get(t.v);
      if (!v || !v.alive) { u.task = null; u.think = 0; break; }
      const k = sim.kingdoms.get(u.kingdom);
      if (!k || !k.wars.includes(v.kingdom)) { u.task = null; u.think = 0; break; }
      if (moveTo(sim, u, v.cx + 0.5 + Math.cos(u.look) * 2, v.cz + 0.5 + Math.sin(u.look) * 2, 4)) {
        // at the target: go for the town hall first (capture), otherwise the nearest building
        const hall = sim.buildings.get(v.hall);
        let bid: number | undefined = hall && hall.alive && sim.rng.chance(0.65) ? hall.id : undefined;
        if (bid === undefined) {
          let bd = 1e9;
          for (const id of v.buildings) { const b = sim.buildings.get(id); if (!b || !b.alive || b.kind === Bk.Farm) continue; const d = (b.x - u.x) ** 2 + (b.z - u.z) ** 2; if (d < bd) { bd = d; bid = id; } }
        }
        if (bid !== undefined) setTask(sim, u, { k: 'raze', b: bid });
        else u.task = null;
      }
      break;
    }
    case 'love':
    case 'chat': {
      const o = sim.getUnit(t.u);
      if (!o) { u.task = null; break; }
      if (Math.hypot(o.x - u.x, o.z - u.z) > 0.9) moveTo(sim, u, o.x, o.z, 0.8, 0.7);
      else { face(u, o.x, o.z); u.anim = Anim.Idle; u.social = Math.min(100, u.social + 1.2); }
      if (--t.t <= 0) {
        if (u.id < o.id && Math.hypot(o.x - u.x, o.z - u.z) < 1.4) socialise(sim, u, o);
        u.task = null; u.think = 0;
      }
      break;
    }
    case 'sleep': {
      const v = villageOf(sim, u);
      if (t.sx === undefined || t.sz === undefined) {
        // head home: the nearest finished house, otherwise the hall, otherwise right here
        let home: { x: number; z: number; size: number } | undefined;
        let bd = 1e9;
        if (v) for (const id of v.buildings) { const b = sim.buildings.get(id); if (!b || !b.alive || b.progress < 1 || (b.kind !== Bk.House && b.kind !== Bk.TownHall)) continue; const d = (b.x - u.x) ** 2 + (b.z - u.z) ** 2; if (d < bd) { bd = d; home = b; } }
        [t.sx, t.sz] = home ? standAtBuilding(sim, home, u, 2) : [u.x, u.z];
      }
      if (moveTo(sim, u, t.sx, t.sz!, 0.25)) {
        u.anim = Anim.Sleep;
        if (sim.tick % 40 === u.id % 40) sim.emote(u, Emote.Zzz, 30);
        if (--t.t <= 0 || u.energy >= 96) { u.task = null; u.think = 0; u.anim = Anim.Idle; }
      }
      break;
    }
    case 'dance':
      u.anim = Anim.Cheer;
      u.dir += 0.12;
      u.social = Math.min(100, u.social + 0.8);
      if (--t.t <= 0) { u.task = null; u.think = 0; }
      break;
    case 'post': runPost(sim, u, t, moveTo, workRate); break;
    case 'arrest': runArrest(sim, u, t, moveTo); break;
    case 'escort': runEscort(sim, u, t, moveTo); break;
    case 'trade': runTrade(sim, u, t, moveTo); break;
    case 'escorted': case 'jailed': case 'voyage': break;
    case 'board': {
      const boat = sim.getUnit(t.boat);
      const dock = boat && sim.buildings.get(boat.home);
      if (!boat || !dock || boat.task?.k !== 'voyage' || boat.task.phase !== 0) { u.task = null; u.think = 0; break; }
      if (Math.hypot(boat.x - u.x, boat.z - u.z) < 2.2) { u.flags |= UF.Aboard; break; }
      const [sx, sz] = standAtBuilding(sim, dock, u, 1);
      if (moveTo(sim, u, sx, sz, 0.5)) { u.flags |= UF.Aboard; sim.fx.push({ t: 'splash', x: boat.x, z: boat.z }); }
      break;
    }
    case 'steal': {
      const v = sim.villages.get(t.v);
      const tgt = deliverTarget(sim, u);
      if (!v || !tgt) { u.task = null; break; }
      if (t.sx === undefined) { t.sx = tgt[0]; t.sz = tgt[1]; }
      if (moveTo(sim, u, t.sx, t.sz!, 0.5)) {
        const took = Math.min(v.food, 2 + sim.rng.int(0, 3));
        v.food -= took; u.hunger = 0; u.crimes++;
        addWanted(sim, v, u);
        sim.emote(u, Emote.Food, 20);
        sim.fx.push({ t: 'crime', x: u.x, z: u.z, u: u.id });
        // the neighbours notice
        sim.near(u.x, u.z, 5, (o) => { if (o !== u && o.village === v.id) { sim.emote(o, Emote.Angry, 20); remember(sim, o, Mem.Robbed, -4, 0.3); if (sim.rng.chance(0.3)) o.rival = u.id; } });
        u.task = { k: 'flee', tx: u.x + sim.rng.range(-6, 6), tz: u.z + sim.rng.range(-6, 6) };
      }
      break;
    }
  }
}

function runGather(sim: Sim, u: Unit, t: Extract<Task, { k: 'gather' }>) {
  const w = sim.world;
  const f = w.feat[t.tile];
  const quarry = t.res === Res.Stone && f === Feat.None && w.mat[t.tile] === Mat.Rock;
  const ok = t.res === Res.Wood ? isWoodTree(f) || f === Feat.Dead : t.res === Res.Food ? f === Feat.Berry : t.res === Res.Stone ? f === Feat.Boulder || quarry : f === Feat.Ore;
  if (!ok) { releaseClaim(t.tile); u.task = null; u.think = 0; return; }
  if (t.sx === undefined || t.sz === undefined) {
    if (quarry) { const nf = nearestFree(w, (t.tile % w.W) + 0.5, ((t.tile / w.W) | 0) + 0.5, 2); [t.sx, t.sz] = nf ?? [u.x, u.z]; }
    else [t.sx, t.sz] = standAtFeature(sim, u, t.tile);
  }
  if (!moveTo(sim, u, t.sx, t.sz!, 0.08)) return;
  const [tx, tz] = quarry ? [(t.tile % w.W) + 0.5, ((t.tile / w.W) | 0) + 0.5] : featureOffset(t.tile % w.W, (t.tile / w.W) | 0, f);
  face(u, tx, tz);
  u.anim = Anim.Work;
  t.work += workRate(u);
  const workT = t.res === Res.Food ? 22 : t.res === Res.Wood ? 34 : 44;
  if (Math.floor(t.work) % 8 === 0 && Math.floor(t.work) !== Math.floor(t.work - workRate(u))) sim.fx.push({ t: t.res === Res.Wood ? 'chop' : t.res === Res.Food ? 'pick' : 'mine', x: tx, z: tz, u: u.id });
  if (t.work >= workT) {
    let amt = 0;
    if (t.res === Res.Wood) {
      amt = 3;
      const left = w.featAmt[t.tile] - 85;
      if (left <= 0) { w.setFeat(t.tile, Feat.None, 0); sim.fx.push({ t: 'treefall', x: tx, z: tz, a: f, b: u.dir }); }
      else { w.featAmt[t.tile] = left; w.markFeatTile(t.tile); }
    } else if (t.res === Res.Food) {
      amt = 3;
      const left = w.featAmt[t.tile] - 60;
      if (left <= 0) w.setFeat(t.tile, Feat.None, 0); else { w.featAmt[t.tile] = left; w.markFeatTile(t.tile); }
      if (u.hunger > 60) { u.hunger = 10; amt = 1; }
    } else if (quarry) {
      amt = u.sp === Sp.Dwarf ? 4 : 3;
    } else {
      amt = t.res === Res.Gold ? (u.sp === Sp.Dwarf ? 2 : 1) : u.sp === Sp.Dwarf ? 5 : 4;
      const left = w.featAmt[t.tile] - 40;
      if (left <= 0) { w.setFeat(t.tile, Feat.None, 0); sim.fx.push({ t: 'rockbreak', x: tx, z: tz }); }
      else { w.featAmt[t.tile] = left; w.markFeatTile(t.tile); }
    }
    releaseClaim(t.tile);
    u.carry = t.res; u.carryAmt = amt;
    setTask(sim, u, { k: 'deliver' });
  }
}

function runAttack(sim: Sim, u: Unit, targetId: number, hunting: boolean) {
  const o = sim.getUnit(targetId);
  if (!o || o.flags & UF.Held) { u.task = null; u.think = 0; return; }
  const def = SPECIES[u.sp];
  const d = Math.hypot(o.x - u.x, o.z - u.z);
  if (o.sp === Sp.Fish && hunting) {
    // fishing from the shore: a quick swipe or net when close enough
    if (d <= 2.2) {
      face(u, o.x, o.z); u.anim = Anim.Attack; u.animT = 6;
      sim.fx.push({ t: 'fish', x: o.x, z: o.z, u: u.id });
      sim.killUnit(o, 'eaten', u);
      u.hunger = Math.max(0, u.hunger - 45);
      if (isCiv(u.sp)) { u.carry = Res.Food; u.carryAmt = 3; setTask(sim, u, { k: 'deliver' }); } else { u.task = null; u.think = 0; }
      return;
    }
    if (++u.stuck > 60) { u.task = null; u.think = 0; u.stuck = 0; return; }
    moveTo(sim, u, o.x, o.z, 2.0, 1);
    return;
  }
  const gun = u.item === 12 || u.item === 13;
  const ranged = (u.item === 5 || gun) && d > 1.2; // bow, musket, rifle
  const reach = ranged ? (u.item === 13 ? 9 : u.item === 12 ? 7 : 6) : def.range * (0.8 + 0.2 * def.size);
  if (o.y > 1 && !ranged) { u.task = null; u.think = 0; return; }
  if (d > 16) { u.task = null; u.think = 0; return; }
  if (d > reach) {
    // give up on targets we cannot reach
    if (++u.stuck > 90) { u.task = null; u.think = 0; u.stuck = 0; return; }
    // chase directly when close, path when far
    let blocked = false;
    if (d < 3 && !u.path) {
      const sp = def.speed * u.speedMul * TICK_DT * (hunting ? 1.3 : 1.05);
      if (stepToward(sim.world, u, o.x, o.z, sp, false) <= 1e-5) blocked = true;
      else { face(u, o.x, o.z); u.anim = Anim.Walk; }
    }
    if (d >= 3 || blocked || u.path) {
      if (u.path && sim.tick % 15 === u.id % 15) u.path = null; // re-path toward moving target
      moveTo(sim, u, o.x, o.z, reach * 0.9, hunting && d < 5 ? 1.3 : 1.05);
    }
    return;
  }
  face(u, o.x, o.z);
  u.stuck = 0;
  if (u.cd > 0) { if (u.anim !== Anim.Attack || u.animT <= 0) u.anim = Anim.Idle; return; }
  u.anim = Anim.Attack; u.animT = 6;
  u.cd = Math.round(def.attackRate * 10 * (u.flags & UF.Hero ? 0.8 : 1) * (gun ? 1.6 : 1));
  const dmg = def.dmg * u.dmgMul * sim.rng.range(0.75, 1.25) * (u.age < def.adultAge ? 0.4 : 1) * (u.item === 13 ? 2.4 : u.item === 12 ? 1.8 : 1);
  if (ranged) {
    sim.fx.push({ t: gun ? 'shot' : 'arrow', x: u.x, z: u.z, tx: o.x, tz: o.z, u: u.id, y: o.y });
    const oid = o.id;
    setTimeout0(sim, Math.max(2, Math.round(d * 1.2)), () => { const tgt = sim.getUnit(oid); if (tgt) hurt(sim, tgt, dmg, sim.getUnit(u.id), 'attack'); });
  } else {
    sim.fx.push({ t: 'hit', x: o.x, z: o.z, u: o.id, a: u.sp, tx: u.x, tz: u.z });
    // knockback
    const kb = 0.12 * def.size;
    const nx = o.x + ((o.x - u.x) / (d || 1)) * kb, nz = o.z + ((o.z - u.z) / (d || 1)) * kb;
    const nt = sim.world.tileAt(nx, nz);
    if (free(sim.world, nt)) { o.x = nx; o.z = nz; } // knockback never shoves anyone into a wall
    hurt(sim, o, dmg, u, 'attack');
  }
  if (o.flags & UF.Dead) {
    if (hunting || (!isCiv(u.sp) && !SPECIES[u.sp].undead && eats(u.sp, o.sp, true))) u.hunger = Math.max(0, u.hunger - 70);
    if (isCiv(u.sp) && !isCiv(o.sp) && !SPECIES[o.sp].undead) { u.carry = Res.Food; u.carryAmt = 5; setTask(sim, u, { k: 'deliver' }); return; }
    if (isCiv(u.sp) && sim.rng.chance(0.3)) sim.emote(u, Emote.Swords, 18);
    u.task = null; u.think = 0;
  } else if (!(o.task?.k === 'attack' && o.task.u === u.id) && !(o.flags & (UF.Ragdoll))) {
    // retaliate or flee is decided by the victim's next think
    if (o.think > 2) o.think = 2;
  }
}
