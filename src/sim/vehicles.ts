import { Sim, setTimeout0 } from './sim';
import { Unit, Building, Village, Anim, UF } from './entities';
import { Sp, SPECIES, Bk, TICK_DT, isCiv, isVehicle } from './defs';
import { stepToward } from './nav';
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
  if (o.flags & UF.Mad) return true;
  if (def.undead || o.sp === Sp.Troll) return true;
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
  setTimeout0(sim, flight, () => blast(sim, tx, tz, radius, dmg, kid));
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
  if (u.emoteT > 0) u.emoteT--;
  // an owner kingdom that fell leaves the machine rogue
  if (u.kingdom >= 0 && !sim.kingdoms.get(u.kingdom)?.alive) u.kingdom = -1;
  if (u.sp === Sp.Boat) boatTick(sim, u);
  else if (u.sp === Sp.Tank) tankTick(sim, u);
  else planeTick(sim, u);
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
        const tx = e ? e.x : b!.x + b!.size / 2, tz = e ? e.z : b!.z + b!.size / 2;
        fireShell(sim, u.x, u.z, 0.4, tx + sim.rng.range(-0.4, 0.4), tz + sim.rng.range(-0.4, 0.4), 45, 1.3, kid, 'cannon');
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

function tankTick(sim: Sim, u: Unit) {
  u.anim = Anim.Drive;
  const kid = u.kingdom;
  const k = sim.kingdoms.get(kid);
  if (u.cd <= 0) {
    const e = findEnemy(sim, u.x, u.z, 8, kid);
    const b = e ? null : enemyBuilding(sim, u.x, u.z, 8, kid);
    if (e || b) {
      const tx = e ? e.x : b!.x + b!.size / 2, tz = e ? e.z : b!.z + b!.size / 2;
      u.dir = Math.atan2(tx - u.x, tz - u.z);
      fireShell(sim, u.x + Math.sin(u.dir) * 0.6, u.z + Math.cos(u.dir) * 0.6, 0.5, tx, tz, SPECIES[Sp.Tank].dmg, 1.4, kid);
      u.cd = 22; u.animT = 5;
      return;
    }
  }
  // roll toward the war target, otherwise guard home
  let tx: number, tz: number;
  if (k && k.wars.length && k.target >= 0 && sim.villages.get(k.target)) { const tv = sim.villages.get(k.target)!; tx = tv.cx + 0.5; tz = tv.cz + 0.5; }
  else if (kid < 0) {
    // rogue: hunt the nearest settlement
    let best: Village | null = null, bd = 1e9;
    for (const v of sim.villages.values()) { if (!v.alive) continue; const d = (v.cx - u.x) ** 2 + (v.cz - u.z) ** 2; if (d < bd) { bd = d; best = v; } }
    if (!best) return;
    tx = best.cx + 0.5; tz = best.cz + 0.5;
  } else {
    const v = sim.villages.get(u.village);
    if (!v) return;
    if (Math.hypot(u.x - v.cx, u.z - v.cz) < v.radius * 0.9 && sim.tick % 80 !== u.id % 80) return;
    const a = (u.look % 628) / 100 + sim.tick * 0.002;
    tx = v.cx + 0.5 + Math.cos(a) * v.radius * 0.6; tz = v.cz + 0.5 + Math.sin(a) * v.radius * 0.6;
  }
  if (Math.hypot(tx - u.x, tz - u.z) < 3.5) return;
  driveTo(sim, u, tx, tz);
}

function driveTo(sim: Sim, u: Unit, tx: number, tz: number) {
  const w = sim.world;
  if (!u.path || u.pathNav !== sim.navVersion || sim.tick % 60 === u.id % 60) {
    if (sim.pathCalls > 60) return;
    sim.pathCalls++;
    u.path = sim.pf.find(u.x, u.z, w.tileAt(tx, tz), 6000, 3);
    u.pathI = 0; u.pathNav = sim.navVersion;
    if (!u.path) {
      // no road there: push straight on
      stepToward(w, u, tx, tz, SPECIES[u.sp].speed * TICK_DT, false);
      return;
    }
  }
  const p = u.path;
  if (u.pathI >= p.length) { u.path = null; return; }
  const wt = p[u.pathI];
  const wx = (wt % w.W) + 0.5, wz = ((wt / w.W) | 0) + 0.5;
  const sp = SPECIES[u.sp].speed * TICK_DT / Math.sqrt(w.walkCost(Math.max(0, w.tileAt(u.x, u.z))));
  const moved = stepToward(w, u, wx, wz, sp, false);
  if (Math.hypot(wx - u.x, wz - u.z) < 0.3) u.pathI++;
  if (moved > 1e-5) {
    const want = Math.atan2(wx - u.x, wz - u.z);
    let dd = want - u.dir; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2;
    u.dir += dd * 0.3;
  } else if (++u.stuck > 20) { u.path = null; u.stuck = 0; }
}

const CRUISE = 5;
function planeTick(sim: Sim, u: Unit) {
  u.anim = Anim.Soar;
  const kid = u.kingdom;
  const k = sim.kingdoms.get(kid);
  const home = sim.buildings.get(u.home);
  const v = sim.villages.get(u.village);
  // altitude: climb out after take-off
  const ammo = u.carryAmt; // bombs dropped this sortie
  let tx: number, tz: number;
  const tv = k && k.wars.length && k.target >= 0 ? sim.villages.get(k.target) : undefined;
  if (tv && ammo < 6) { tx = tv.cx + 0.5; tz = tv.cz + 0.5; }
  else if (kid < 0) {
    let best: Village | null = null, bd = 1e9;
    for (const vv of sim.villages.values()) { if (!vv.alive) continue; const d = (vv.cx - u.x) ** 2 + (vv.cz - u.z) ** 2; if (d < bd) { bd = d; best = vv; } }
    if (!best) { tx = u.x + Math.sin(u.dir) * 5; tz = u.z + Math.cos(u.dir) * 5; }
    else { tx = best.cx + 0.5; tz = best.cz + 0.5; }
  } else {
    // patrol circle over home; rearm
    const cx = home ? home.x + 1.5 : v ? v.cx : u.x, cz = home ? home.z + 1.5 : v ? v.cz : u.z;
    const a = sim.tick * 0.02 + u.id;
    tx = cx + Math.cos(a) * 7; tz = cz + Math.sin(a) * 7;
    if (Math.hypot(u.x - cx, u.z - cz) < 9) u.carryAmt = 0;
  }
  u.y += (CRUISE - u.y) * 0.05;
  const sp = SPECIES[u.sp].speed * TICK_DT;
  const want = Math.atan2(tx - u.x, tz - u.z);
  let dd = want - u.dir; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2;
  u.dir += Math.max(-0.09, Math.min(0.09, dd));
  const nx = u.x + Math.sin(u.dir) * sp, nz = u.z + Math.cos(u.dir) * sp;
  if (sim.world.tileAt(nx, nz) >= 0) { u.x = nx; u.z = nz; } else u.dir += 0.5;
  // bombing run
  if (u.cd <= 0 && (tv || kid < 0)) {
    const e = findEnemy(sim, u.x, u.z, 2.5, kid);
    const b = e ? null : enemyBuilding(sim, u.x, u.z, 2.5, kid);
    if (e || b || (kid < 0 && sim.rng.chance(0.05))) {
      fireShell(sim, u.x, u.z, u.y, u.x + Math.sin(u.dir) * 1.2, u.z + Math.cos(u.dir) * 1.2, SPECIES[Sp.Plane].dmg, 1.8, kid, 'bomb');
      u.cd = 8; u.carryAmt = ammo + 1;
    }
  }
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


