/**
 * A/B tick timing on one fixed snapshot: the first run grows a world and stores it; every later run
 * (on whatever code is checked out) loads the same snapshot and times the same number of ticks.
 * Usage: npx tsx tools/abtick.ts <snapshot.json> [ticks] [size]
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { YEAR_TICKS } from '../src/sim/defs';
import { serialize, deserialize } from '../src/sim/save';
import * as ai from '../src/sim/ai';
if (process.env.NOLOD && (ai as any).lodOpts) (ai as any).lodOpts.enabled = false;

const file = process.argv[2], ticks = Number(process.argv[3] ?? 2000), size = Number(process.argv[4] ?? 256);
if (!existsSync(file)) {
  const w = generateWorld({ size, shape: 'continents', seed: 2024 });
  const sim = new Sim(w, 2024);
  seedLife(sim, { tribes: Math.round(size / 40) });
  for (let i = 0; i < YEAR_TICKS * 15; i++) sim.step();
  writeFileSync(file, serialize(sim));
  console.log('snapshot written', sim.units.length, 'units');
}
const sim = deserialize(readFileSync(file, 'utf8'));
for (let i = 0; i < 50; i++) sim.step(); // warm the JIT
const per: number[] = [];
for (let i = 0; i < ticks; i++) { const t0 = performance.now(); sim.step(); per.push(performance.now() - t0); }
per.sort((a, b) => a - b);
const avg = per.reduce((a, b) => a + b, 0) / per.length;
console.log(`units ${sim.units.length}  avg ${avg.toFixed(3)} ms/tick  p95 ${per[Math.floor(per.length * 0.95)].toFixed(2)}  max ${per[per.length - 1].toFixed(2)}`);
