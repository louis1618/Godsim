/**
 * Tanks and bombers (headless): the state machine, stuck recovery and the old failure cases.
 *  1. peace: a tank patrols its town and rests in turns; it is never stalled while trying to move
 *  2. war: a tank drives to the enemy town, gets in range and destroys buildings
 *  3. unreachable target (another landmass): it does not push against the shore; the target is
 *     crossed off and the tank goes back to patrolling
 *  4. boxed in by walls: stuck recovery runs a bounded number of times and the tank ends up resting, not spinning
 *  5. target lost (peace is made on the way): the tank turns for home
 *  6. peace: a plane is parked on the ground between patrol flights (no endless circling)
 *  7. war: a bomber makes repeated passes over the town, goes home out of bombs, rearms and returns
 *  8. a target inside the turning circle is still bombed (fly on, come round) instead of orbited for ever
 *  9. save / load in the middle of all this replays identically
 * 10. two kingdoms' machines and some rogues, ten minutes: no tank stalls, no plane circles one spot
 * Usage: npx tsx tools/vehicletest.ts
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { Sp, Bk, YEAR_TICKS, Mat } from '../src/sim/defs';
import { UF } from '../src/sim/entities';
import type { Unit, Village } from '../src/sim/entities';
import { createKingdom, declareWar, makePeace, placeBuilding, clearFarmClaims } from '../src/sim/civ';
import { spawnVehicle, machineDebug, machOpts, MS, MS_NAME } from '../src/sim/vehicles';
import { serialize, deserialize } from '../src/sim/save';
import { clearClaims } from '../src/sim/ai';
import { fireTiles } from '../src/sim/nature';

let fails = 0;
const check = (name: string, ok: boolean, info: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${info}`); if (!ok) fails++; };
function make(seed: number, years = 5, shape: 'pangaea' | 'continents' | 'archipelago' = 'pangaea') {
  fireTiles.clear(); clearClaims(); clearFarmClaims();
  const w = generateWorld({ size: 192, shape, seed });
  const sim = new Sim(w, seed); seedLife(sim, { tribes: 4 });
  sim.laws.disasters = false; sim.laws.wars = false;
  for (let i = 0; i < YEAR_TICKS * years; i++) sim.step();
  return sim;
}
const towns = (sim: Sim) => [...sim.villages.values()].filter((v) => v.alive).sort((a, b) => b.buildings.length - a.buildings.length);
const st = (u: Unit) => (u.task && u.task.k === 'mach' ? u.task.st : -1);
const MOVING = new Set<number>([MS.Patrol, MS.Move, MS.Return]);
/** Run and watch one machine: time per state, distance, longest stall while in a moving state, recoveries. */
function watch(sim: Sim, u: Unit, ticks: number, each?: (i: number) => void) {
  const per: Record<string, number> = {}; let dist = 0, stall = 0, worstStall = 0, rec = 0, lastRec = 0;
  const visited = new Set<string>();
  for (let i = 0; i < ticks && !(u.flags & UF.Dead); i++) {
    const x = u.x, z = u.z;
    sim.step(); each?.(i);
    const s = st(u); per[MS_NAME[s] ?? '?'] = (per[MS_NAME[s] ?? '?'] ?? 0) + 1;
    const d = Math.hypot(u.x - x, u.z - z); dist += d;
    if (MOVING.has(s) && d < 0.01) { stall++; worstStall = Math.max(worstStall, stall); } else stall = 0;
    const m = u.task && u.task.k === 'mach' ? u.task : null;
    if (m && m.recT !== lastRec) { lastRec = m.recT; rec++; }
    visited.add(`${Math.round(u.x / 2)},${Math.round(u.z / 2)}`);
  }
  return { per, dist, worstStall, rec, cells: visited.size };
}
const fmt = (per: Record<string, number>) => Object.entries(per).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / 10).toFixed(0)}s`).join(', ');
const hpOf = (sim: Sim, v: Village) => v.buildings.reduce((a, id) => a + (sim.buildings.get(id)?.hp ?? 0), 0);

// 1. peace-time tank
{
  const sim = make(601), v = towns(sim)[0], k = sim.kingdoms.get(v.kingdom)!;
  const tank = spawnVehicle(sim, Sp.Tank, v.cx + 3.5, v.cz + 3.5, k.id, v.id);
  const r = watch(sim, tank, 1800);
  const away = Math.hypot(tank.x - v.cx, tank.z - v.cz);
  check('peace: the tank patrols and rests, never stalls', r.dist > 40 && r.worstStall <= 50 && (r.per['Patrol'] ?? 0) > 200 && (r.per['Idle'] ?? 0) > 200 && away < v.radius + 8,
    `3 min: drove ${r.dist.toFixed(0)} tiles over ${r.cells} map cells; ${fmt(r.per)}; longest stall while moving ${(r.worstStall / 10).toFixed(1)} s; recoveries ${r.rec}; ends ${away.toFixed(0)} tiles from the town centre (radius ${v.radius})`);
}
// 2. war: reach and destroy
{
  const sim = make(602);
  const ts = towns(sim);
  let a = ts[0], b = ts[1], bd = 1e9;
  for (const x of ts) for (const y of ts) { if (x.kingdom === y.kingdom) continue; const w = sim.world; if (w.island[w.idx(x.cx, x.cz)] !== w.island[w.idx(y.cx, y.cz)]) continue; const d = Math.hypot(x.cx - y.cx, x.cz - y.cz); if (d < bd && d > 25) { bd = d; a = x; b = y; } }
  const ka = sim.kingdoms.get(a.kingdom)!, kb = sim.kingdoms.get(b.kingdom)!;
  sim.laws.wars = true; declareWar(sim, ka, kb, true);
  const tank = spawnVehicle(sim, Sp.Tank, a.cx + 3.5, a.cz + 3.5, ka.id, a.id);
  tank.maxHp = tank.hp = 5000; // the scenario is about getting there and shooting, not about surviving
  const hp0 = hpOf(sim, b), n0 = b.buildings.length;
  let arrived = -1, shots = 0;
  const r = watch(sim, tank, 2400, (i) => { ka.target = b.id; if (!ka.wars.includes(kb.id)) declareWar(sim, ka, kb, true); if (arrived < 0 && Math.hypot(tank.x - b.cx, tank.z - b.cz) < b.radius + 9) arrived = i; if (st(tank) === MS.Attack && tank.cd === 22) shots++; });
  const hp1 = hpOf(sim, b);
  check('war: the tank reaches the enemy town and shells it', arrived > 0 && shots >= 5 && (hp1 < hp0 * 0.9 || b.buildings.length < n0 || !b.alive) && r.worstStall <= 50,
    `${bd.toFixed(0)} tiles away: in range after ${(arrived / 10).toFixed(0)} s; ${shots} aimed shots; town building hp ${hp0.toFixed(0)} -> ${hp1.toFixed(0)}, buildings ${n0} -> ${b.buildings.length}; ${fmt(r.per)}; longest stall ${(r.worstStall / 10).toFixed(1)} s; recoveries ${r.rec}`);
  // 5. target lost on the way: peace
  const tank2 = spawnVehicle(sim, Sp.Tank, a.cx + 4.5, a.cz + 2.5, ka.id, a.id);
  let was = false;
  for (let i = 0; i < 150; i++) { ka.target = b.id; if (!ka.wars.includes(kb.id)) declareWar(sim, ka, kb, true); sim.step(); if (st(tank2) === MS.Move) was = true; }
  const out = Math.hypot(tank2.x - a.cx, tank2.z - a.cz);
  sim.laws.wars = false; makePeace(sim, ka, kb); for (const o of sim.kingdoms.values()) for (const p of sim.kingdoms.values()) if (o !== p && o.wars.includes(p.id)) makePeace(sim, o, p);
  const r2 = watch(sim, tank2, 900);
  const back = Math.hypot(tank2.x - a.cx, tank2.z - a.cz);
  check('target lost (peace on the way): the tank goes home', was && back < a.radius + 8 && r2.worstStall <= 50, `was advancing ${was}, ${out.toFixed(0)} tiles out when peace came; 90 s later ${back.toFixed(0)} tiles from home, state ${machineDebug(sim, tank2)?.state} (${machineDebug(sim, tank2)?.last}); ${fmt(r2.per)}`);
}
// 3. unreachable target
{
  const sim = make(603);
  const w = sim.world;
  const ts = towns(sim);
  let a = ts[0], b = ts[1], bd = 1e9;
  for (const x of ts) for (const y of ts) { if (x.kingdom === y.kingdom) continue; const d = Math.hypot(x.cx - y.cx, x.cz - y.cz); if (d < bd && d > 30) { bd = d; a = x; b = y; } }
  // a moat all the way round the home town: the enemy town is now on another landmass
  const R = a.radius + 7;
  for (let dz = -R - 3; dz <= R + 3; dz++) for (let dx = -R - 3; dx <= R + 3; dx++) {
    const d = Math.hypot(dx, dz); if (d < R || d > R + 3 || !w.inside(a.cx + dx, a.cz + dz)) continue;
    const t = w.idx(a.cx + dx, a.cz + dz); w.height[t] = -2; w.water[t] = 0; w.setFeat(t, 0, 0);
    const bb = sim.buildingAt(t); if (bb) sim.removeBuilding(bb, false);
  }
  w.markTerrain(a.cx - R - 4, a.cz - R - 4, a.cx + R + 4, a.cz + R + 4);
  const ka = sim.kingdoms.get(a.kingdom)!, kb = sim.kingdoms.get(b.kingdom)!;
  sim.laws.wars = true; declareWar(sim, ka, kb, true);
  const tank = spawnVehicle(sim, Sp.Tank, a.cx + 3.5, a.cz + 3.5, ka.id, a.id);
  // old behaviour to beat: "no road there: push straight on" into the water
  let shore = 0;
  const r = watch(sim, tank, 1500, () => { ka.target = b.id; if (!ka.wars.includes(kb.id)) declareWar(sim, ka, kb, true); let wet = false; for (let k = 0; k < 8; k++) { const t = w.tileAt(tank.x + Math.cos(k * 0.785) * 1.2, tank.z + Math.sin(k * 0.785) * 1.2); if (t >= 0 && w.isWater(t)) wet = true; } if (wet && MOVING.has(st(tank))) shore++; });
  const d = machineDebug(sim, tank)!;
  check('unreachable target: no pushing against the shore', r.worstStall <= 50 && (r.per['MoveToTarget'] ?? 0) < 100 && Math.hypot(tank.x - a.cx, tank.z - a.cz) < R && r.dist > 30,
    `target town beyond a moat: longest stall while moving ${(r.worstStall / 10).toFixed(1)} s, seconds heading for the unreachable town ${((r.per['MoveToTarget'] ?? 0) / 10).toFixed(0)} (beside the water while patrolling ${(shore / 10).toFixed(0)}), drove ${r.dist.toFixed(0)} tiles; ${fmt(r.per)}; ends ${Math.hypot(tank.x - a.cx, tank.z - a.cz).toFixed(0)} tiles from home in ${d.state} (${d.last})`);
}
// 4. boxed in
{
  const sim = make(604), w = sim.world;
  const v = towns(sim)[0], k = sim.kingdoms.get(v.kingdom)!;
  // a pen of lava (not walkable) around a 3x3 patch of ground far from the town's buildings
  let cx = -1, cz = -1;
  for (let i = 0; i < 4000 && cx < 0; i++) { const x = sim.rng.int(8, w.W - 9), z = sim.rng.int(8, w.H - 9); let ok = true; for (let dz = -3; dz <= 3 && ok; dz++) for (let dx = -3; dx <= 3; dx++) { const t = w.idx(x + dx, z + dz); if (!w.walkable(t) || w.bld[t] >= 0) { ok = false; break; } } if (ok) { cx = x; cz = z; } }
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === 2) { const t = w.idx(cx + dx, cz + dz); w.mat[t] = Mat.Lava; }
  w.markTerrain(cx - 3, cz - 3, cx + 3, cz + 3);
  const tank = spawnVehicle(sim, Sp.Tank, cx + 0.5, cz + 0.5, k.id, v.id);
  const changes: string[] = []; let n = 0;
  machOpts.trace = (u, from, to, why) => { if (u === tank) { n++; if (changes.length < 400) changes.push(`${MS_NAME[to]}${why ? ':' + why : ''}`); } };
  const r = watch(sim, tank, 3000);
  machOpts.trace = null;
  const idleShare = ((r.per['Idle'] ?? 0)) / 3000;
  const inPen = Math.max(Math.abs(tank.x - cx - 0.5), Math.abs(tank.z - cz - 0.5)) < 2;
  check('boxed in: bounded recovery, then rest (no endless loop)', r.worstStall <= 50 && n < 400 && idleShare > 0.5 && inPen,
    `5 min inside a lava pen: ${n} state changes, ${r.rec} recoveries, resting ${(idleShare * 100).toFixed(0)}% of the time; longest stall while trying to move ${(r.worstStall / 10).toFixed(1)} s; reasons seen: ${[...new Set(changes.map((c) => c.split(':')[1]).filter(Boolean))].slice(0, 6).join(' / ')}`);
}
// 6. peace-time plane
{
  const sim = make(606), v = towns(sim)[0], k = sim.kingdoms.get(v.kingdom)!;
  const f = placeBuilding(sim, v, Bk.House, v.cx + 4, v.cz + 4, v.race, 1); f.hp = f.maxHp;
  const plane = spawnVehicle(sim, Sp.Plane, v.cx + 6.5, v.cz + 2.5, k.id, v.id);
  let air = 0, flights = 0, wasAir = false, maxOut = 0;
  const r = watch(sim, plane, 3600, () => { const up = plane.y > 0.5; if (up) air++; if (up && !wasAir) flights++; wasAir = up; maxOut = Math.max(maxOut, Math.hypot(plane.x - v.cx, plane.z - v.cz)); });
  check('peace: the plane is parked between patrol flights', flights >= 2 && air / 3600 < 0.6 && (r.per['Landed'] ?? 0) > 900 && plane.hp > 0,
    `6 min: ${flights} flights, airborne ${(air / 36).toFixed(0)}% of the time, farthest ${maxOut.toFixed(0)} tiles from town (radius ${v.radius}); ${fmt(r.per)}`);
}
// 7-8. bomber at war
{
  const sim = make(607);
  const ts = towns(sim);
  let a = ts[0], b = ts[1], bd = 1e9;
  for (const x of ts) for (const y of ts) { if (x.kingdom === y.kingdom) continue; const d = Math.hypot(x.cx - y.cx, x.cz - y.cz); if (d < bd && d > 30) { bd = d; a = x; b = y; } }
  const ka = sim.kingdoms.get(a.kingdom)!, kb = sim.kingdoms.get(b.kingdom)!;
  ka.era = 4; sim.laws.wars = true; declareWar(sim, ka, kb, true);
  const plane = spawnVehicle(sim, Sp.Plane, a.cx + 5.5, a.cz + 2.5, ka.id, a.id);
  plane.maxHp = plane.hp = 5000;
  const hp0 = hpOf(sim, b), n0 = b.buildings.length;
  let bombs = 0, passes = 0, landings = 0, prev = st(plane), sorties = 0, orbit = 0, worstOrbit = 0;
  const r = watch(sim, plane, 3600, () => {
    ka.target = b.id; if (!ka.wars.includes(kb.id)) declareWar(sim, ka, kb, true);
    bombs += sim.fx.filter((e) => e.t === 'bombdrop').length; sim.fx.length = 0;
    const s = st(plane);
    if (s !== prev) { if (s === MS.Egress && prev === MS.Attack) passes++; if (s === MS.Landed) landings++; if (prev === MS.Landed) sorties++; prev = s; }
    // "circling the target": airborne within 9 tiles of the town centre without dropping anything
    if (plane.y > 1 && Math.hypot(plane.x - b.cx, plane.z - b.cz) < 9 && (s === MS.Move || s === MS.Attack)) { orbit++; worstOrbit = Math.max(worstOrbit, orbit); } else orbit = 0;
  });
  const hp1 = hpOf(sim, b);
  check('war: repeated bombing passes, home to rearm, back again', bombs >= 12 && passes >= 4 && landings >= 2 && sorties >= 2 && worstOrbit < 200 && (hp1 < hp0 * 0.85 || b.buildings.length < n0 || !b.alive),
    `6 min, town ${bd.toFixed(0)} tiles away: ${bombs} bombs in ${passes} passes, ${sorties} sorties, ${landings} landings to rearm; longest time near the target without finishing a pass ${(worstOrbit / 10).toFixed(0)} s; town hp ${hp0.toFixed(0)} -> ${hp1.toFixed(0)}, buildings ${n0} -> ${b.buildings.length}; ${fmt(r.per)}`);
  // 8. target inside the turning circle, flying across it
  const p2 = spawnVehicle(sim, Sp.Plane, b.cx + 3, b.cz, ka.id, a.id);
  p2.y = 5; p2.dir = 0; p2.maxHp = p2.hp = 5000;
  let first = -1, b2 = 0;
  for (let i = 0; i < 600 && first < 0; i++) { ka.target = b.id; if (!ka.wars.includes(kb.id)) declareWar(sim, ka, kb, true); const c0 = p2.carryAmt; sim.step(); if (p2.carryAmt > c0) { b2++; first = i; } }
  check('a target inside the turning circle is bombed, not orbited', first >= 0 && first < 400, `started 3 tiles beside the town centre, flying past it: first bomb after ${(first / 10).toFixed(0)} s (${machineDebug(sim, p2)?.last})`);
  // 9. save / load mid-action
  const json = serialize(sim);
  const digest = (s: Sim) => { let h = 2166136261 >>> 0; const mix = (n: number) => { h ^= Math.round(n * 1000) | 0; h = Math.imul(h, 16777619) >>> 0; }; for (const u of s.units) { mix(u.id); mix(u.x); mix(u.z); mix(u.y); mix(u.hp); mix(u.task && u.task.k === 'mach' ? u.task.st : -1); } for (const bb of s.buildings.values()) mix(bb.hp); return h; };
  const A = deserialize(json), B = deserialize(json);
  for (let i = 0; i < 400; i++) { A.step(); B.step(); }
  const machines = A.units.filter((u) => u.sp === Sp.Tank || u.sp === Sp.Plane).length;
  check('save / load keeps machines mid-task and replays identically', digest(A) === digest(B) && machines >= 2 && A.units.filter((u) => u.task?.k === 'mach').length >= 2, `machines ${machines}, two reloads after 40 s: ${digest(A)} vs ${digest(B)}`);
}
// 10. many machines for a long time
{
  const sim = make(610);
  const ts = towns(sim);
  let a = ts[0], b = ts[1], bd = 1e9;
  for (const x of ts) for (const y of ts) { if (x.kingdom === y.kingdom) continue; const d = Math.hypot(x.cx - y.cx, x.cz - y.cz); if (d < bd && d > 25) { bd = d; a = x; b = y; } }
  const ka = sim.kingdoms.get(a.kingdom)!, kb = sim.kingdoms.get(b.kingdom)!;
  sim.laws.wars = true; declareWar(sim, ka, kb, true);
  const ms: Unit[] = [];
  for (const [v, k] of [[a, ka], [b, kb]] as const) {
    for (let i = 0; i < 4; i++) ms.push(spawnVehicle(sim, Sp.Tank, v.cx + 3.5 + i, v.cz + 4.5, k.id, v.id));
    for (let i = 0; i < 3; i++) ms.push(spawnVehicle(sim, Sp.Plane, v.cx - 3.5 - i, v.cz + 5.5, k.id, v.id));
  }
  const w = sim.world;
  for (let i = 0; i < 3; i++) { const t = ts[2 % ts.length]; const u = spawnVehicle(sim, i < 2 ? Sp.Tank : Sp.Plane, t.cx + 14 + i * 2, t.cz + 12, -1, -1); if (u.sp === Sp.Plane) u.y = 5; ms.push(u); }
  for (const u of ms) u.maxHp = u.hp = 1500;
  const stall = new Map<number, number>(), anchor = new Map<number, { x: number; z: number; t: number }>();
  let worstStall = 0, worstOrbit = 0, recs = 0, changes = 0, bombs = 0, shells = 0;
  machOpts.trace = (_u, _f, to) => { changes++; if (to === MS.Unstick) recs++; };
  const TICKS = 6000;
  for (let i = 0; i < TICKS; i++) {
    if (i < 3000 && !ka.wars.includes(kb.id)) declareWar(sim, ka, kb, true);   // five minutes of war, then whatever the kingdoms decide
    const pos = ms.map((u) => [u.x, u.z]);
    sim.step();
    bombs += sim.fx.filter((e) => e.t === 'bombdrop').length; shells += sim.fx.filter((e) => e.t === 'shell').length; sim.fx.length = 0;
    ms.forEach((u, j) => {
      if (u.flags & UF.Dead) return;
      const s = st(u), d = Math.hypot(u.x - pos[j][0], u.z - pos[j][1]);
      if (u.sp === Sp.Tank) { const n = MOVING.has(s) && d < 0.01 ? (stall.get(u.id) ?? 0) + 1 : 0; stall.set(u.id, n); worstStall = Math.max(worstStall, n); }
      else if (u.y > 1) {
        // a plane that stays within 7 tiles of one spot while trying to get somewhere is circling
        const an = anchor.get(u.id);
        if (!an || Math.hypot(u.x - an.x, u.z - an.z) > 7 || !(s === MS.Move || s === MS.Attack || s === MS.Return)) anchor.set(u.id, { x: u.x, z: u.z, t: i });
        else worstOrbit = Math.max(worstOrbit, i - an.t);
      } else anchor.delete(u.id);
    });
  }
  machOpts.trace = null;
  const alive = ms.filter((u) => !(u.flags & UF.Dead));
  const states: Record<string, number> = {}; for (const u of alive) { const n = MS_NAME[st(u)] ?? '?'; states[n] = (states[n] ?? 0) + 1; }
  void w;
  check('17 machines for 10 minutes: nobody stalls or circles', worstStall <= 50 && worstOrbit <= 300 && bombs + shells > 30,
    `two kingdoms at war (4 tanks + 3 planes each) and 3 rogues: ${shells} shells, ${bombs} bombs; longest tank stall while moving ${(worstStall / 10).toFixed(1)} s; longest a plane hung around one spot ${(worstOrbit / 10).toFixed(0)} s; ${recs} stuck recoveries in ${changes} state changes; ${alive.length}/${ms.length} still running: ${Object.entries(states).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
