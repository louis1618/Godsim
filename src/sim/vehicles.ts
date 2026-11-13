import { Sim } from './sim';
import { PENDING } from './pending';
import { Unit, Building, Village, Anim, UF } from './entities';
import { Sp, SPECIES, Bk, TICK_DT, isCiv, isVehicle , isMonster } from './defs';
import { stepToward, separate, nearestFree } from './nav';
import { completed } from './jobs';

/**
 * Machines of the later ages. Boats (fishing, warship, ferry) sail on water, tanks roll over land,
 * planes fly over everything. They have no needs; they belong to a kingdom (or to nobody, in which
 * case they are rogue and attack anything alive). Cannons are buildings that shell enemies in range.
 */

export const enum Boat { Fishing = 0, War = 1, Ferry = 2 }

// --------------------------------------------------------------------------- hostility

/** Would kingdom `kid` (or a rogue machine when kid < 0) shoot at `o`? */
export function enemyOf(sim: Sim, kid: number, o: Unit): boolean {
  if (o.flags & (UF.Dead | UF.Jailed | UF.Aboard)) return false;
  const def = SPECIES[o.sp];
  if (kid < 0) return isCiv(o.sp) || def.undead === true || isVehicle(o.sp) && o.kingdom >= 0;
  if (o.sp === Sp.Fish) return false;
  if (o.flags & UF.Mad) return true;
  if (def.undead || o.sp === Sp.Troll || o.sp === Sp.Dragon || isMonster(o.sp)) return true;
  if (isCiv(o.sp) || isVehicle(o.sp)) {
    if (o.kingdom < 0) return isVehicle(o.sp);
    if (o.kingdom === kid) return false;
    return !!sim.kingdoms.get(kid)?.wars.includes(o.kingdom);
  }
  return false;
}

export function findEnemy(sim: Sim, x: number, z: number, r: number, kid: number, air = false): Unit | null {
  let best: Unit | null = null, bd = r * r;
  sim.near(x, z, r, (o, d2) => {
    if (d2 >= bd || !enemyOf(sim, kid, o)) return;
    if (!air && o.sp === Sp.Plane && o.y > 1) return;
    bd = d2; best = o;
  });
  return best;
}

function enemyBuilding(sim: Sim, x: number, z: number, r: number, kid: number): Building | null {
  const k = sim.kingdoms.get(kid);
  if (!k || !k.wars.length) return null;
  let best: Building | null = null, bd = r * r;
  for (const ek of k.wars) {
    const e = sim.kingdoms.get(ek);
    if (!e) continue;
    for (const vid of e.villages) {
      const v = sim.villages.get(vid);
      if (!v || Math.hypot(v.cx - x, v.cz - z) > r + v.radius + 3) continue;
      for (const id of v.buildings) {
        const b = sim.buildings.get(id);
        if (!b || !b.alive || b.kind === Bk.Farm) continue;
        const d = (b.x + b.size / 2 - x) ** 2 + (b.z + b.size / 2 - z) ** 2;
        if (d < bd) { bd = d; best = b; }
      }
    }
  }
  return best;
}

// --------------------------------------------------------------------------- shells & bombs

/** A shot lands after its flight time; damage spares the shooter's own kingdom. */
export function fireShell(sim: Sim, x: number, z: number, y: number, tx: number, tz: number, dmg: number, radius: number, kid: number, kind: 'shell' | 'bomb' | 'cannon' = 'shell') {
  const d = Math.hypot(tx - x, tz - z);
  const flight = kind === 'bomb' ? 9 : Math.max(3, Math.round(d * 0.9));
  sim.fx.push({ t: kind === 'bomb' ? 'bombdrop' : 'shell', x, z, y, tx, tz, a: flight, b: kind === 'cannon' ? 1 : 0 });
  sim.schedule(flight, { k: 'blast', x: tx, z: tz, r: radius, dmg, kid });
}

export function blast(sim: Sim, x: number, z: number, radius: number, dmg: number, kid: number) {
  sim.fx.push({ t: 'explosion', x, z, a: radius, b: dmg });
  sim.near(x, z, radius * 1.4, (o, d2) => {
    if (kid >= 0 && o.kingdom === kid && (isCiv(o.sp) || isVehicle(o.sp))) return;
    const d = Math.sqrt(d2);
    const f = 1 - d / (radius * 1.4);
    o.hp -= dmg * f; o.hitT = 6;
    if (o.hp <= 0) sim.killUnit(o, 'explosion');
    else if (!isVehicle(o.sp) && dmg * f > 25) {
      const dx = (o.x - x) / (d || 1), dz = (o.z - z) / (d || 1);
      sim.fling(o, dx * 3 * f, 4 + 4 * f, dz * 3 * f, 6);
    }
  });
  const w = sim.world;
  const R = Math.ceil(radius);
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const xx = Math.floor(x) + dx, zz = Math.floor(z) + dz;
    if (!w.inside(xx, zz) || Math.hypot(dx, dz) > radius) continue;
    const t = w.idx(xx, zz);
    const b = sim.buildingAt(t);
    if (b) {
      const v = sim.villages.get(b.village);
      if (kid < 0 || !v || v.kingdom !== kid) sim.damageBuilding(b, dmg * 0.9 / (b.size * b.size));
    }
    if (w.grass[t] > 40) w.grass[t] -= 30;
  }
}

// --------------------------------------------------------------------------- spawning

export function spawnVehicle(sim: Sim, sp: Sp, x: number, z: number, kingdom: number, village: number, variant = 0): Unit {
  const u = sim.spawnUnit(sp, x, z, { age: 0, kingdom, village, traits: 0, name: '' });
  u.item = variant;
  u.mood = 60;
  u.anim = sp === Sp.Boat ? Anim.Float : sp === Sp.Plane ? Anim.Soar : Anim.Drive;
  if (sp === Sp.Boat && variant !== Boat.War) { u.maxHp = u.hp = 120; }
  sim.fx.push({ t: 'machine', x, z, a: sp, u: u.id });
  sim.stats.machines = (sim.stats.machines ?? 0) + 1;
  return u;
}

/** A water tile right in front of a dock (its pier points at the water). */
export function dockWater(sim: Sim, b: Building): [number, number] | null {
  const w = sim.world;
  const cx = b.x + b.size / 2, cz = b.z + b.size / 2;
  const fx = [0, 1, 0, -1][b.rot], fz = [1, 0, -1, 0][b.rot];
  for (let d = 1.5; d < 6; d += 0.5) {
    const x = cx + fx * d, z = cz + fz * d;
    const t = w.tileAt(x, z);
    if (t >= 0 && w.waterDepth(t) > 0.35) return [x, z];
  }
  // any water around
  let best: [number, number] | null = null, bd = 1e9;
  for (let dz = -4; dz <= b.size + 4; dz++) for (let dx = -4; dx <= b.size + 4; dx++) {
    const xx = b.x + dx, zz = b.z + dz;
    if (!w.inside(xx, zz)) continue;
    const t = w.idx(xx, zz);
    if (w.waterDepth(t) <= 0.35) continue;
    const d = (xx + 0.5 - cx) ** 2 + (zz + 0.5 - cz) ** 2;
    if (d < bd) { bd = d; best = [xx + 0.5, zz + 0.5]; }
  }
  return best;
}

/** Village-level machine production: fishing boats & warships from docks, tanks & planes from factories. */
export function shipyardTick(sim: Sim, v: Village) {
  const k = sim.kingdoms.get(v.kingdom);
  if (!k) return;
  const atWar = k.wars.length > 0;
  const mine = (sp: Sp, pred: (u: Unit) => boolean) => sim.units.filter((u) => u.sp === sp && u.village === v.id && !(u.flags & UF.Dead) && pred(u)).length;
  const dock = completed(sim, v, Bk.Dock)[0];
  if (dock) {
    const spot = dockWater(sim, dock);
    if (spot) {
      if (mine(Sp.Boat, (u) => u.item === Boat.Fishing) < 1 && v.wood >= 8) {
        v.wood -= 8;
        const b = spawnVehicle(sim, Sp.Boat, spot[0], spot[1], k.id, v.id, Boat.Fishing); b.home = dock.id;
      } else if (atWar && k.era >= 2 && mine(Sp.Boat, (u) => u.item === Boat.War) < 1 + (v.level >= 3 ? 1 : 0) && v.wood >= 20 && v.stone >= 8 && v.gold >= 3) {
        v.wood -= 20; v.stone -= 8; v.gold -= 3;
        const b = spawnVehicle(sim, Sp.Boat, spot[0], spot[1], k.id, v.id, Boat.War); b.home = dock.id;
        sim.log('warship', { a: k.id, v: v.id, x: spot[0], z: spot[1], text: v.name });
      }
    }
  }
  const factory = completed(sim, v, Bk.Factory)[0];
  if (factory && (v.industry ?? 0) >= 30) {
    let fleet = 0;
    for (const u of sim.units) if ((u.sp === Sp.Tank || u.sp === Sp.Plane) && u.kingdom === k.id && !(u.flags & UF.Dead)) fleet++;
    const cap = (atWar ? 3 : 1) + Math.floor(k.villages.length / 2);
    if (fleet >= cap) return;
    const plane = k.era >= 4 && sim.rng.chance(0.45);
    const cost = plane ? { gold: 5, stone: 10 } : { gold: 3, stone: 12 };
    if (v.gold < cost.gold || v.stone < cost.stone) return;
    v.gold -= cost.gold; v.stone -= cost.stone; v.industry = (v.industry ?? 0) - 30;
    const fx = factory.x + factory.size / 2 + [0, 1, 0, -1][factory.rot] * 2.2, fz = factory.z + factory.size / 2 + [1, 0, -1, 0][factory.rot] * 2.2;
    const m = spawnVehicle(sim, plane ? Sp.Plane : Sp.Tank, fx, fz, k.id, v.id);
    m.home = factory.id;
    if (fleet === 0) sim.log(plane ? 'firstPlane' : 'firstTank', { a: k.id, v: v.id, x: fx, z: fz, text: k.name });
  }
}

// --------------------------------------------------------------------------- water routes

const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1];

let parent = new Int32Array(0);
let stamp = new Uint32Array(0);
let gen = 0;
/** BFS over water tiles from (sx,sz) toward the first tile within `near` of (tx,tz). Returns flat [x,z,...] waypoints. */
export function waterPath(sim: Sim, sx: number, sz: number, tx: number, tz: number, near = 2.5, maxNodes = 120000): number[] | null {
  const w = sim.world;
  const N = w.W * w.H;
  if (parent.length < N) { parent = new Int32Array(N); stamp = new Uint32Array(N); gen = 0; }
  if (++gen === 0xffffffff) { stamp.fill(0); gen = 1; }
  const s = w.tileAt(sx, sz);
  if (s < 0) return null;
  const visited: number[] = [s];
  parent[s] = s; stamp[s] = gen;
  let head = 0, goal = -1;
  const ok = (t: number) => w.waterDepth(t) > 0.3 && !(w.bld[t] >= 0);
  const near2 = near * near;
  while (head < visited.length && visited.length < maxNodes) {
    const t = visited[head++];
    const x = t % w.W, z = (t / w.W) | 0;
    if ((x + 0.5 - tx) ** 2 + (z + 0.5 - tz) ** 2 <= near2) { goal = t; break; }
    for (let k = 0; k < 8; k++) {
      const dx = DX[k], dz = DZ[k];
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= w.W || zz >= w.H) continue;
      const n = zz * w.W + xx;
      if (stamp[n] === gen || !ok(n)) continue;
      if (dx && dz && (!ok(t + dx) || !ok(t + dz * w.W))) continue;
      stamp[n] = gen; parent[n] = t; visited.push(n);
    }
  }
  if (goal < 0) return null;
  const tiles: number[] = [];
  for (let t = goal; ; t = parent[t]) { tiles.push(t); if (t === s) break; }
  tiles.reverse();
  // string-pull: keep only the corners
  const out: number[] = [];
  let i = 0;
  while (i < tiles.length - 1) {
    let j = Math.min(tiles.length - 1, i + 40);
    while (j > i + 1 && !waterLine(sim, tiles[i], tiles[j])) j--;
    out.push((tiles[j] % w.W) + 0.5, ((tiles[j] / w.W) | 0) + 0.5);
    i = j;
  }
  return out;
}

function waterLine(sim: Sim, a: number, b: number) {
  const w = sim.world;
  const ax = (a % w.W) + 0.5, az = ((a / w.W) | 0) + 0.5, bx = (b % w.W) + 0.5, bz = ((b / w.W) | 0) + 0.5;
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) * 2.5);
  for (let i = 1; i < n; i++) {
    const t = w.tileAt(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n);
    if (t < 0 || w.waterDepth(t) <= 0.3) return false;
  }
  return true;
}

/** Overseas colony: a free coastal site on another island. */
export function overseasSite(sim: Sim, v: Village, siteOk: (x: number, z: number) => boolean): [number, number] | null {
  const w = sim.world;
  if (w.islandsDirty) w.computeIslands();
  const home = w.island[w.idx(v.cx, v.cz)];
  for (let i = 0; i < 160; i++) {
    const a = sim.rng.range(0, Math.PI * 2), d = sim.rng.range(20, 110);
    const x = Math.round(v.cx + Math.cos(a) * d), z = Math.round(v.cz + Math.sin(a) * d);
    if (!w.inside(x, z)) continue;
    const t = w.idx(x, z);
    if (w.island[t] < 0 || w.island[t] === home || w.owner[t] >= 0) continue;
    let ok = true;
    for (const o of sim.villages.values()) if (o.alive && (o.cx - x) ** 2 + (o.cz - z) ** 2 < 16 * 16) { ok = false; break; }
    if (ok && siteOk(x, z)) return [x, z];
  }
  return null;
}

// --------------------------------------------------------------------------- per-tick behaviour

export function vehicleTick(sim: Sim, u: Unit) {
  if (u.cd > 0) u.cd--;
  if (u.hitT > 0) u.hitT--;
  if (u.animT > 0) u.animT--;
  if (u.emoteT > 0) u.emoteT--;
  // an owner kingdom that fell leaves the machine rogue
  if (u.kingdom >= 0 && !sim.kingdoms.get(u.kingdom)?.alive) u.kingdom = -1;
  if (u.sp === Sp.Boat) boatTick(sim, u);
  else if (u.sp === Sp.Tank) tankTick(sim, u);
  else planeTick(sim, u);
  if (u.sp !== Sp.Plane && !(u.flags & UF.Dead)) separate(sim, u);
  // keep riders on deck
  const t = u.task;
  if (t && t.k === 'voyage' && t.riders) {
    for (let i = 0; i < t.riders.length; i++) {
      const r = sim.getUnit(t.riders[i]);
      if (!r || !(r.flags & UF.Aboard)) continue;
      const off = (i - (t.riders.length - 1) / 2) * 0.28;
      r.px = r.x; r.pz = r.z;
      r.x = u.x + Math.cos(u.dir) * off - Math.sin(u.dir) * 0.15;
      r.z = u.z - Math.sin(u.dir) * off - Math.cos(u.dir) * 0.15;
      r.dir = u.dir; r.anim = Anim.Idle; r.y = 0.12;
    }
  }
}

function sail(sim: Sim, u: Unit, tx: number, tz: number, speedMul = 1): boolean {
  const sp = SPECIES[u.sp].speed * speedMul * TICK_DT;
  const dx = tx - u.x, dz = tz - u.z, d = Math.hypot(dx, dz);
  if (d <= sp) { u.x = tx; u.z = tz; return true; }
  const nx = u.x + (dx / d) * sp, nz = u.z + (dz / d) * sp;
  const t = sim.world.tileAt(nx, nz);
  if (t < 0 || sim.world.waterDepth(t) <= 0.2) return true; // ran aground: treat as arrived, replan
  u.x = nx; u.z = nz;
  // turn smoothly
  const want = Math.atan2(dx, dz);
  let dd = want - u.dir; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2;
  u.dir += dd * 0.25;
  return false;
}

function followRoute(sim: Sim, u: Unit, t: { wp: number[]; wi: number }, speedMul = 1): boolean {
  if (t.wi >= t.wp.length) return true;
  if (sail(sim, u, t.wp[t.wi], t.wp[t.wi + 1], speedMul)) t.wi += 2;
  return t.wi >= t.wp.length;
}

function randomWaterNear(sim: Sim, x: number, z: number, r: number): [number, number] | null {
  const w = sim.world;
  for (let i = 0; i < 30; i++) {
    const a = sim.rng.range(0, Math.PI * 2), d = sim.rng.range(2, r);
    const xx = x + Math.cos(a) * d, zz = z + Math.sin(a) * d;
    const t = w.tileAt(xx, zz);
    if (t >= 0 && w.waterDepth(t) > 0.5) return [xx, zz];
  }
  return null;
}

function boatTick(sim: Sim, u: Unit) {
  const w = sim.world;
  u.anim = Anim.Float;
  const here = w.tileAt(u.x, u.z);
  if (here < 0 || w.waterDepth(here) <= 0.05) {
    // stranded (land rose, water drained): wreck slowly
    if (sim.tick % 10 === 0) { u.hp -= 8; u.hitT = 4; if (u.hp <= 0) sim.killUnit(u, 'wreck'); }
    return;
  }
  const v = sim.villages.get(u.village);
  const kid = u.kingdom;
  let t = u.task;
  if (u.item === Boat.Ferry) { ferryTick(sim, u); return; }
  // warships (and rogue boats) shoot what they can reach
  if (u.item === Boat.War || kid < 0) {
    if (u.cd <= 0) {
      const e = findEnemy(sim, u.x, u.z, 7, kid);
      const b = e ? null : enemyBuilding(sim, u.x, u.z, 7, kid);
      if (e || b) {
        // lead a moving target by its velocity over the shell's flight time
        const flight = e ? Math.max(3, Math.round(Math.hypot(e.x - u.x, e.z - u.z) * 0.9)) : 0;
        const tx = e ? e.x + (e.x - e.px) * flight : b!.x + b!.size / 2, tz = e ? e.z + (e.z - e.pz) * flight : b!.z + b!.size / 2;
        fireShell(sim, u.x, u.z, 0.4, tx + sim.rng.range(-0.25, 0.25), tz + sim.rng.range(-0.25, 0.25), 45, 1.6, kid, 'cannon');
        u.cd = 26; u.anim = Anim.Attack; u.animT = 6;
        u.dir = Math.atan2(tx - u.x, tz - u.z) + Math.PI / 2; // broadside
      }
    }
  }
  if (!t || t.k !== 'voyage' || ++t.n > 900) {
    // choose the next leg
    let dest: [number, number] | null = null;
    const k = sim.kingdoms.get(kid);
    if (u.item === Boat.War && k && k.wars.length && k.target >= 0) {
      const tv = sim.villages.get(k.target);
      if (tv) dest = [tv.cx + 0.5, tv.cz + 0.5];
    }
    const home = sim.buildings.get(u.home);
    const ax = home ? home.x + 1 : v ? v.cx : u.x, az = home ? home.z + 1 : v ? v.cz : u.z;
    if (!dest) dest = randomWaterNear(sim, ax, az, u.item === Boat.Fishing ? 12 : 18);
    if (!dest) return;
    const wp = waterPath(sim, u.x, u.z, dest[0], dest[1], u.item === Boat.War && k?.wars.length ? 7 : 1.5, 30000);
    u.task = t = { k: 'voyage', phase: 0, tx: dest[0], tz: dest[1], wp: wp ?? [], wi: 0, n: 0 };
    if (!wp) { t.n = 850; return; }
  }
  if (t.phase === 1) {
    // fishing: bob in place, haul in now and then
    if (sim.tick % 50 === u.id % 50) {
      sim.fx.push({ t: 'fish', x: u.x, z: u.z, u: u.id });
      if (v) v.food += 1.5;
    }
    if (t.n > 260) u.task = null;
    return;
  }
  if (followRoute(sim, u, t)) {
    if (u.item === Boat.Fishing) { t.phase = 1; t.n = 0; }
    else u.task = null;
  }
}

/** Ferry: wait at the dock while settlers board, cross to the new land, put them ashore, return. */
function ferryTick(sim: Sim, u: Unit) {
  const t = u.task;
  if (!t || t.k !== 'voyage') { vanish(u); return; }
  t.n++;
  const riders = t.riders ?? [];
  if (t.phase === 0) {
    // boarding
    const waiting = riders.map((id) => sim.getUnit(id)).filter((r): r is Unit => !!r && !(r.flags & UF.Aboard));
    for (const r of waiting) if (Math.hypot(r.x - u.x, r.z - u.z) < 2.2) { r.flags |= UF.Aboard; r.task = null; r.path = null; }
    if (waiting.length === 0 || t.n > 260) {
      t.riders = riders.filter((id) => ((sim.getUnit(id)?.flags ?? 0) & UF.Aboard) !== 0);
      for (const r of waiting) if (r.task?.k === 'board') { r.task = null; r.flags |= UF.Settler; }
      if (!t.riders.length) { u.task = null; vanish(u); return; }
      const wp = waterPath(sim, u.x, u.z, t.tx, t.tz, 6);
      if (!wp) { disembark(sim, u, t.riders, null); u.task = null; vanish(u); return; }
      t.wp = wp; t.wi = 0; t.phase = 1; t.n = 0;
    }
    return;
  }
  if (t.phase === 1) {
    if (followRoute(sim, u, t, 1.2) || t.n > 1600) {
      disembark(sim, u, riders, t.site ?? null);
      t.riders = [];
      t.phase = 2; t.n = 0;
      const home = sim.buildings.get(u.home);
      const back = home ? dockWater(sim, home) : null;
      t.wp = back ? waterPath(sim, u.x, u.z, back[0], back[1], 1.5) ?? [] : []; t.wi = 0;
    }
    return;
  }
  // heading home; dissolve at the dock
  if (followRoute(sim, u, t) || t.n > 1600) { u.flags |= UF.Dead; u.hp = 0; }
}

function vanish(u: Unit) { u.flags |= UF.Dead; u.hp = 0; }

function disembark(sim: Sim, boat: Unit, riders: number[], site: [number, number] | null) {
  const w = sim.world;
  // nearest land
  let land: [number, number] | null = null, bd = 1e9;
  for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
    const x = Math.floor(boat.x) + dx, z = Math.floor(boat.z) + dz;
    if (!w.inside(x, z)) continue;
    const t = w.idx(x, z);
    if (!w.walkable(t) || w.bld[t] >= 0) continue;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; land = [x + 0.5, z + 0.5]; }
  }
  for (const id of riders) {
    const r = sim.getUnit(id);
    if (!r) continue;
    r.flags &= ~UF.Aboard; r.y = 0;
    if (land) { r.x = r.px = land[0] + sim.rng.range(-0.3, 0.3); r.z = r.pz = land[1] + sim.rng.range(-0.3, 0.3); }
    r.flags |= UF.Settler;
    if (site) r.task = { k: 'settle', tx: site[0] + 0.5 + sim.rng.range(-1, 1), tz: site[1] + 0.5 + sim.rng.range(-1, 1) };
    else r.task = null;
    r.think = 0;
  }
  if (land) sim.fx.push({ t: 'landfall', x: land[0], z: land[1] });
}

export function launchFerry(sim: Sim, v: Village, dock: Building, settlers: Unit[], site: [number, number]): boolean {
  const spot = dockWater(sim, dock);
  if (!spot) return false;
  // check the crossing exists before anyone packs
  const probe = waterPath(sim, spot[0], spot[1], site[0], site[1], 7);
  if (!probe) return false;
  const k = sim.kingdoms.get(v.kingdom);
  const boat = spawnVehicle(sim, Sp.Boat, spot[0], spot[1], k ? k.id : -1, v.id, Boat.Ferry);
  boat.home = dock.id;
  boat.task = { k: 'voyage', phase: 0, tx: site[0], tz: site[1], wp: [], wi: 0, n: 0, riders: settlers.map((s) => s.id), site };
  for (const s of settlers) s.task = { k: 'board', boat: boat.id };
  sim.log('voyage', { a: v.kingdom, v: v.id, x: spot[0], z: spot[1], text: v.name });
  return true;
}

// --------------------------------------------------------------------------- tanks & planes: state machine

/**
 * Tanks and planes run an explicit state machine kept in `u.task` (so it is saved with the world):
 *
 *   Idle ── wait ──▶ Acquire ──▶ Move ──▶ Attack ──▶ Acquire …
 *                      │  └────▶ Patrol ──▶ Idle
 *                      └──(nothing to do, or hurt)──▶ Return ──▶ Idle (tank) / Landed (plane)
 *   Move/Patrol/Return ──(no route)──▶ Repath ──(3 failures: target crossed off)──▶ Acquire
 *   Move/Patrol/Return ──(no progress)──▶ Unstick ──▶ Acquire      (bounded retries, then a long rest)
 *   plane only: Move ──▶ Attack (bombing run over the target) ──▶ Egress (fly on, straight) ──▶ Acquire
 *
 * Every state has one way in (`go`) that stamps its start; nothing waits or retries without a limit.
 */
export const enum MS { Idle = 0, Patrol = 1, Acquire = 2, Move = 3, Attack = 4, Evade = 5, Repath = 6, Unstick = 7, Return = 8, Landed = 9, Egress = 10 }
export const MS_NAME = ['Idle', 'Patrol', 'AcquireTarget', 'MoveToTarget', 'Attack', 'Evade', 'Repath', 'StuckRecovery', 'ReturnToBase', 'Landed', 'Egress'];
type Mach = Extract<NonNullable<Unit['task']>, { k: 'mach' }>;
export const machOpts = { /** tools: count state changes and recoveries */ trace: null as ((u: Unit, from: number, to: number, why: string) => void) | null };

function mach(sim: Sim, u: Unit): Mach {
  const t = u.task;
  if (t && t.k === 'mach') return t;
  const m: Mach = { k: 'mach', st: u.sp === Sp.Plane ? (u.y > 0.5 ? MS.Return : MS.Landed) : MS.Idle, t0: sim.tick, tx: u.x, tz: u.z, tu: -1, tb: -1, tv: -1,
    ax: u.x, az: u.z, at: sim.tick, fails: 0, wait: 10 + (u.id % 20), rec: 0, recT: -1e9, rx: u.x, rz: u.z, bad: -1, badT: 0, wp: 0, gx: -1, gz: -1, last: '' };
  u.task = m;
  return m;
}
function go(sim: Sim, u: Unit, m: Mach, st: MS, why = '') {
  machOpts.trace?.(u, m.st, st, why);
  m.st = st; m.t0 = sim.tick; m.ax = u.x; m.az = u.z; m.at = sim.tick;
  if (why) m.last = why;
}
const clearTarget = (m: Mach) => { m.tu = -1; m.tb = -1; m.tv = -1; };

/** Where a machine goes home to: in front of its factory, else its town, else where it stands. */
function homeSpot(sim: Sim, u: Unit): [number, number] {
  const b = sim.buildings.get(u.home);
  if (b && b.alive && b.kind !== Bk.Ruin) {
    const fx = [0, 1, 0, -1][b.rot], fz = [1, 0, -1, 0][b.rot];
    const side = ((u.id % 3) - 1) * 1.3;
    return [b.x + b.size / 2 + fx * 2.4 - fz * side, b.z + b.size / 2 + fz * 2.4 + fx * side];
  }
  const v = sim.villages.get(u.village);
  if (v && v.alive) return [v.cx + 0.5 + ((u.id % 5) - 2) * 1.1, v.cz + 0.5 + v.radius * 0.5];
  return [u.x, u.z];
}

/** The enemy building a machine is working on: still standing, still an enemy's. */
function targetBuilding(sim: Sim, u: Unit, m: Mach): Building | null {
  const b = sim.buildings.get(m.tb);
  if (!b || !b.alive || b.kind === Bk.Ruin) return null;
  if (u.kingdom < 0) return b;
  const v = sim.villages.get(b.village);
  return v && sim.kingdoms.get(u.kingdom)?.wars.includes(v.kingdom) ? b : null;
}
/** Any building of any living town near a point (what a rogue machine goes for). */
function anyBuilding(sim: Sim, x: number, z: number, r: number): Building | null {
  let best: Building | null = null, bd = r * r;
  for (const b of sim.buildings.values()) {
    if (!b.alive || b.kind === Bk.Ruin || b.kind === Bk.Farm || b.village < 0) continue;
    const d = (b.x + b.size / 2 - x) ** 2 + (b.z + b.size / 2 - z) ** 2;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
/** The town a machine is sent against: the kingdom's war target (unless crossed off), or for a rogue the nearest town. */
function targetVillage(sim: Sim, u: Unit, m: Mach, needLand: boolean): Village | null {
  const w = sim.world;
  const here = w.tileAt(u.x, u.z);
  const reach = (v: Village) => {
    if (v.id === m.bad && sim.tick < m.badT) return false;
    if (!needLand) return true;
    if (w.islandsDirty) w.computeIslands();
    const a = here >= 0 ? w.island[here] : -1;
    if (a < 0) return true;
    // the town counts as reachable if any ground around its centre is on our landmass
    for (let i = 0; i < 8; i++) { const t = w.tileAt(v.cx + Math.cos(i * 0.785) * (v.radius * 0.6), v.cz + Math.sin(i * 0.785) * (v.radius * 0.6)); if (t >= 0 && w.island[t] === a) return true; }
    return false;
  };
  const k = sim.kingdoms.get(u.kingdom);
  if (k) {
    if (!k.wars.length) return null;
    const tv = sim.villages.get(k.target);
    if (tv && tv.alive && k.wars.includes(tv.kingdom) && reach(tv)) return tv;
    // the appointed target is out of reach: the nearest enemy town we can get to
    let best: Village | null = null, bd = 1e9;
    for (const ek of k.wars) for (const vid of sim.kingdoms.get(ek)?.villages ?? []) {
      const v = sim.villages.get(vid);
      if (!v || !v.alive || !reach(v)) continue;
      const d = (v.cx - u.x) ** 2 + (v.cz - u.z) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
  let best: Village | null = null, bd = 1e9;
  for (const v of sim.villages.values()) { if (!v.alive || !reach(v)) continue; const d = (v.cx - u.x) ** 2 + (v.cz - u.z) ** 2; if (d < bd) { bd = d; best = v; } }
  return best;
}

// ----- tanks

const TANK_RANGE = 8;
function tankFire(sim: Sim, u: Unit, tx: number, tz: number) {
  u.dir = Math.atan2(tx - u.x, tz - u.z);
  fireShell(sim, u.x + Math.sin(u.dir) * 0.6, u.z + Math.cos(u.dir) * 0.6, 0.5, tx, tz, SPECIES[Sp.Tank].dmg, 1.5, u.kingdom);
  u.cd = 22; u.animT = 5;
}
/** Lead a moving target by the shell's flight time. */
function leadOf(u: Unit, e: Unit): [number, number] {
  const flight = Math.max(3, Math.round(Math.hypot(e.x - u.x, e.z - u.z) * 0.9));
  return [e.x + (e.x - e.px) * flight, e.z + (e.z - e.pz) * flight];
}

/** Follow a route toward (tx,tz). 1: there, 0: on the way (or waiting for a search slot), 2: no route. */
function drive(sim: Sim, u: Unit, m: Mach, tx: number, tz: number, arrive: number): 0 | 1 | 2 {
  const w = sim.world;
  if (Math.hypot(tx - u.x, tz - u.z) <= arrive) { u.path = null; return 1; }
  const moved = Math.hypot(tx - m.gx, tz - m.gz) > 3;
  if (!u.path || u.pathNav !== sim.navVersion || moved) {
    if (sim.pathCalls > 60) return 0;
    sim.pathCalls++;
    let goal = w.tileAt(tx, tz);
    if (goal < 0) return 2;
    if (!w.walkable(goal) || w.bld[goal] >= 0) { const nf = nearestFree(w, tx, tz, 6); if (nf) goal = w.tileAt(nf[0], nf[1]); }
    u.path = sim.pf.find(u.x, u.z, goal, 8000, Math.max(2, Math.floor(arrive)));
    u.pathI = 0; u.pathNav = sim.navVersion; m.gx = tx; m.gz = tz;
    if (!u.path) return 2;
  }
  const p = u.path;
  if (u.pathI >= p.length) { u.path = null; return Math.hypot(tx - u.x, tz - u.z) <= arrive + 2.5 ? 1 : 0; }
  const wt = p[u.pathI];
  const wx = (wt % w.W) + 0.5, wz = ((wt / w.W) | 0) + 0.5;
  const sp = SPECIES[u.sp].speed * TICK_DT / Math.sqrt(w.walkCost(Math.max(0, w.tileAt(u.x, u.z))));
  const step = stepToward(w, u, wx, wz, sp, false);
  if (Math.hypot(wx - u.x, wz - u.z) < 0.3) u.pathI++;
  if (step > 1e-5) {
    const want = Math.atan2(wx - u.x, wz - u.z);
    let dd = want - u.dir; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2;
    u.dir += dd * 0.3;
  }
  return 0;
}

/** A moving state that has not got anywhere for a while is stuck (whatever the reason). */
function progress(sim: Sim, u: Unit, m: Mach, limit: number): boolean {
  if (Math.hypot(u.x - m.ax, u.z - m.az) > 0.8) {
    m.ax = u.x; m.az = u.z; m.at = sim.tick;
    // a good stretch since the last recovery: the trouble is behind us
    if (m.rec && Math.hypot(u.x - m.rx, u.z - m.rz) > 5) m.rec = 0;
    return true;
  }
  return sim.tick - m.at <= limit;
}

/** A machine whose town is gone is taken over by its kingdom's capital. */
function rehome(sim: Sim, u: Unit) {
  if (u.kingdom < 0 || sim.villages.get(u.village)?.alive) return;
  const cap = sim.villages.get(sim.kingdoms.get(u.kingdom)?.capital ?? -1);
  if (cap && cap.alive) { u.village = cap.id; u.home = -1; }
}

function tankTick(sim: Sim, u: Unit) {
  u.anim = Anim.Drive;
  if ((sim.tick + u.id) % 50 === 0) rehome(sim, u);
  const m = mach(sim, u);
  const w = sim.world;
  const kid = u.kingdom;
  const scan = (sim.tick + u.id) % 6 === 0;
  // a gun that bears fires, whatever the tank is doing (never while recovering from being stuck)
  if (u.cd <= 0 && m.st !== MS.Attack && m.st !== MS.Unstick && scan) {
    const e = findEnemy(sim, u.x, u.z, TANK_RANGE, kid);
    if (e) { const [lx, lz] = leadOf(u, e); tankFire(sim, u, lx, lz); }
  }
  // badly hurt: break off and go home to be mended
  if (u.hp < u.maxHp * 0.3 && (m.st === MS.Move || m.st === MS.Attack || m.st === MS.Patrol) && sim.villages.get(u.village)?.alive) { clearTarget(m); go(sim, u, m, MS.Return, 'damaged'); }
  switch (m.st) {
    case MS.Idle: {
      if (u.hp < u.maxHp && sim.tick % 10 === 0) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.01);
      if (sim.tick - m.t0 >= m.wait || (scan && findEnemy(sim, u.x, u.z, 11, kid))) go(sim, u, m, MS.Acquire);
      break;
    }
    case MS.Acquire: {
      clearTarget(m); u.path = null;
      const e = findEnemy(sim, u.x, u.z, 11, kid);
      if (e) { m.tu = e.id; m.tx = e.x; m.tz = e.z; go(sim, u, m, Math.hypot(e.x - u.x, e.z - u.z) <= TANK_RANGE - 0.5 ? MS.Attack : MS.Move, 'enemy'); break; }
      const b = kid < 0 ? anyBuilding(sim, u.x, u.z, 9) : enemyBuilding(sim, u.x, u.z, 9, kid);
      if (b) { m.tb = b.id; m.tx = b.x + b.size / 2; m.tz = b.z + b.size / 2; go(sim, u, m, Math.hypot(m.tx - u.x, m.tz - u.z) <= TANK_RANGE - 0.5 ? MS.Attack : MS.Move, 'building'); break; }
      const tv = targetVillage(sim, u, m, true);
      if (tv) { m.tv = tv.id; m.tx = tv.cx + 0.5; m.tz = tv.cz + 0.5; go(sim, u, m, MS.Move, 'town'); break; }
      // nothing to fight: patrol around home, or go back there first
      const v = sim.villages.get(u.village);
      const [hx, hz] = homeSpot(sim, u);
      if (v && v.alive && Math.hypot(u.x - v.cx, u.z - v.cz) > v.radius + 6) { go(sim, u, m, MS.Return, 'home'); break; }
      if (w.islandsDirty) w.computeIslands();
      const here = w.tileAt(u.x, u.z), isl = here >= 0 ? w.island[here] : -1;
      const cx = v && v.alive ? v.cx + 0.5 : hx, cz = v && v.alive ? v.cz + 0.5 : hz, R = v && v.alive ? v.radius : 8;
      let found = false;
      for (let i = 0; i < 8 && !found; i++) {
        const a = sim.rng.range(0, Math.PI * 2), d = R * sim.rng.range(0.45, 0.95);
        const px = cx + Math.cos(a) * d, pz = cz + Math.sin(a) * d, t = w.tileAt(px, pz);
        if (t < 0 || !w.walkable(t) || w.bld[t] >= 0 || (isl >= 0 && w.island[t] !== isl) || Math.hypot(px - u.x, pz - u.z) < 3) continue;
        m.tx = px; m.tz = pz; found = true;
      }
      if (found) go(sim, u, m, MS.Patrol, 'patrol'); else { m.wait = 40; go(sim, u, m, MS.Idle); }
      break;
    }
    case MS.Patrol: {
      if (scan && (findEnemy(sim, u.x, u.z, 11, kid) || (sim.kingdoms.get(kid)?.wars.length && targetVillage(sim, u, m, true)))) { go(sim, u, m, MS.Acquire, 'alert'); break; }
      const r = drive(sim, u, m, m.tx, m.tz, 1.2);
      if (r === 1) { m.wait = 30 + sim.rng.int(0, 50); m.fails = 0; go(sim, u, m, MS.Idle); }
      else if (r === 2) { m.wait = 20; go(sim, u, m, MS.Idle, 'no route to patrol point'); }
      else if (!progress(sim, u, m, 45)) unstick(sim, u, m, 'no progress on patrol');
      break;
    }
    case MS.Move: {
      let arrive = 2;
      if (m.tu >= 0) {
        const e = sim.getUnit(m.tu);
        if (!e || !enemyOf(sim, kid, e)) { go(sim, u, m, MS.Acquire, 'target lost'); break; }
        m.tx = e.x; m.tz = e.z;
        if (Math.hypot(e.x - u.x, e.z - u.z) <= TANK_RANGE - 1) { u.path = null; go(sim, u, m, MS.Attack); break; }
      } else if (m.tb >= 0) {
        const b = targetBuilding(sim, u, m);
        if (!b) { go(sim, u, m, MS.Acquire, 'target lost'); break; }
        if (Math.hypot(m.tx - u.x, m.tz - u.z) <= TANK_RANGE - 1) { u.path = null; go(sim, u, m, MS.Attack); break; }
      } else {
        const tv = sim.villages.get(m.tv);
        const k = sim.kingdoms.get(kid);
        if (!tv || !tv.alive || (k && !k.wars.includes(tv.kingdom))) { go(sim, u, m, MS.Acquire, 'target lost'); break; }
        arrive = 3;
        // close to the town: pick something to shoot at
        if (scan && Math.hypot(tv.cx - u.x, tv.cz - u.z) < tv.radius + 9) {
          const e = findEnemy(sim, u.x, u.z, 11, kid);
          const b = e ? null : kid < 0 ? anyBuilding(sim, u.x, u.z, 10) : enemyBuilding(sim, u.x, u.z, 10, kid);
          if (e || b) { go(sim, u, m, MS.Acquire, 'in sight'); break; }
        }
      }
      const r = drive(sim, u, m, m.tx, m.tz, arrive);
      if (r === 1) { m.fails = 0; if (m.tv >= 0 && m.tu < 0 && m.tb < 0) { m.wait = 30; go(sim, u, m, MS.Idle, 'holding the town'); } else go(sim, u, m, MS.Attack); }
      else if (r === 2) { m.fails++; m.wait = 20 * m.fails; go(sim, u, m, MS.Repath, 'no route'); }
      else if (!progress(sim, u, m, 45)) unstick(sim, u, m, 'no progress');
      break;
    }
    case MS.Attack: {
      let ax = 0, az = 0, ok = false;
      if (m.tu >= 0) { const e = sim.getUnit(m.tu); if (e && enemyOf(sim, kid, e)) { [ax, az] = leadOf(u, e); m.tx = e.x; m.tz = e.z; ok = true; } }
      else if (m.tb >= 0) { const b = targetBuilding(sim, u, m); if (b) { ax = b.x + b.size / 2; az = b.z + b.size / 2; ok = true; } }
      if (!ok) { go(sim, u, m, MS.Acquire, 'target down'); break; }
      const d = Math.hypot(m.tx - u.x, m.tz - u.z);
      if (d > TANK_RANGE + 1) { go(sim, u, m, MS.Move, 'out of range'); break; }
      // lay the gun, then fire
      const want = Math.atan2(ax - u.x, az - u.z);
      let dd = want - u.dir; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2;
      u.dir += Math.max(-0.25, Math.min(0.25, dd));
      if (u.cd <= 0 && Math.abs(dd) < 0.3) tankFire(sim, u, ax, az);
      // a nearer threat takes over
      if (scan && m.tb >= 0) { const e = findEnemy(sim, u.x, u.z, TANK_RANGE, kid); if (e) { m.tb = -1; m.tu = e.id; } }
      break;
    }
    case MS.Repath: {
      if (sim.tick - m.t0 < m.wait) break;
      if (m.fails >= 3) {
        // no way there: cross the town off for two minutes and think again
        if (m.tv >= 0) { m.bad = m.tv; m.badT = sim.tick + 1200; }
        m.fails = 0; go(sim, u, m, MS.Acquire, 'gave up on an unreachable target');
      } else go(sim, u, m, MS.Move, 'retry route');
      break;
    }
    case MS.Unstick: {
      const sp = SPECIES[u.sp].speed * TICK_DT;
      stepToward(w, u, m.tx, m.tz, sp, false);
      u.dir = Math.atan2(m.tx - u.x, m.tz - u.z);
      if (Math.hypot(m.tx - u.x, m.tz - u.z) < 0.4 || sim.tick - m.t0 > 40) go(sim, u, m, MS.Acquire, 'replanning after backing off');
      break;
    }
    case MS.Return: {
      const [hx, hz] = homeSpot(sim, u);
      if (scan && u.hp >= u.maxHp * 0.3 && findEnemy(sim, u.x, u.z, 9, kid)) { go(sim, u, m, MS.Acquire, 'alert'); break; }
      const r = drive(sim, u, m, hx, hz, 2.5);
      if (r === 1) { m.wait = 60; m.fails = 0; go(sim, u, m, MS.Idle, 'home'); }
      else if (r === 2) { m.wait = 100; go(sim, u, m, MS.Idle, 'no route home: holding here'); }
      else if (!progress(sim, u, m, 45)) unstick(sim, u, m, 'no progress going home');
      break;
    }
    default: go(sim, u, m, MS.Acquire);
  }
}

/**
 * Stuck recovery for a tank: drop the route, back off to a clear spot and plan afresh. Repeated
 * trouble escalates (move to open ground and go home; then a long rest) so it can never loop for ever.
 */
function unstick(sim: Sim, u: Unit, m: Mach, why: string) {
  const w = sim.world;
  m.rec++; m.recT = sim.tick; m.rx = u.x; m.rz = u.z; u.path = null; u.stuck = 0;
  if (m.rec >= 6) { m.rec = 0; m.wait = 150; clearTarget(m); go(sim, u, m, MS.Idle, 'stuck too often: resting'); return; }
  if (m.rec >= 4) {
    // boxed in: shift to the nearest open ground, then head home
    const nf = nearestFree(w, u.x + sim.rng.range(-2, 2), u.z + sim.rng.range(-2, 2), 5);
    if (nf) { u.x = nf[0]; u.z = nf[1]; u.px = u.x; u.pz = u.z; }
    go(sim, u, m, MS.Return, 'moved to open ground'); return;
  }
  // back off to a clear spot a few tiles away and plan afresh from there
  for (let i = 0; i < 10; i++) {
    const a = sim.rng.range(0, Math.PI * 2), d = sim.rng.range(2, 4.5);
    const px = u.x + Math.cos(a) * d, pz = u.z + Math.sin(a) * d, t = w.tileAt(px, pz);
    if (t >= 0 && w.walkable(t) && w.bld[t] < 0 && lineFree(w, u.x, u.z, px, pz)) { m.tx = px; m.tz = pz; go(sim, u, m, MS.Unstick, why); return; }
  }
  m.wait = 30; go(sim, u, m, MS.Idle, 'no room to back off');
}

function lineFree(w: Sim['world'], ax: number, az: number, bx: number, bz: number): boolean {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) * 3);
  for (let i = 1; i <= n; i++) { const t = w.tileAt(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n); if (t < 0 || !w.walkable(t) || (w.bld[t] >= 0 && !w.bldPassable(t))) return false; }
  return true;
}

// ----- planes

const CRUISE = 5, BOMBS = 6, TURN = 0.09;
/** Steer toward a point at a limited turn rate and move on; the map edge turns the plane back inside. */
function fly(sim: Sim, u: Unit, tx: number, tz: number, speedMul = 1, turn = TURN, alt = CRUISE) {
  const w = sim.world;
  // near the edge the only heading is back toward the middle of the map
  const mrg = 3;
  if (u.x < mrg || u.z < mrg || u.x > w.W - mrg || u.z > w.H - mrg) { tx = w.W / 2; tz = w.H / 2; turn = Math.max(turn, 0.14); }
  const want = Math.atan2(tx - u.x, tz - u.z);
  let dd = want - u.dir; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2;
  const d = Math.max(-turn, Math.min(turn, dd));
  u.dir += d;
  u.spin = d / TURN;                       // bank into the turn (drawn as roll)
  const sp = SPECIES[u.sp].speed * TICK_DT * speedMul;
  u.x = Math.max(0.5, Math.min(w.W - 0.5, u.x + Math.sin(u.dir) * sp));
  u.z = Math.max(0.5, Math.min(w.H - 0.5, u.z + Math.cos(u.dir) * sp));
  u.y += (alt - u.y) * 0.06;
  return dd;
}

function planeTick(sim: Sim, u: Unit) {
  if ((sim.tick + u.id) % 50 === 0) rehome(sim, u);
  const m = mach(sim, u);
  const kid = u.kingdom;
  const k = sim.kingdoms.get(kid);
  const scan = (sim.tick + u.id) % 6 === 0;
  const [hx, hz] = homeSpot(sim, u);
  const hasHome = !!sim.villages.get(u.village)?.alive;
  u.anim = m.st === MS.Landed ? Anim.Idle : Anim.Soar;
  if (m.st !== MS.Landed && m.st !== MS.Return && u.hp < u.maxHp * 0.35 && hasHome) { clearTarget(m); go(sim, u, m, MS.Return, 'damaged'); }
  switch (m.st) {
    case MS.Landed: {
      // parked: mended and rearmed on the ground; up again for a war, a raid on the town, or a patrol flight
      u.y += (0 - u.y) * 0.25; if (u.y < 0.02) u.y = 0;
      u.spin = 0;
      if (sim.tick % 10 === 0 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.02);
      if (sim.tick - m.t0 < 50) break;       // turnaround time
      u.carryAmt = 0;
      if (!scan) break;
      const fit = u.hp >= u.maxHp * 0.7;
      if (!hasHome && kid >= 0) { go(sim, u, m, MS.Acquire, 'base lost'); break; }
      if (fit && (kid < 0 || targetVillage(sim, u, m, false) || findEnemy(sim, hx, hz, 14, kid, true))) { go(sim, u, m, MS.Acquire, 'scramble'); break; }
      if (fit && sim.tick - m.t0 > m.wait) { m.wp = 0; go(sim, u, m, MS.Patrol, 'patrol flight'); }
      break;
    }
    case MS.Acquire: {
      clearTarget(m);
      if (u.carryAmt >= BOMBS) {
        if (hasHome) go(sim, u, m, MS.Return, 'out of bombs');
        else { m.wp = 0; go(sim, u, m, MS.Patrol, 'out of bombs: roaming'); } // no base: a long circuit before the next attack
        break;
      }
      const tv = targetVillage(sim, u, m, false);
      if (tv) {
        // aim at a building of that town (the nearest one to us), else at its centre
        let best: Building | null = null, bd = 1e9;
        for (const id of tv.buildings) { const b = sim.buildings.get(id); if (!b || !b.alive || b.kind === Bk.Farm) continue; const d = (b.x + b.size / 2 - u.x) ** 2 + (b.z + b.size / 2 - u.z) ** 2; if (d < bd) { bd = d; best = b; } }
        m.tv = tv.id; m.tb = best ? best.id : -1;
        m.tx = best ? best.x + best.size / 2 : tv.cx + 0.5; m.tz = best ? best.z + best.size / 2 : tv.cz + 0.5;
        go(sim, u, m, MS.Move, 'target town');
        break;
      }
      const e = findEnemy(sim, u.x, u.z, 16, kid);
      if (e) { m.tu = e.id; m.tx = e.x; m.tz = e.z; go(sim, u, m, MS.Move, 'enemy'); break; }
      if (hasHome) go(sim, u, m, MS.Return, 'nothing to attack');
      else { m.wp = 0; go(sim, u, m, MS.Patrol, 'roaming'); }
      break;
    }
    case MS.Move: {
      // approach: line up on the target from a distance; too close and badly lined up means flying on first
      if (m.tu >= 0) { const e = sim.getUnit(m.tu); if (!e || !enemyOf(sim, kid, e)) { go(sim, u, m, MS.Acquire, 'target lost'); break; } m.tx = e.x; m.tz = e.z; }
      else if (k && !(sim.villages.get(m.tv)?.alive && k.wars.includes(sim.villages.get(m.tv)!.kingdom))) { go(sim, u, m, MS.Acquire, 'target lost'); break; }
      const d = Math.hypot(m.tx - u.x, m.tz - u.z);
      const off = fly(sim, u, m.tx, m.tz);
      if (d < 9 && Math.abs(off) > 0.9) { go(sim, u, m, MS.Egress, 'too close to line up'); break; }
      if (d < 7 && Math.abs(off) < 0.35) { go(sim, u, m, MS.Attack, 'run in'); break; }
      if (sim.tick - m.t0 > 400) go(sim, u, m, MS.Egress, 'approach took too long');
      break;
    }
    case MS.Attack: {
      // bombing run: hold the line over the target, release on top of it, keep going
      if (m.tu >= 0) { const e = sim.getUnit(m.tu); if (e && enemyOf(sim, kid, e)) { m.tx = e.x; m.tz = e.z; } }
      const d = Math.hypot(m.tx - u.x, m.tz - u.z);
      const ahead = Math.sin(u.dir) * (m.tx - u.x) + Math.cos(u.dir) * (m.tz - u.z);
      fly(sim, u, m.tx, m.tz, 1, d > 3 ? TURN : 0.02, 3.6);
      if (u.cd <= 0 && u.carryAmt < BOMBS && d < 2.4) {
        fireShell(sim, u.x, u.z, u.y, m.tx, m.tz, SPECIES[Sp.Plane].dmg, 1.8, kid, 'bomb');
        u.cd = 5; u.carryAmt++; m.wp++;
        // walk the stick of bombs on through the town
        const nb = kid < 0 ? anyBuilding(sim, u.x + Math.sin(u.dir) * 2.5, u.z + Math.cos(u.dir) * 2.5, 2.6) : enemyBuilding(sim, u.x + Math.sin(u.dir) * 2.5, u.z + Math.cos(u.dir) * 2.5, 2.6, kid);
        if (nb && m.wp < 3) { m.tx = nb.x + nb.size / 2; m.tz = nb.z + nb.size / 2; m.tu = -1; }
        else { m.wp = 0; go(sim, u, m, MS.Egress, 'bombs away'); }
        break;
      }
      if (ahead < -0.5 || sim.tick - m.t0 > 80) { m.wp = 0; go(sim, u, m, MS.Egress, ahead < -0.5 ? 'overflew' : 'run timed out'); }
      break;
    }
    case MS.Egress: {
      // fly straight on until there is room to come round again (never a tight circle over the target)
      fly(sim, u, u.x + Math.sin(u.dir) * 10, u.z + Math.cos(u.dir) * 10);
      if (Math.hypot(m.tx - u.x, m.tz - u.z) > 12 || sim.tick - m.t0 > 45) go(sim, u, m, MS.Acquire, 'coming round');
      break;
    }
    case MS.Patrol: {
      // one circuit over the town's land, then home (a rogue or homeless plane roams the map instead)
      const v = sim.villages.get(u.village);
      const w = sim.world;
      if (scan && u.carryAmt < BOMBS && (targetVillage(sim, u, m, false) || findEnemy(sim, u.x, u.z, 12, kid))) { go(sim, u, m, MS.Acquire, 'alert'); break; }
      let px: number, pz: number;
      if (v && v.alive) { const a = (u.id % 7) + m.wp * 1.57, R = v.radius + 8; px = v.cx + Math.cos(a) * R; pz = v.cz + Math.sin(a) * R; }
      else { const a = u.id * 2.4 + m.wp * 2.1; px = w.W / 2 + Math.cos(a) * w.W * 0.33; pz = w.H / 2 + Math.sin(a) * w.H * 0.33; }
      fly(sim, u, px, pz);
      if (Math.hypot(px - u.x, pz - u.z) < 5 || sim.tick - m.t0 > 300) { m.wp++; m.t0 = sim.tick; if (m.wp >= 4) { m.wp = 0; if (hasHome) go(sim, u, m, MS.Return, 'patrol done'); else { u.carryAmt = 0; go(sim, u, m, MS.Acquire, 'circuit done'); } } }
      break;
    }
    case MS.Return: {
      if (!hasHome) { go(sim, u, m, MS.Acquire, 'base lost'); break; }
      if (scan && u.carryAmt < BOMBS && u.hp >= u.maxHp * 0.35 && sim.tick - m.t0 > 30 && targetVillage(sim, u, m, false) && k?.wars.length && m.last !== 'out of bombs' && m.last !== 'damaged') { go(sim, u, m, MS.Acquire, 'alert'); break; }
      const d = Math.hypot(hx - u.x, hz - u.z);
      // final approach: slow, low and able to turn tighter, so the pad is reached rather than orbited
      const near = d < 9;
      fly(sim, u, hx, hz, near ? 0.45 : 1, near ? 0.2 : TURN, near ? Math.max(0.3, d * 0.35) : CRUISE);
      if (d < 0.9 || (near && sim.tick - m.t0 > 500)) {
        if (d >= 0.9) { m.rec++; m.recT = sim.tick; m.last = 'landing forced after a long approach'; }
        u.x = hx; u.z = hz; u.spin = 0;
        m.wait = 500 + (u.id % 5) * 80;
        go(sim, u, m, MS.Landed, m.last === 'out of bombs' ? 'rearming' : 'landed');
      }
      break;
    }
    default: go(sim, u, m, MS.Acquire);
  }
}

/** For the inspector / debug overlay: what a machine is doing and why. */
export function machineDebug(sim: Sim, u: Unit): { state: string; target: string; dest: string; path: number; sinceMove: number; recoveries: number; last: string; bombs?: number } | null {
  const m = u.task;
  if (!m || m.k !== 'mach') return null;
  const tgt = m.tu >= 0 ? `unit #${m.tu}` : m.tb >= 0 ? `building #${m.tb}` : m.tv >= 0 ? `town ${sim.villages.get(m.tv)?.name ?? m.tv}` : '-';
  return { state: MS_NAME[m.st] ?? String(m.st), target: tgt, dest: `${m.tx.toFixed(0)},${m.tz.toFixed(0)}`, path: u.path ? u.path.length - u.pathI : 0, sinceMove: sim.tick - m.at, recoveries: m.rec, last: m.last, bombs: u.sp === Sp.Plane ? BOMBS - u.carryAmt : undefined };
}

// --------------------------------------------------------------------------- cannons

export function cannonTick(sim: Sim, b: Building) {
  if (b.progress < 1 || (sim.tick + b.id) % 24 !== 0) return;
  const v = sim.villages.get(b.village);
  if (!v) return;
  const cx = b.x + 0.5, cz = b.z + 0.5;
  const e = findEnemy(sim, cx, cz, 10, v.kingdom);
  if (!e) return;
  const lead = 0.6;
  const tx = e.x + (e.x - e.px) * 10 * lead, tz = e.z + (e.z - e.pz) * 10 * lead;
  b.aim = Math.atan2(tx - cx, tz - cz);
  fireShell(sim, cx + Math.sin(b.aim) * 0.5, cz + Math.cos(b.aim) * 0.5, 0.6, tx, tz, 55, 1.4, v.kingdom, 'cannon');
}



PENDING.blast = (sim, e) => blast(sim, e.x!, e.z!, e.r!, e.dmg!, e.kid!);
