/**
 * Destroyed buildings: salvage, clearing, rebuilding, repair, decay (headless).
 *  1. a destroyed house leaves rubble holding part of its materials; builders carry them home,
 *     the plot is cleared and the house is rebuilt on the same spot
 *  2. a damaged building is repaired
 *  3. rebuilding waits while the town is short of materials, and while it is under attack
 *  4. rubble out in the wilderness weathers away by itself
 *  5. over decades of war and disaster no ruin is left lying for ever
 * Usage: npx tsx tools/ruintest.ts
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { Bk, YEAR_TICKS, BUILDINGS } from '../src/sim/defs';
import type { Building, Village } from '../src/sim/entities';
import { buildingState, ruinLeft, placeBuilding, clearFarmClaims } from '../src/sim/civ';
import { clearClaims } from '../src/sim/ai';
import { fireTiles } from '../src/sim/nature';

let fails = 0;
const check = (name: string, ok: boolean, info: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${info}`); if (!ok) fails++; };
function make(seed: number, years = 5) {
  fireTiles.clear(); clearClaims(); clearFarmClaims();
  const w = generateWorld({ size: 160, shape: 'pangaea', seed });
  const sim = new Sim(w, seed); seedLife(sim, { tribes: 3 });
  sim.laws.disasters = false; sim.laws.wars = false;
  for (let i = 0; i < YEAR_TICKS * years; i++) sim.step();
  return sim;
}
const adultsOf = (sim: Sim, v: Village) => v.residents.filter((id) => { const u = sim.getUnit(id); return u && u.age >= 9; }).length;
const biggest = (sim: Sim) => [...sim.villages.values()].filter((v) => v.alive).sort((a, b) => adultsOf(sim, b) - adultsOf(sim, a))[0];
const houseOf = (sim: Sim, v: Village) => v.buildings.map((id) => sim.buildings.get(id)!).find((b) => b && b.alive && b.kind === Bk.House && b.progress >= 1)!;
const ruinAt = (sim: Sim, x: number, z: number) => [...sim.buildings.values()].find((b) => b.kind === Bk.Ruin && b.x === x && b.z === z);
const liveAt = (sim: Sim, x: number, z: number) => [...sim.buildings.values()].find((b) => b.kind !== Bk.Ruin && b.alive && b.x === x && b.z === z);

// 1. destroy -> rubble -> salvage -> clear -> rebuild
{
  const sim = make(501), v = biggest(sim);
  const h = houseOf(sim, v), { x, z } = h;
  v.wood = Math.max(v.wood, 30); v.stone = Math.max(v.stone, 10);
  const wood0 = v.wood;
  sim.damageBuilding(h, 1e6);
  const r = ruinAt(sim, x, z)!;
  const sv0 = r ? [...r.salvage!] : [];
  const st0 = r ? buildingState(sim, r) : 'none';
  let clearedAt = -1, placedAt = -1, doneAt = -1, sawClearing = false, t0 = sim.tick;
  for (let i = 0; i < YEAR_TICKS * 4 && doneAt < 0; i++) {
    sim.step();
    const rr = ruinAt(sim, x, z);
    if (rr && buildingState(sim, rr) === 'clearing') sawClearing = true;
    if (!rr && clearedAt < 0) clearedAt = sim.tick - t0;
    const nb = liveAt(sim, x, z);
    if (nb && placedAt < 0) placedAt = sim.tick - t0;
    if (nb && nb.progress >= 1) doneAt = sim.tick - t0;
  }
  const nb = liveAt(sim, x, z);
  check('destroyed house: rubble holds materials and is queued for rebuilding', !!r && sv0[3] > 0 && st0 === 'rebuildQueued', `rubble holds wood ${sv0[0]}, stone ${sv0[1]} (house cost wood ${BUILDINGS[Bk.House].cost.wood}); state ${st0}`);
  check('builders salvage the rubble and clear the plot', sawClearing && clearedAt > 0 && (sim.stats.salvaged ?? 0) >= sv0[3], `seen being cleared ${sawClearing}; salvaged ${sim.stats.salvaged} units; plot clear after ${(clearedAt / 10).toFixed(0)} s (town wood then ${wood0.toFixed(0)})`);
  check('the house is rebuilt on the same plot', !!nb && nb.kind === Bk.House && doneAt > 0, `new site after ${(placedAt / 10).toFixed(0)} s, finished after ${(doneAt / 10).toFixed(0)} s; rebuilt ${sim.stats.rebuilt}`);
}
// 2. repair
{
  const sim = make(502), v = biggest(sim);
  const h = houseOf(sim, v);
  sim.damageBuilding(h, h.maxHp * 0.6);
  const hp0 = h.hp, st = buildingState(sim, h);
  let t = 0;
  for (; t < YEAR_TICKS * 3 && h.alive && h.hp < h.maxHp; t++) sim.step();
  check('a damaged building is repaired', st === 'damaged' && h.alive && h.hp >= h.maxHp, `hp ${hp0.toFixed(0)}/${h.maxHp} (${st}) -> ${h.hp.toFixed(0)} after ${(t / 10).toFixed(0)} s; repairs done ${sim.stats.repaired}`);
}
// 3. delays: shortage, then attack
{
  const sim = make(503), v = biggest(sim);
  const h = houseOf(sim, v), { x, z } = h;
  sim.damageBuilding(h, 1e6);
  // wait for the plot to be cleared while the town has nothing to build with
  let cleared = false;
  for (let i = 0; i < YEAR_TICKS * 3 && !cleared; i++) { v.wood = 0; sim.step(); cleared = !ruinAt(sim, x, z); }
  let early = false;
  for (let i = 0; i < 300; i++) { v.wood = 0; sim.step(); if (liveAt(sim, x, z)) early = true; }
  const queued = (v.rebuilds ?? []).some((r) => r.x === x && r.z === z);
  // materials arrive, but the town is under attack
  const k = sim.kingdoms.get(v.kingdom)!; const foe = [...sim.kingdoms.values()].find((o) => o.alive && o !== k)!;
  k.wars.push(foe.id); foe.wars.push(k.id);
  let underFire = false;
  for (let i = 0; i < 300; i++) { v.wood = 60; v.stone = 30; v.lastAttacked = sim.tick; sim.step(); if (liveAt(sim, x, z)) underFire = true; }
  // the attack ends
  k.wars = k.wars.filter((id) => id !== foe.id); foe.wars = foe.wars.filter((id) => id !== k.id);
  let after = -1;
  for (let i = 0; i < YEAR_TICKS && after < 0; i++) { v.wood = Math.max(v.wood, 60); sim.step(); if (liveAt(sim, x, z)) after = i; }
  check('rebuilding waits for materials and for the attack to end', cleared && !early && queued && !underFire && after >= 0, `plot cleared ${cleared}; rebuilt with no wood ${early} (still queued ${queued}); rebuilt while under attack ${underFire}; started ${(after / 10).toFixed(0)} s after the attack ended`);
}
// 4. wilderness rubble weathers away
{
  const sim = make(504, 1);
  const w = sim.world;
  // a lone building far from any town, then destroyed
  let spot: [number, number] | null = null;
  for (let i = 0; i < 4000 && !spot; i++) { const x = sim.rng.int(6, w.W - 8), z = sim.rng.int(6, w.H - 8); let ok = true; for (let dz = -1; dz <= 2 && ok; dz++) for (let dx = -1; dx <= 2; dx++) { const t = w.idx(x + dx, z + dz); if (!w.walkable(t) || w.bld[t] >= 0 || w.owner[t] >= 0) { ok = false; break; } } if (ok && [...sim.villages.values()].every((v) => Math.hypot(v.cx - x, v.cz - z) > v.radius + 14)) spot = [x, z]; }
  const b = placeBuilding(sim, null, Bk.House, spot![0], spot![1], 0, 1); b.hp = b.maxHp;
  sim.damageBuilding(b, 1e6);
  const r = ruinAt(sim, spot![0], spot![1])!;
  const left: number[] = [];
  let gone = -1;
  for (let y = 1; y <= 10 && gone < 0; y++) { for (let i = 0; i < YEAR_TICKS; i++) sim.step(); const rr = ruinAt(sim, spot![0], spot![1]); if (!rr) gone = y; else left.push(ruinLeft(rr)); }
  check('rubble in the wilderness weathers away', !!r && gone > 0 && gone <= 9, `materials left year by year: ${left.join(', ')}; gone in year ${gone}; state at first ${r ? 'salvageable' : '-'}`);
}
// 5. decades of war and disaster
{
  fireTiles.clear(); clearClaims(); clearFarmClaims();
  const w = generateWorld({ size: 192, shape: 'continents', seed: 505 });
  const sim = new Sim(w, 505); seedLife(sim, { tribes: 6 });
  let made = 0, maxAge = 0, peak = 0;
  const seen = new Set<number>();
  for (let y = 1; y <= 40; y++) {
    for (let i = 0; i < YEAR_TICKS; i++) sim.step();
    let n = 0;
    for (const b of sim.buildings.values()) if (b.kind === Bk.Ruin) { n++; if (!seen.has(b.id)) { seen.add(b.id); made++; } maxAge = Math.max(maxAge, (sim.tick - b.born) / YEAR_TICKS); }
    peak = Math.max(peak, n);
  }
  let now = 0; for (const b of sim.buildings.values()) if (b.kind === Bk.Ruin) now++;
  check('40 years: no ruin lies for ever', made > 0 && maxAge <= 8.3, `ruins seen ${made}, most at once ${peak}, standing now ${now}, oldest ever ${maxAge.toFixed(1)} years; salvaged ${sim.stats.salvaged} units, plots cleared ${sim.stats.cleared}, rebuilt ${sim.stats.rebuilt}, repairs ${sim.stats.repaired}`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
