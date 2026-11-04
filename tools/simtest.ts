import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { SPECIES, YEAR_TICKS } from '../src/sim/defs';
import { UF } from '../src/sim/entities';

const seed = Number(process.argv[2] ?? 12345);
const years = Number(process.argv[3] ?? 20);
const world = generateWorld({ size: Number(process.argv[5] ?? 192), shape: 'continents', seed });
const sim = new Sim(world, seed);
seedLife(sim, { tribes: Number(process.argv[4] ?? 4) });
sim.onHistory = (h) => console.log(`  [y${(h.tick / YEAR_TICKS).toFixed(1)}] ${h.type} ${h.text}`);
const t0 = performance.now();
let maxTick = 0;
for (let y = 0; y < years; y++) {
  const ty = performance.now();
  for (let i = 0; i < YEAR_TICKS; i++) { const a = performance.now(); sim.step(); maxTick = Math.max(maxTick, performance.now() - a); }
  const bySp: Record<string, number> = {};
  for (const u of sim.units) if (!(u.flags & UF.Dead)) bySp[SPECIES[u.sp].key] = (bySp[SPECIES[u.sp].key] ?? 0) + 1;
  const vs = [...sim.villages.values()].filter((v) => v.alive);
  const ks = [...sim.kingdoms.values()].filter((k) => k.alive);
  console.log(`year ${y + 1}: units=${sim.units.length} ${JSON.stringify(bySp)} villages=${vs.length} kingdoms=${ks.length} buildings=${sim.buildings.size} wars=${ks.reduce((a, k) => a + k.wars.length, 0) / 2} ms/tick=${((performance.now() - ty) / YEAR_TICKS).toFixed(2)} max=${maxTick.toFixed(1)}`);
  console.log('   ' + vs.map((v) => `${v.name}(L${v.level} p${v.residents.length} f${v.food.toFixed(0)} w${v.wood.toFixed(0)} s${v.stone.toFixed(0)} b${v.buildings.length})`).join(' '));
  const jobs: Record<number, number> = {}; const tasks: Record<string, number> = {};
  for (const u of sim.units) if (u.sp <= 3) { jobs[u.job] = (jobs[u.job] ?? 0) + 1; tasks[u.task?.k ?? 'none'] = (tasks[u.task?.k ?? 'none'] ?? 0) + 1; }
  console.log('   jobs', JSON.stringify(jobs), 'tasks', JSON.stringify(tasks));
  maxTick = 0;
}
console.log('total s', ((performance.now() - t0) / 1000).toFixed(1));
const counts: Record<string, number> = {};
for (const h of sim.history) counts[h.type] = (counts[h.type] ?? 0) + 1;
console.log('history', JSON.stringify(counts));
let warriors = 0, marching = 0, razing = 0;
for (const u of sim.units) { if (u.job === 6) warriors++; if (u.task?.k === 'march') marching++; if (u.task?.k === 'raze') razing++; }
console.log('warriors', warriors, 'marching', marching, 'razing', razing, 'stats', JSON.stringify(sim.stats));
