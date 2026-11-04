/**
 * Simulation scaling: ms per tick as the world and the population grow.
 * usage: npx tsx tools/perftest.ts [quick]
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { Sp, YEAR_TICKS } from '../src/sim/defs';
import { UF } from '../src/sim/entities';
import { fireTiles } from '../src/sim/nature';
import { clearClaims } from '../src/sim/ai';
import { clearFarmClaims } from '../src/sim/civ';

const quick = process.argv.includes('quick');
const rows: string[] = [];
function measure(label: string, size: number, wide: boolean, tribes: number, extraAnimals: number, warm: number, ticks: number) {
  fireTiles.clear(); clearClaims(); clearFarmClaims();
  const w = generateWorld({ size, wide, shape: 'continents', seed: 4242 });
  const sim = new Sim(w, 4242);
  seedLife(sim, { tribes });
  // extra wildlife to push entity counts
  const sps = [Sp.Sheep, Sp.Deer, Sp.Rabbit, Sp.Chicken, Sp.Boar, Sp.Wolf];
  for (let i = 0, n = 0; i < extraAnimals * 20 && n < extraAnimals; i++) {
    const x = sim.rng.range(0, w.W), z = sim.rng.range(0, w.H);
    const t = w.tileAt(x, z);
    if (t >= 0 && w.walkable(t)) { sim.spawnUnit(sps[n % sps.length], x, z); n++; }
  }
  // the cap would cull the extras over time; lift it for the measurement
  for (let i = 0; i < warm; i++) sim.step();
  const times: number[] = [];
  for (let i = 0; i < ticks; i++) { const t0 = performance.now(); sim.step(); times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)];
  const alive = sim.units.filter((u) => !(u.flags & UF.Dead)).length;
  const civ = sim.units.filter((u) => u.sp <= 3 && !(u.flags & UF.Dead)).length;
  const row = `${label.padEnd(26)} world ${String(w.W).padStart(3)}x${String(w.H).padEnd(3)} units ${String(alive).padStart(5)} (civ ${String(civ).padStart(4)}) buildings ${String(sim.buildings.size).padStart(4)}  avg ${avg.toFixed(2)} ms/tick  p95 ${p95.toFixed(2)}  max ${times[times.length - 1].toFixed(1)}  -> ${(avg * 10).toFixed(1)} ms per sim-second at 1x`;
  console.log(row); rows.push(row);
}

const T = quick ? 300 : 800;
measure('small, 4 tribes', 128, false, 4, 0, 300, T);
measure('default, 4 tribes', 192, false, 4, 0, 300, T);
measure('default + 1000 animals', 192, false, 4, 1000, 300, T);
measure('default + 3000 animals', 192, false, 4, 3000, 300, T);
measure('large 256, 6 tribes', 256, false, 6, 1000, 300, T);
measure('XL 384, 9 tribes', 384, false, 9, 2000, 300, T);
measure('wide 512x256, 8 tribes', 256, true, 8, 2000, 300, T);
if (!quick) measure('XXL 512, 12 tribes', 512, false, 12, 4000, 300, T);
void YEAR_TICKS;
