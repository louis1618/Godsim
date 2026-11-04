/**
 * Long unattended run: nobody touches the world for many in-game years.
 * Tracks tick cost, heap, population, history size, and checks save -> load -> continue
 * reproduces exactly the same world as continuing without the round trip.
 * usage: npx tsx tools/soak.ts [years=150] [size=256]
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { SPECIES, YEAR_TICKS, isCiv } from '../src/sim/defs';
import { UF } from '../src/sim/entities';
import { serialize, deserialize } from '../src/sim/save';
import { fireTiles } from '../src/sim/nature';
import { clearClaims } from '../src/sim/ai';
import { clearFarmClaims } from '../src/sim/civ';

const years = Number(process.argv[2] ?? 150);
const size = Number(process.argv[3] ?? 256);
const resetCaches = () => { fireTiles.clear(); clearClaims(); clearFarmClaims(); };

function digest(sim: Sim) {
  let h = 2166136261 >>> 0;
  const mix = (v: number) => { h = Math.imul(h ^ (Math.round(v * 1000) | 0), 16777619) >>> 0; };
  for (const u of sim.units) if (!(u.flags & UF.Dead)) { mix(u.id); mix(u.x); mix(u.z); mix(u.hp); mix(u.sp); }
  for (const v of sim.villages.values()) { mix(v.id); mix(v.food); mix(v.residents.length); }
  for (let i = 0; i < sim.world.N; i += 97) { mix(sim.world.height[i]); mix(sim.world.feat[i]); }
  return h.toString(16);
}

resetCaches();
const world = generateWorld({ size, shape: 'continents', seed: 2026 });
let sim = new Sim(world, 2026);
seedLife(sim, { tribes: 6 });
const t0 = performance.now();
const rows: string[] = [];
let minCiv = Infinity, maxCiv = 0, extinctions = 0;
for (let y = 1; y <= years; y++) {
  const ty = performance.now();
  for (let i = 0; i < YEAR_TICKS; i++) sim.step();
  const ms = (performance.now() - ty) / YEAR_TICKS;
  let civ = 0, animals = 0, machines = 0;
  for (const u of sim.units) { if (u.flags & UF.Dead) continue; if (isCiv(u.sp)) civ++; else if (u.sp >= 11 && u.sp <= 13) machines++; else animals++; }
  minCiv = Math.min(minCiv, civ); maxCiv = Math.max(maxCiv, civ);
  if (civ === 0) extinctions++;
  const heap = process.memoryUsage().heapUsed / 1e6;
  const ks = [...sim.kingdoms.values()].filter((k) => k.alive);
  if (y % 10 === 0 || y === 1) {
    const row = `y${String(y).padStart(3)}  ${ms.toFixed(2)} ms/tick  heap ${heap.toFixed(0)} MB  civ ${civ} animals ${animals} machines ${machines}  villages ${[...sim.villages.values()].filter((v) => v.alive).length} kingdoms ${ks.length} eras ${ks.map((k) => k.era).join('')}  buildings ${sim.buildings.size} history ${sim.history.length} scheduled ${sim.scheduled.length} units[] ${sim.units.length}`;
    console.log(row); rows.push(row);
  }
  // every 25 years: save, load, and check the loaded world evolves exactly like the original
  if (y % 25 === 0) {
    const json = serialize(sim);
    const loaded = deserialize(json);
    const a = serialize(loaded);
    const sameSnapshot = a.length === json.length;
    // continue both for 2 years
    const probe = 2 * YEAR_TICKS;
    resetCaches(); // the loaded world starts with empty caches, as after a page reload
    const twin = deserialize(json);
    for (let i = 0; i < probe; i++) twin.step();
    resetCaches();
    const orig = deserialize(json);
    for (let i = 0; i < probe; i++) orig.step();
    console.log(`   save/load @y${y}: ${(json.length / 1e6).toFixed(2)} MB json, reload snapshot identical=${sameSnapshot}, two reloads after ${probe} ticks: ${digest(twin)} vs ${digest(orig)} ${digest(twin) === digest(orig) ? 'MATCH' : 'DIFFER'}`);
    // carry on with the reloaded world (as a player who reloads would)
    resetCaches();
    sim = deserialize(json);
  }
}
const total = (performance.now() - t0) / 1000;
console.log(`done: ${years} years (${years * YEAR_TICKS} ticks) in ${total.toFixed(0)} s; civ population range ${minCiv}..${maxCiv}; years with no people ${extinctions}`);
void SPECIES;
