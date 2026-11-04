import { Sim, setTimeout0 } from './sim';
import { Unit, Village, Kingdom, Building, Task, Job, Emote, UF, Res } from './entities';
import { SPECIES, Sp, Bk, BUILDINGS, Feat, Mat, isCiv, isWoodTree, Trait, KINGDOM_COLORS, YEAR_TICKS } from './defs';
import { kingdomName, villageName } from './names';
import { findFeature, setTask } from './ai';
import { hash2 } from '../core/rng';

export function villageOf(sim: Sim, u: Unit): Village | undefined {
  if (u.village < 0) return undefined;
  const v = sim.villages.get(u.village);
  return v && v.alive ? v : undefined;
}

const RACE_AFFINITY = (a: Sp, b: Sp): number => {
  if (a === b) return 15;
  const k = [a, b].sort().join('-');
  const t: Record<string, number> = { '0-1': 5, '0-2': 5, '0-3': -15, '1-2': -5, '1-3': -35, '2-3': -25 };
  return t[k] ?? 0;
};

// ------------------------------------------------------------------ sites & buildings

function siteOk(sim: Sim, x: number, z: number, size: number, vid: number, margin: number, flatTol = 1.1): boolean {
  const w = sim.world;
  if (x - margin < 1 || z - margin < 1 || x + size + margin >= w.W - 1 || z + size + margin >= w.H - 1) return false;
  let hmin = Infinity, hmax = -Infinity;
  // keep clear of shorelines / rivers
  for (let dz = -margin - 1; dz < size + margin + 1; dz++) for (let dx = -margin - 1; dx < size + margin + 1; dx++) {
    const t = w.idx(x + dx, z + dz);
    if (w.water[t] > w.height[t] - 0.25) return false;
  }
  for (let dz = -margin; dz < size + margin; dz++) for (let dx = -margin; dx < size + margin; dx++) {
    const t = w.idx(x + dx, z + dz);
    const inner = dx >= 0 && dz >= 0 && dx < size && dz < size;
    if (w.bld[t] >= 0) {
      const b = sim.buildings.get(w.bld[t]);
      if (inner || !(b && (b.kind === Bk.Ruin))) return false;
    }
    if (!inner) continue;
    if (!w.walkable(t)) return false;
    const o = w.owner[t];
    if (o >= 0 && o !== vid) return false;
    const f = w.feat[t];
    if (f === Feat.Boulder || f === Feat.Ore) return false;
    const h = w.height[t];
    if (h < hmin) hmin = h; if (h > hmax) hmax = h;
    if (w.mat[t] === Mat.Lava || w.mat[t] === Mat.Swamp) return false;
  }
  return hmax - hmin <= flatTol;
}

export function placeBuilding(sim: Sim, v: Village | null, kind: Bk, x: number, z: number, race: Sp, progress = 0): Building {
  const def = BUILDINGS[kind];
  const w = sim.world;
  const b: Building = {
    id: sim.id(), kind, race, village: v ? v.id : -1, x, z, size: def.size, rot: sim.rng.int(0, 3),
    progress, hp: Math.max(1, def.hp * progress), maxHp: def.hp, fire: 0, level: kind === Bk.TownHall ? 0 : 1, alive: true, born: sim.tick, look: sim.rng.int(0, 9999),
  };
  // orient the door toward the village centre
  if (v && kind !== Bk.TownHall) {
    const dx = v.cx + 0.5 - (x + def.size / 2), dz = v.cz + 0.5 - (z + def.size / 2);
    b.rot = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 0 : 2);
  }
  // flatten ground under the footprint (buildings sit on neat pads)
  let sum = 0, n = 0;
  for (let dz = 0; dz < def.size; dz++) for (let dx = 0; dx < def.size; dx++) { sum += w.height[w.idx(x + dx, z + dz)]; n++; }
  const avg = Math.max(sum / n, 0.25);
  for (let dz = -1; dz <= def.size; dz++) for (let dx = -1; dx <= def.size; dx++) {
    if (!w.inside(x + dx, z + dz)) continue;
    const t = w.idx(x + dx, z + dz);
    const inner = dx >= 0 && dz >= 0 && dx < def.size && dz < def.size;
    if (inner) {
      w.height[t] = avg;
      if (w.feat[t] !== Feat.None) w.setFeat(t, Feat.None, 0);
      w.bld[t] = b.id;
      if (kind === Bk.Farm) w.mat[t] = Mat.Farmland;
      else if (w.mat[t] !== Mat.Sand) w.mat[t] = Mat.Soil;
    } else if (w.bld[t] < 0) w.height[t] = w.height[t] * 0.5 + avg * 0.5;
  }
  w.markTerrain(x - 2, z - 2, x + def.size + 2, z + def.size + 2);
  sim.buildings.set(b.id, b);
  if (v) v.buildings.push(b.id);
  sim.fx.push({ t: 'placed', x: x + def.size / 2, z: z + def.size / 2, a: kind, b: def.size });
  return b;
}

function findSite(sim: Sim, v: Village, kind: Bk): [number, number] | null {
  const size = BUILDINGS[kind].size;
  const margin = kind === Bk.Farm ? 0 : 1;
  const R = Math.max(4, v.radius - 1);
  let best: [number, number] | null = null, bs = -1e9;
  const tries = 70;
  for (let i = 0; i < tries; i++) {
    const a = sim.rng.range(0, Math.PI * 2);
    const minR = kind === Bk.Farm ? Math.min(R - 1, 4 + v.level) : kind === Bk.Tower ? R * 0.7 : 2.5;
    const d = sim.rng.range(minR, R);
    const x = Math.round(v.cx + 0.5 + Math.cos(a) * d - size / 2), z = Math.round(v.cz + 0.5 + Math.sin(a) * d - size / 2);
    if (!siteOk(sim, x, z, size, v.id, margin)) continue;
    let score = -d * (kind === Bk.Farm ? 0.3 : 1) + sim.rng.next() * 2;
    const w = sim.world;
    if (kind === Bk.Farm) {
      const m = w.mat[w.idx(x + 1, z + 1)];
      score += m === Mat.Grass || m === Mat.Lush ? 3 : m === Mat.Savanna ? 1 : -2;
    }
    // avoid clear-cutting: prefer open ground
    for (let dz = 0; dz < size; dz++) for (let dx = 0; dx < size; dx++) if (isWoodTree(w.feat[w.idx(x + dx, z + dz)])) score -= 0.6;
    if (score > bs) { bs = score; best = [x, z]; }
  }
  return best;
}

export function deliverTarget(sim: Sim, u: Unit): [number, number] | null {
  const v = villageOf(sim, u);
  if (!v) return null;
  let best: Building | null = null, bd = 1e9;
  for (const id of v.buildings) {
    const b = sim.buildings.get(id);
    if (!b || !b.alive || b.progress < 1) continue;
    if (b.kind !== Bk.TownHall && b.kind !== Bk.Storage) continue;
    const d = (b.x + b.size / 2 - u.x) ** 2 + (b.z + b.size / 2 - u.z) ** 2;
    if (d < bd) { bd = d; best = b; }
  }
  if (!best) {
    const hall = sim.buildings.get(v.hall);
    if (hall && hall.alive) best = hall; else return [v.cx + 0.5, v.cz + 0.5];
  }
  const cx = best.x + best.size / 2, cz = best.z + best.size / 2;
  const dx = u.x - cx, dz = u.z - cz;
  const l = Math.hypot(dx, dz) || 1;
  const r = best.size / 2 + 0.45;
  return [cx + (dx / l) * r, cz + (dz / l) * r];
}

// ------------------------------------------------------------------ founding / joining

export function joinVillage(sim: Sim, u: Unit): boolean {
  let best: Village | null = null, bd = 30 * 30;
  if (sim.world.islandsDirty) sim.world.computeIslands();
  const isl = sim.world.island[sim.world.tileAt(u.x, u.z)];
  for (const v of sim.villages.values()) {
    if (!v.alive || v.race !== u.sp) continue;
    if (u.kingdom >= 0 && v.kingdom !== u.kingdom && !(u.flags & UF.Settler)) continue;
    if (u.flags & UF.Settler) continue;
    const d = (v.cx - u.x) ** 2 + (v.cz - u.z) ** 2;
    if (d < bd && sim.world.island[sim.world.idx(v.cx, v.cz)] === isl) { bd = d; best = v; }
  }
  if (!best) return false;
  addResident(sim, best, u);
  return true;
}

export function addResident(sim: Sim, v: Village, u: Unit) {
  const old = sim.villages.get(u.village);
  if (old) { const i = old.residents.indexOf(u.id); if (i >= 0) old.residents.splice(i, 1); }
  u.village = v.id;
  u.kingdom = v.kingdom;
  u.flags &= ~UF.Settler;
  if (!v.residents.includes(u.id)) v.residents.push(u.id);
}

function pickColor(sim: Sim): number {
  const free: number[] = [];
  const used = new Set<number>();
  for (const k of sim.kingdoms.values()) if (k.alive) used.add(k.color);
  for (let i = 0; i < KINGDOM_COLORS.length; i++) if (!used.has(i)) free.push(i);
  return free.length ? sim.rng.pick(free) : sim.rng.int(0, KINGDOM_COLORS.length - 1);
}

export function createKingdom(sim: Sim, race: Sp, rebelOf = -1): Kingdom {
  const k: Kingdom = {
    id: sim.id(), name: kingdomName(sim.rng, race), race, color: pickColor(sim),
    banner: { symbol: sim.rng.int(0, 11), pattern: sim.rng.int(0, 5), c1: 0, c2: 0 },
    capital: -1, king: -1, villages: [], opinion: {}, wars: [], allies: [], warStart: {}, peaceT: {},
    founded: sim.tick, alive: true, target: -1, kills: 0, deaths: 0, aggression: 0.5, rebelOf,
  };
  k.banner.c1 = k.color;
  k.banner.c2 = sim.rng.int(0, KINGDOM_COLORS.length - 1);
  sim.kingdoms.set(k.id, k);
  return k;
}

export function tryFoundVillage(sim: Sim, u: Unit, settling = false): boolean {
  const w = sim.world;
  // keep a distance from other villages
  for (const v of sim.villages.values()) if (v.alive && (v.cx - u.x) ** 2 + (v.cz - u.z) ** 2 < 13 * 13) {
    if (v.race === u.sp && (u.kingdom < 0 || v.kingdom === u.kingdom)) { addResident(sim, v, u); return true; }
    return false;
  }
  let site: [number, number] | null = null;
  for (let r = 0; r < 9 && !site; r++) {
    for (let i = 0; i < 10 && !site; i++) {
      const a = sim.rng.range(0, Math.PI * 2);
      const x = Math.round(u.x + Math.cos(a) * r - 1.5), z = Math.round(u.z + Math.sin(a) * r - 1.5);
      if (siteOk(sim, x, z, 3, -1, 1, 1.4)) site = [x, z];
    }
  }
  if (!site) return false;
  let k = sim.kingdoms.get(u.kingdom);
  const newKingdom = !k || !k.alive;
  if (newKingdom) k = createKingdom(sim, u.sp);
  const v: Village = {
    id: sim.id(), name: villageName(sim.rng, u.sp), kingdom: k!.id, race: u.sp,
    cx: site[0] + 1, cz: site[1] + 1, buildings: [], residents: [], food: 14, wood: 16, stone: 0, gold: 0,
    level: 0, radius: 6, loyalty: 100, happiness: 60, planT: 0, founded: sim.tick, alive: true, hall: -1,
    rallyT: 0, captureT: 0, blessT: 0, lastAttacked: -9999,
  };
  sim.villages.set(v.id, v);
  k!.villages.push(v.id);
  if (k!.capital < 0) k!.capital = v.id;
  const hall = placeBuilding(sim, v, Bk.TownHall, site[0], site[1], u.sp, 1);
  hall.level = 0;
  v.hall = hall.id;
  addResident(sim, v, u);
  // gather nearby homeless kin / fellow settlers
  sim.near(u.x, u.z, 10, (o) => {
    if (o !== u && o.sp === u.sp && (o.village < 0) && (o.kingdom < 0 || o.kingdom === k!.id)) { addResident(sim, v, o); if (o.task?.k === 'settle') o.task = null; }
  });
  claimTerritory(sim, v);
  sim.fx.push({ t: 'found', x: v.cx + 0.5, z: v.cz + 0.5, a: k!.id });
  if (newKingdom) {
    if (k!.king < 0) crown(sim, k!, u);
    sim.log('kingdomFounded', { a: k!.id, v: v.id, x: v.cx, z: v.cz, text: k!.name });
  } else sim.log('villageFounded', { a: k!.id, v: v.id, x: v.cx, z: v.cz, text: v.name });
  return true;
}

function crown(sim: Sim, k: Kingdom, u: Unit) {
  const old = sim.getUnit(k.king);
  if (old) old.flags &= ~UF.King;
  k.king = u.id;
  u.flags |= UF.King;
  sim.emote(u, Emote.Crown, 50);
  const b = u.traits;
  k.aggression = 0.5 + (b & Trait.Bloodlust ? 0.35 : 0) + (b & Trait.Brave ? 0.1 : 0) - (b & Trait.Peaceful ? 0.35 : 0) - (b & Trait.Wise ? 0.1 : 0) + (u.sp === Sp.Orc ? 0.2 : u.sp === Sp.Elf ? -0.1 : 0);
}

export function claimTerritory(sim: Sim, v: Village) {
  const w = sim.world;
  const R = Math.ceil(v.radius + 3);
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const x = v.cx + dx, z = v.cz + dz;
    if (!w.inside(x, z)) continue;
    const t = w.idx(x, z);
    const n = hash2(x, z, v.id) * 0.35 + 0.82;
    const inside = Math.hypot(dx, dz) <= v.radius * n && w.height[t] > -0.4;
    if (inside && w.owner[t] < 0) w.owner[t] = v.id;
    else if (!inside && w.owner[t] === v.id) w.owner[t] = -1;
  }
  w.ownerDirty = true;
}

function releaseTerritory(sim: Sim, v: Village) {
  const w = sim.world;
  const R = Math.ceil(v.radius + 4);
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const x = v.cx + dx, z = v.cz + dz;
    if (!w.inside(x, z)) continue;
    const t = w.idx(x, z);
    if (w.owner[t] === v.id) w.owner[t] = -1;
  }
  w.ownerDirty = true;
}

// ------------------------------------------------------------------ village AI

export function villageThink(sim: Sim, v: Village) {
  // clean residents
  v.residents = v.residents.filter((id) => { const u = sim.getUnit(id); return !!u && u.village === v.id; });
  const k = sim.kingdoms.get(v.kingdom);
  if (v.residents.length === 0) {
    if (sim.tick - v.founded > 100) destroyVillage(sim, v);
    return;
  }
  const res = v.residents.map((id) => sim.unitMap.get(id)!);
  const def = SPECIES[v.race];
  const adults = res.filter((u) => u.age >= def.adultAge);
  const pop = res.length;
  let housing = 0, pending = 0, farms = 0;
  const counts = new Array(8).fill(0);
  for (const id of v.buildings) {
    const b = sim.buildings.get(id);
    if (!b || !b.alive) continue;
    counts[b.kind]++;
    if (b.progress < 1) { pending++; continue; }
    if (b.kind === Bk.Farm) farms++;
    housing += BUILDINGS[b.kind].housing + (b.kind === Bk.TownHall ? b.level * 2 : 0);
  }
  const hall = sim.buildings.get(v.hall);
  if (!hall || !hall.alive) {
    const site = findSite(sim, v, Bk.TownHall) ?? (siteOk(sim, v.cx - 1, v.cz - 1, 3, v.id, 0) ? [v.cx - 1, v.cz - 1] as [number, number] : null);
    if (site) { const h = placeBuilding(sim, v, Bk.TownHall, site[0], site[1], v.race, 0.05); h.level = Math.max(0, v.level - 1); v.hall = h.id; }
  }

  // level & territory
  const lv = pop >= 32 ? 3 : pop >= 18 ? 2 : pop >= 8 ? 1 : 0;
  const stoneNeed = lv <= 1 ? 0 : lv === 2 ? 10 : 30;
  if (hall && hall.alive && hall.progress >= 1 && lv > hall.level && v.wood >= 15 + lv * 10 && v.stone >= stoneNeed) {
    v.wood -= 15 + lv * 10; v.stone -= stoneNeed;
    hall.level = lv; hall.progress = 0.4; hall.maxHp = BUILDINGS[Bk.TownHall].hp * (1 + lv * 0.5);
    v.level = lv;
    sim.fx.push({ t: 'upgrade', x: hall.x + 1.5, z: hall.z + 1.5, a: lv });
    if (lv >= 2) sim.log('villageGrew', { a: v.kingdom, v: v.id, x: v.cx, z: v.cz, text: v.name });
  }
  const R = Math.round(5 + v.level * 1.6 + Math.min(7, Math.sqrt(pop) * 1.1));
  if (R !== v.radius) { v.radius = R; claimTerritory(sim, v); }

  const atWar = !!k && k.wars.length > 0;
  // births
  if (sim.laws.births && pop < housing && v.food >= 4 && adults.length >= 2) {
    const fert = def.fertility * (adults.some((a) => a.traits & Trait.Fertile) ? 1.3 : 1) * (v.blessT > sim.tick ? 1.6 : 1);
    if (sim.rng.chance(0.2 * fert * Math.min(1.4, v.food / 18))) {
      const mom = sim.rng.pick(adults.filter((a) => a.female) as Unit[]) as Unit | undefined;
      const dad = sim.rng.pick(adults.filter((a) => !a.female) as Unit[]) as Unit | undefined;
      if (mom && dad) {
        sim.emote(mom, Emote.Heart, 30); sim.emote(dad, Emote.Heart, 30);
        const baby = sim.spawnUnit(v.race, mom.x + 0.3, mom.z + 0.3, { age: 0, kingdom: v.kingdom });
        baby.traits |= (mom.traits | dad.traits) & sim.rng.int(0, 0xfff) & ~(Trait.Immortal | Trait.Blessed);
        sim.applyTraits(baby); baby.hp = baby.maxHp;
        addResident(sim, v, baby);
        v.food -= 3;
        sim.stats.births++;
        sim.fx.push({ t: 'birth', x: baby.x, z: baby.z, u: baby.id });
      }
    }
  }

  // jobs
  const nA = adults.length;
  const want: Record<number, number> = {};
  want[Job.Warrior] = atWar ? Math.ceil(nA * 0.4) : nA >= 6 ? Math.max(1, Math.floor(nA * 0.1)) : 0;
  want[Job.Builder] = pending > 0 ? Math.min(pending * 2 + 1, Math.max(1, Math.ceil(nA * 0.3))) : 0;
  want[Job.Farmer] = Math.min(farms * 2, Math.ceil(nA * 0.35));
  const woodNeed = v.wood < 25 + v.level * 12;
  want[Job.Woodcutter] = Math.ceil(nA * (woodNeed ? 0.28 : 0.12));
  want[Job.Miner] = v.level >= 1 && v.stone < 30 + v.level * 10 ? Math.ceil(nA * 0.12) : 0;
  const assigned: Record<number, number> = {};
  for (const u of adults) assigned[u.job] = (assigned[u.job] ?? 0) + 1;
  const order = [Job.Warrior, Job.Builder, Job.Farmer, Job.Woodcutter, Job.Miner];
  for (const u of adults) {
    if (u.flags & UF.King && u.job !== Job.None) { assigned[u.job]--; u.job = Job.None; continue; }
    const cur = u.job;
    if (cur !== Job.None && cur !== Job.Gatherer && (assigned[cur] ?? 0) <= (want[cur] ?? 0)) continue;
    for (const j of order) {
      if ((assigned[j] ?? 0) < (want[j] ?? 0)) {
        if (j === Job.Warrior && u.traits & Trait.Peaceful) continue;
        if (cur !== Job.None) assigned[cur]--;
        u.job = j; assigned[j] = (assigned[j] ?? 0) + 1;
        u.item = jobItem(u);
        break;
      }
    }
    if (u.job === Job.None || ((assigned[u.job] ?? 0) > (want[u.job] ?? 0) + 1)) {
      if (u.job !== Job.None) assigned[u.job]--;
      u.job = Job.Gatherer; assigned[Job.Gatherer] = (assigned[Job.Gatherer] ?? 0) + 1;
      u.item = jobItem(u);
    }
  }

  // construction planning
  if (pending < 1 + Math.floor(pop / 14) && sim.tick >= v.planT) {
    let kind = -1 as Bk;
    if (pop >= housing - 1) kind = Bk.House;
    else if (farms < Math.ceil(pop / 5) && pop >= BUILDINGS[Bk.Farm].minPop) kind = Bk.Farm;
    else if (counts[Bk.Storage] < 1 && pop >= BUILDINGS[Bk.Storage].minPop) kind = Bk.Storage;
    else if (counts[Bk.Windmill] < 1 && farms >= 2 && pop >= BUILDINGS[Bk.Windmill].minPop) kind = Bk.Windmill;
    else if (counts[Bk.Tower] < (atWar ? 3 : 1) + Math.floor(pop / 30) && pop >= BUILDINGS[Bk.Tower].minPop) kind = Bk.Tower;
    else if (counts[Bk.Temple] < 1 && pop >= BUILDINGS[Bk.Temple].minPop) kind = Bk.Temple;
    else if (pop >= housing - 3 && counts[Bk.House] < 14) kind = Bk.House;
    if ((kind as number) >= 0) {
      const c = BUILDINGS[kind].cost;
      if (v.wood >= c.wood && v.stone >= c.stone && v.gold >= c.gold) {
        const site = findSite(sim, v, kind);
        if (site) {
          v.wood -= c.wood; v.stone -= c.stone; v.gold -= c.gold;
          placeBuilding(sim, v, kind, site[0], site[1], v.race, 0.02);
        }
      }
    }
    v.planT = sim.tick + 30;
  }

  // settlers
  // tiny villages merge into a sibling
  if (pop <= 2 && sim.tick - v.founded > YEAR_TICKS * 2) {
    const sib = k?.villages.map((id) => sim.villages.get(id)!).find((o) => o && o !== v && o.alive && o.residents.length > 4 && Math.hypot(o.cx - v.cx, o.cz - v.cz) < 50);
    if (sib) for (const u of res) { addResident(sim, sib, u); setTask(sim, u, { k: 'move', tx: sib.cx + 0.5, tz: sib.cz + 0.5 }); }
  }
  if (!atWar && pop >= 16 + v.level * 5 && v.food > 18 && sim.rng.chance(0.05) && sim.tick - v.founded > YEAR_TICKS) sendSettlers(sim, v, adults);
  // loyalty
  if (k && k.capital !== v.id) {
    const cap = sim.villages.get(k.capital);
    const dist = cap ? Math.hypot(cap.cx - v.cx, cap.cz - v.cz) : 50;
    const king = sim.getUnit(k.king);
    v.loyalty = 92 - dist * 1.35 - k.villages.length * 7 - (atWar ? 15 : 0) + (king ? (king.traits & Trait.Wise ? 15 : 0) - (king.traits & Trait.Greedy ? 10 : 0) : -30) + (v.blessT > sim.tick ? 40 : 0) + Math.min(20, v.food * 0.5);
  } else v.loyalty = 100;
}

function jobItem(u: Unit): number {
  switch (u.job) {
    case Job.Woodcutter: return 1;   // axe
    case Job.Miner: return 2;        // pickaxe
    case Job.Builder: return 3;      // hammer
    case Job.Farmer: return 6;       // hoe
    case Job.Warrior: return u.sp === Sp.Elf ? 5 : u.sp === Sp.Orc ? 7 : u.sp === Sp.Dwarf ? 8 : 4; // bow / cleaver / warhammer / sword
    case Job.Gatherer: return 9;     // basket
    default: return 0;
  }
}

function sendSettlers(sim: Sim, v: Village, adults: Unit[]) {
  const w = sim.world;
  const cands = adults.filter((u) => u.job !== Job.Warrior && !(u.flags & UF.King));
  if (cands.length < 5) return;
  let site: [number, number] | null = null;
  for (let i = 0; i < 40 && !site; i++) {
    const a = sim.rng.range(0, Math.PI * 2), d = sim.rng.range(17, 32);
    const x = Math.round(v.cx + Math.cos(a) * d), z = Math.round(v.cz + Math.sin(a) * d);
    if (!w.inside(x, z)) continue;
    if (w.islandsDirty) w.computeIslands();
    if (w.island[w.idx(x, z)] !== w.island[w.idx(v.cx, v.cz)]) continue;
    let ok = true;
    for (const o of sim.villages.values()) if (o.alive && (o.cx - x) ** 2 + (o.cz - z) ** 2 < 16 * 16) { ok = false; break; }
    if (!ok) continue;
    if (w.owner[w.idx(x, z)] >= 0) continue;
    if (siteOk(sim, x - 1, z - 1, 3, -1, 1, 1.4)) site = [x, z];
  }
  if (!site) return;
  sim.rng.shuffle(cands);
  const n = Math.min(cands.length - 2, sim.rng.int(4, 6));
  for (let i = 0; i < n; i++) {
    const u = cands[i];
    const idx = v.residents.indexOf(u.id); if (idx >= 0) v.residents.splice(idx, 1);
    u.village = -1; u.flags |= UF.Settler; u.job = Job.None; u.item = 0;
    if (u.carryAmt > 0) { u.carry = Res.None; u.carryAmt = 0; }
    setTask(sim, u, { k: 'settle', tx: site[0] + 0.5 + sim.rng.range(-1, 1), tz: site[1] + 0.5 + sim.rng.range(-1, 1) });
  }
  sim.fx.push({ t: 'settlers', x: v.cx, z: v.cz, tx: site[0], tz: site[1] });
}

export function destroyVillage(sim: Sim, v: Village) {
  if (!v.alive) return;
  v.alive = false;
  releaseTerritory(sim, v);
  for (const id of [...v.buildings]) {
    const b = sim.buildings.get(id);
    if (b) b.village = -1;
  }
  const k = sim.kingdoms.get(v.kingdom);
  if (k) {
    k.villages = k.villages.filter((id) => id !== v.id);
    if (k.capital === v.id) k.capital = k.villages[0] ?? -1;
    if (k.villages.length === 0) killKingdom(sim, k);
  }
  for (const id of v.residents) { const u = sim.getUnit(id); if (u) u.village = -1; }
  sim.log('villageLost', { a: v.kingdom, v: v.id, x: v.cx, z: v.cz, text: v.name });
}

function killKingdom(sim: Sim, k: Kingdom) {
  if (!k.alive) return;
  k.alive = false;
  for (const o of sim.kingdoms.values()) { o.wars = o.wars.filter((id) => id !== k.id); o.allies = o.allies.filter((id) => id !== k.id); }
  sim.log('kingdomFell', { a: k.id, text: k.name });
}

export function onBuildingDestroyed(sim: Sim, b: Building) {
  const v = sim.villages.get(b.village);
  if (!v || !v.alive || b.kind !== Bk.TownHall) return;
  // who is standing around? capture by an enemy army
  const counts = new Map<number, number>();
  sim.near(b.x + 1.5, b.z + 1.5, 8, (u) => {
    if (isCiv(u.sp) && u.kingdom >= 0 && u.kingdom !== v.kingdom) counts.set(u.kingdom, (counts.get(u.kingdom) ?? 0) + 1);
  });
  let best = -1, bn = 0;
  for (const [kid, n] of counts) { const kk = sim.kingdoms.get(kid); if (kk && kk.wars.includes(v.kingdom) && n > bn) { bn = n; best = kid; } }
  if (best >= 0) captureVillage(sim, v, sim.kingdoms.get(best)!);
}

export function captureVillage(sim: Sim, v: Village, by: Kingdom) {
  const old = sim.kingdoms.get(v.kingdom);
  if (old) {
    old.villages = old.villages.filter((id) => id !== v.id);
    if (old.capital === v.id) old.capital = old.villages[0] ?? -1;
  }
  v.kingdom = by.id;
  by.villages.push(v.id);
  for (const id of v.residents) {
    const u = sim.getUnit(id);
    if (!u) continue;
    if (u.sp !== by.race && sim.rng.chance(0.5)) { u.village = -1; u.kingdom = -1; continue; }
    u.kingdom = by.id;
    if (u.flags & UF.King) u.flags &= ~UF.King;
  }
  v.loyalty = 30;
  sim.world.ownerDirty = true;
  sim.fx.push({ t: 'capture', x: v.cx + 0.5, z: v.cz + 0.5, a: by.id });
  sim.log('captured', { a: by.id, b: old?.id, v: v.id, x: v.cx, z: v.cz, text: v.name });
  if (old && old.villages.length === 0) killKingdom(sim, old);
}

// ------------------------------------------------------------------ work selection

export function findWork(sim: Sim, u: Unit, v: Village): Task | null {
  const w = sim.world;
  const k = sim.kingdoms.get(u.kingdom);
  switch (u.job) {
    case Job.Warrior: {
      if (k && k.wars.length && k.target >= 0) {
        const tv = sim.villages.get(k.target);
        if (tv && tv.alive && k.wars.includes(tv.kingdom)) {
          const phase = Math.floor((sim.tick + k.id * 31) / 250) % 3;
          if (phase === 0) {
            // muster at the frontier village
            const dx = tv.cx - v.cx, dz = tv.cz - v.cz, l = Math.hypot(dx, dz) || 1;
            return { k: 'rally', tx: v.cx + 0.5 + (dx / l) * (v.radius * 0.8) + sim.rng.range(-1.5, 1.5), tz: v.cz + 0.5 + (dz / l) * (v.radius * 0.8) + sim.rng.range(-1.5, 1.5) };
          }
          return { k: 'march', v: tv.id };
        }
      }
      // patrol the border
      const a = sim.rng.range(0, Math.PI * 2);
      return { k: 'wander', tx: v.cx + 0.5 + Math.cos(a) * v.radius * 0.8, tz: v.cz + 0.5 + Math.sin(a) * v.radius * 0.8 };
    }
    case Job.Builder: {
      let best: Building | null = null, bd = 1e9;
      for (const id of v.buildings) {
        const b = sim.buildings.get(id);
        if (!b || !b.alive || b.progress >= 1) continue;
        const d = (b.x - u.x) ** 2 + (b.z - u.z) ** 2;
        if (d < bd) { bd = d; best = b; }
      }
      if (best) return { k: 'build', b: best.id };
      break;
    }
    case Job.Farmer: {
      const farms = v.buildings.map((id) => sim.buildings.get(id)!).filter((b) => b && b.alive && b.kind === Bk.Farm && b.progress >= 1);
      if (farms.length) {
        const b = farms[u.id % farms.length];
        let ripe = -1, tend = -1;
        for (let dz = 0; dz < b.size; dz++) for (let dx = 0; dx < b.size; dx++) {
          const t = w.idx(b.x + dx, b.z + dz);
          if (claimedFarm.get(t)! > sim.tick) continue;
          if (w.feat[t] === Feat.Crop && w.featAmt[t] >= 230) ripe = t;
          else if (w.featAmt[t] < 200 && sim.rng.chance(0.3)) tend = t;
        }
        const t = ripe >= 0 ? ripe : tend;
        if (t >= 0 && (ripe >= 0 || sim.season !== 3)) { claimedFarm.set(t, sim.tick + 50); return { k: 'farm', b: b.id, tile: t, work: 0 }; }
      }
      break;
    }
    case Job.Miner: {
      const t = findFeature(sim, u.x, u.z, 22, (f) => f === Feat.Boulder || (f === Feat.Ore && v.level >= 1));
      if (t >= 0) return { k: 'gather', tile: t, res: w.feat[t] === Feat.Ore ? Res.Gold : Res.Stone, work: 0 };
      const q = findQuarry(sim, v);
      if (q >= 0) return { k: 'gather', tile: q, res: Res.Stone, work: 0 };
      break;
    }
    case Job.Gatherer: {
      const t = findFeature(sim, u.x, u.z, 14, (f) => f === Feat.Berry);
      if (t >= 0) return { k: 'gather', tile: t, res: Res.Food, work: 0 };
      let prey: Unit | null = null, bd = 13 * 13;
      sim.near(u.x, u.z, 13, (o, d2) => { if ((o.sp === Sp.Sheep || o.sp === Sp.Deer || o.sp === Sp.Chicken) && o.age > 1 && d2 < bd) { bd = d2; prey = o; } });
      if (prey && v.food < 40) return { k: 'hunt', u: (prey as Unit).id };
      break;
    }
  }
  // default: wood
  if ((u.job as Job) !== Job.Warrior) {
    const t = findFeature(sim, u.x, u.z, u.job === Job.Woodcutter ? 34 : 20, (f) => isWoodTree(f) || f === Feat.Dead);
    if (t >= 0 && (v.wood < 80 || u.job === Job.Woodcutter)) return { k: 'gather', tile: t, res: Res.Wood, work: 0 };
    // foresters: replant when the woods are gone (elves love it)
    if (u.job === Job.Woodcutter || (v.race === Sp.Elf && sim.rng.chance(0.3))) {
      for (let i = 0; i < 8; i++) {
        const a = sim.rng.range(0, Math.PI * 2), d = v.radius + sim.rng.range(1, 6);
        const x = Math.floor(v.cx + Math.cos(a) * d), z = Math.floor(v.cz + Math.sin(a) * d);
        if (!w.inside(x, z)) continue;
        const tt = w.idx(x, z);
        if (w.feat[tt] !== Feat.None || w.bld[tt] >= 0 || !w.walkable(tt)) continue;
        const m = w.mat[tt];
        if (m !== Mat.Grass && m !== Mat.Lush && m !== Mat.Savanna && m !== Mat.Soil && m !== Mat.Ash) continue;
        return { k: 'move', tx: x + 0.5, tz: z + 0.5, then: { k: 'idle', t: 12, plant: tt } as Task };
      }
    }
  }
  return null;
}
const claimedFarm = new Map<number, number>();

/** Nearest rock-face tile to quarry (infinite stone, slow). */
function findQuarry(sim: Sim, v: Village): number {
  const w = sim.world;
  let best = -1, bd = 1e9;
  for (let i = 0; i < 60; i++) {
    const a = sim.rng.range(0, Math.PI * 2), d = sim.rng.range(2, 26);
    const x = Math.floor(v.cx + Math.cos(a) * d), z = Math.floor(v.cz + Math.sin(a) * d);
    if (!w.inside(x, z)) continue;
    const t = w.idx(x, z);
    if (w.mat[t] !== Mat.Rock || w.isWater(t) || w.feat[t] !== Feat.None || w.bld[t] >= 0) continue;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

// ------------------------------------------------------------------ kingdoms

export function kingdomThink(sim: Sim, k: Kingdom) {
  k.villages = k.villages.filter((id) => sim.villages.get(id)?.alive);
  if (k.villages.length === 0) { killKingdom(sim, k); return; }
  if (!sim.villages.get(k.capital)?.alive) {
    k.capital = k.villages.reduce((a, b) => (sim.villages.get(a)!.residents.length >= sim.villages.get(b)!.residents.length ? a : b));
  }
  // succession
  const king = sim.getUnit(k.king);
  if (!king || king.kingdom !== k.id) {
    const cap = sim.villages.get(k.capital)!;
    let best: Unit | null = null;
    for (const id of cap.residents) {
      const u = sim.getUnit(id);
      const score = (x: Unit) => x.level * 10 + x.kills - Math.abs(x.age - (SPECIES[x.sp].lifespan[0] * 0.35 + SPECIES[x.sp].adultAge)) * 0.6;
      if (u && u.age >= SPECIES[u.sp].adultAge && u.age < u.maxAge * 0.8 && (!best || score(u) > score(best))) best = u;
    }
    if (best) {
      const wasKing = k.king >= 0;
      crown(sim, k, best);
      if (wasKing || sim.tick - k.founded > 50) sim.log('newKing', { a: k.id, u: best.id, x: best.x, z: best.z, text: best.name });
    }
  }
  // war target: nearest enemy village
  if (k.wars.length) {
    const cap = sim.villages.get(k.capital)!;
    const tv = sim.villages.get(k.target);
    if (!tv || !tv.alive || !k.wars.includes(tv.kingdom)) {
      let best = -1, bd = 1e9;
      for (const ek of k.wars) {
        const e = sim.kingdoms.get(ek);
        if (!e) continue;
        for (const vid of e.villages) {
          const ev = sim.villages.get(vid);
          if (!ev || !ev.alive) continue;
          if (sim.world.island[sim.world.idx(ev.cx, ev.cz)] !== sim.world.island[sim.world.idx(cap.cx, cap.cz)]) continue;
          const d = (ev.cx - cap.cx) ** 2 + (ev.cz - cap.cz) ** 2;
          if (d < bd) { bd = d; best = vid; }
        }
      }
      k.target = best;
    }
  } else k.target = -1;
  // rebellions
  if (sim.laws.rebellions && k.villages.length >= 3) {
    for (const vid of k.villages) {
      const v = sim.villages.get(vid)!;
      if (vid === k.capital || v.residents.length < 8) continue;
      if (v.loyalty < 0 && sim.rng.chance(0.06)) { rebel(sim, v, k); break; }
    }
  }
}

export function rebelVillage(sim: Sim, vid: number) { const v = sim.villages.get(vid); const k = v && sim.kingdoms.get(v.kingdom); if (v && k) rebel(sim, v, k); }

function rebel(sim: Sim, v: Village, from: Kingdom) {
  const nk = createKingdom(sim, v.race, from.id);
  from.villages = from.villages.filter((id) => id !== v.id);
  v.kingdom = nk.id;
  nk.villages.push(v.id);
  nk.capital = v.id;
  v.loyalty = 100;
  for (const id of v.residents) { const u = sim.getUnit(id); if (u) { u.kingdom = nk.id; u.flags &= ~UF.King; } }
  const leader = v.residents.map((id) => sim.getUnit(id)!).filter(Boolean).sort((a, b) => b.level - a.level || b.age - a.age)[0];
  if (leader) crown(sim, nk, leader);
  sim.world.ownerDirty = true;
  sim.log('rebellion', { a: nk.id, b: from.id, v: v.id, x: v.cx, z: v.cz, text: nk.name });
  declareWar(sim, nk, from, true);
  // neighbouring disloyal villages may join
  for (const vid of [...from.villages]) {
    const o = sim.villages.get(vid)!;
    if (vid !== from.capital && o.loyalty < 25 && Math.hypot(o.cx - v.cx, o.cz - v.cz) < 30 && sim.rng.chance(0.5)) {
      from.villages = from.villages.filter((id) => id !== vid);
      o.kingdom = nk.id; nk.villages.push(vid);
      for (const id of o.residents) { const u = sim.getUnit(id); if (u) { u.kingdom = nk.id; u.flags &= ~UF.King; } }
    }
  }
}

export function declareWar(sim: Sim, a: Kingdom, b: Kingdom, quiet = false) {
  if (a.wars.includes(b.id) || a === b) return;
  a.wars.push(b.id); b.wars.push(a.id);
  a.allies = a.allies.filter((x) => x !== b.id); b.allies = b.allies.filter((x) => x !== a.id);
  a.warStart[b.id] = b.warStart[a.id] = sim.tick;
  a.opinion[b.id] = Math.min(a.opinion[b.id] ?? 0, -60); b.opinion[a.id] = Math.min(b.opinion[a.id] ?? 0, -60);
  sim.stats.wars++;
  if (!quiet) sim.log('war', { a: a.id, b: b.id, text: `${a.name}|${b.name}` });
  const ka = sim.villages.get(a.capital);
  if (ka) sim.fx.push({ t: 'war', x: ka.cx, z: ka.cz, a: a.id, b: b.id });
  // allies join
  for (const al of a.allies) { const k = sim.kingdoms.get(al); if (k && k.alive && !k.wars.includes(b.id) && sim.rng.chance(0.6)) declareWar(sim, k, b, true); }
  for (const al of b.allies) { const k = sim.kingdoms.get(al); if (k && k.alive && !k.wars.includes(a.id) && sim.rng.chance(0.6)) declareWar(sim, k, a, true); }
}

export function makePeace(sim: Sim, a: Kingdom, b: Kingdom) {
  if (!a.wars.includes(b.id)) return;
  a.wars = a.wars.filter((x) => x !== b.id); b.wars = b.wars.filter((x) => x !== a.id);
  a.peaceT[b.id] = b.peaceT[a.id] = sim.tick;
  a.opinion[b.id] = 10; b.opinion[a.id] = 10;
  sim.log('peace', { a: a.id, b: b.id, text: `${a.name}|${b.name}` });
  for (const u of sim.units) {
    if ((u.kingdom === a.id || u.kingdom === b.id) && (u.task?.k === 'march' || u.task?.k === 'raze' || u.task?.k === 'attack')) { u.task = null; u.think = 0; }
  }
}

export function makeAlliance(sim: Sim, a: Kingdom, b: Kingdom) {
  if (a.allies.includes(b.id) || a.wars.includes(b.id)) return;
  a.allies.push(b.id); b.allies.push(a.id);
  a.opinion[b.id] = Math.max(a.opinion[b.id] ?? 0, 70); b.opinion[a.id] = Math.max(b.opinion[a.id] ?? 0, 70);
  sim.log('alliance', { a: a.id, b: b.id, text: `${a.name}|${b.name}` });
}

function power(sim: Sim, k: Kingdom) {
  let p = 0;
  for (const vid of k.villages) { const v = sim.villages.get(vid); if (v) p += v.residents.length; }
  return p;
}

function contact(sim: Sim, a: Kingdom, b: Kingdom): number {
  let best = 1e9;
  for (const va of a.villages) for (const vb of b.villages) {
    const A = sim.villages.get(va), B = sim.villages.get(vb);
    if (!A || !B) continue;
    const d = Math.hypot(A.cx - B.cx, A.cz - B.cz) - A.radius - B.radius;
    if (d < best) best = d;
  }
  return best;
}

export function diplomacyThink(sim: Sim) {
  const ks = [...sim.kingdoms.values()].filter((k) => k.alive);
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const a = ks[i], b = ks[j];
    const d = contact(sim, a, b);
    const near = d < 40;
    const touching = d < 6;
    const sinceP = sim.tick - (a.peaceT[b.id] ?? -1e9);
    const rivalry = (hash2(Math.min(a.id, b.id), Math.max(a.id, b.id), 7) - 0.5) * 50;
    const target = RACE_AFFINITY(a.race, b.race) + rivalry + (near ? -24 : 0) + (touching ? -18 : 0) - (a.aggression + b.aggression - 1) * 35 + (sinceP < YEAR_TICKS * 3 ? 30 : 0) + (a.rebelOf === b.id || b.rebelOf === a.id ? -25 : 0);
    for (const [x, y] of [[a, b], [b, a]] as [Kingdom, Kingdom][]) {
      const cur = x.opinion[y.id] ?? target;
      x.opinion[y.id] = cur + (target - cur) * 0.2 + sim.rng.range(-5, 5);
    }
    const op = ((a.opinion[b.id] ?? 0) + (b.opinion[a.id] ?? 0)) / 2;
    if (a.wars.includes(b.id)) {
      const dur = sim.tick - (a.warStart[b.id] ?? sim.tick);
      const pa = power(sim, a), pb = power(sim, b);
      const tired = dur > YEAR_TICKS * 2.5 ? (dur / (YEAR_TICKS * 10)) : 0;
      if (sim.rng.chance(Math.min(0.25, tired * 0.1 + (Math.min(pa, pb) < 4 ? 0.1 : 0)))) makePeace(sim, a, b);
    } else if (sim.laws.wars && near && op < -20 && sinceP > YEAR_TICKS * 2 && a.wars.length < 2 && b.wars.length < 2 && sim.tick > YEAR_TICKS * 2) {
      const pa = power(sim, a), pb = power(sim, b);
      const attacker = pa >= pb ? a : b, defender = attacker === a ? b : a;
      if (power(sim, attacker) >= 8 && sim.rng.chance(0.2 * (0.5 + attacker.aggression))) declareWar(sim, attacker, defender);
    } else if (op > 55 && !a.allies.includes(b.id) && sim.rng.chance(0.05)) makeAlliance(sim, a, b);
    else if (op < 10 && a.allies.includes(b.id)) {
      a.allies = a.allies.filter((x) => x !== b.id); b.allies = b.allies.filter((x) => x !== a.id);
    }
  }
}

void setTimeout0;
