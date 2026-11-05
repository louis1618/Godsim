/**
 * Where a simulation tick goes, and how spiky it is (what fast-forward feels).
 * Grows a world for some years, then times every subsystem of sim.step over many ticks and prints
 * averages and percentiles, plus the worst "frame" at 10x (two ticks back to back at 60 fps).
 * Usage: npx tsx tools/tickprof.ts [size] [years] [ticks]
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { YEAR_TICKS } from '../src/sim/defs';
import * as ai from '../src/sim/ai';
import * as civ from '../src/sim/civ';
import * as nature from '../src/sim/nature';
import * as dis from '../src/sim/disasters';
import { profile } from '../src/sim/sim';

const size = Number(process.argv[2] ?? 256), years = Number(process.argv[3] ?? 15), ticks = Number(process.argv[4] ?? 3000);
const w = generateWorld({ size, shape: 'continents', seed: 2024 });
const sim = new Sim(w, 2024);
seedLife(sim, { tribes: Math.round(size / 40) });
for (let i = 0; i < YEAR_TICKS * years; i++) sim.step();
void ai; void civ; void nature; void dis;
profile.on = true; profile.byKind = !!process.env.BYKIND;
const per: number[] = [];
for (let i = 0; i < ticks; i++) { const t0 = performance.now(); sim.step(); per.push(performance.now() - t0); }
profile.on = false;
const sorted = per.slice().sort((a, b) => a - b);
const pc = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(2);
let worstPair = 0; for (let i = 1; i < per.length; i++) worstPair = Math.max(worstPair, per[i] + per[i - 1]);
const avg = per.reduce((a, b) => a + b, 0) / per.length;
console.log(`world ${w.W}x${w.H}, ${sim.units.length} units, ${sim.buildings.size} buildings, ${[...sim.villages.values()].filter((v) => v.alive).length} villages`);
console.log(`tick avg ${avg.toFixed(2)} ms  p50 ${pc(0.5)}  p95 ${pc(0.95)}  p99 ${pc(0.99)}  max ${pc(1)}  | 10x needs ${(avg * 100).toFixed(0)} ms per real second; worst 2-tick frame ${worstPair.toFixed(1)} ms`);
const rows = Object.entries(profile.t).sort((a, b) => b[1] - a[1]);
for (const [k, v] of rows) console.log(`  ${k.padEnd(16)} ${(v / ticks).toFixed(3)} ms/tick avg   worst single tick ${profile.max[k].toFixed(2)} ms${profile.n[k] ? `   ${(profile.n[k] / ticks).toFixed(0)} units/tick, ${(v / profile.n[k] * 1000).toFixed(2)} us each` : ''}`);
