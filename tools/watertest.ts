/**
 * Water behaviour checks:
 *  A. no plant stands in (visible) water at world creation, and none after 20 years of growth
 *  B. land creatures dropped far out at sea run out of breath and drown (not instantly)
 *  C. creatures dropped near a coast swim ashore and survive
 *  D. creatures marooned on a tiny islet swim to the mainland
 *  E. trees caught by a flood die back once they stand in water
 * Usage: npx tsx tools/watertest.ts
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { YEAR_TICKS, Sp, isTree, Feat } from '../src/sim/defs';
import { UF, Unit } from '../src/sim/entities';
import { spawnFlood } from '../src/sim/disasters';

let fails = 0;
const check = (name: string, ok: boolean, info: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${info}`); if (!ok) fails++; };
const plantsInWater = (sim: Sim) => { const w = sim.world; let n = 0, wet = 0; const kinds: Record<number, number> = {}; for (let t = 0; t < w.N; t++) { const f = w.feat[t]; if (f === Feat.None || f === Feat.Boulder || f === Feat.Ore || f === Feat.Crop) continue; if (w.isWater(t)) wet++; else if (!w.dryForPlant(t, 0)) { n++; kinds[f] = (kinds[f] ?? 0) + 1; } } if (process.env.VERBOSE) console.log('shore plants by kind', kinds); return { wet, shore: n }; };

const w = generateWorld({ size: 192, shape: 'continents', seed: 4321 });
const sim = new Sim(w, 4321);
const causes = new Map<number, string>();
const kill = sim.killUnit.bind(sim);
sim.killUnit = (u: Unit, cause: string, by?: Unit) => { if (!(u.flags & UF.Dead)) causes.set(u.id, cause); kill(u, cause, by); };
{
  const p = plantsInWater(sim);
  check('A1 fresh world: no plants in water or under the drawn surf', p.wet === 0 && p.shore === 0, `on water tiles ${p.wet}, under shoreline water ${p.shore}`);
}
seedLife(sim, { tribes: 5 });
sim.laws.disasters = false;
for (let i = 0; i < YEAR_TICKS * 20; i++) sim.step();
{
  const p = plantsInWater(sim);
  check('A2 after 20 years: none grew into the water', p.wet === 0 && p.shore <= 2, `on water tiles ${p.wet}, under shoreline water ${p.shore}`);
}
// distance to nearest land for every water tile
const dist = new Int32Array(w.N).fill(1e9);
{
  const q: number[] = [];
  for (let t = 0; t < w.N; t++) if (!w.isWater(t)) { dist[t] = 0; q.push(t); }
  for (let i = 0; i < q.length; i++) { const t = q[i], x = t % w.W; for (const n of [x > 0 ? t - 1 : -1, x < w.W - 1 ? t + 1 : -1, t - w.W, t + w.W]) if (n >= 0 && n < w.N && dist[n] > dist[t] + 1) { dist[n] = dist[t] + 1; q.push(n); } }
}
const pick = (lo: number, hi: number, n: number) => { const out: number[] = []; for (let t = 0; t < w.N && out.length < n; t += 97) if (dist[t] >= lo && dist[t] <= hi && w.isDeep(t)) out.push(t); return out; };
// B. far out at sea
{
  const tiles = pick(40, 999, 12);
  const sps = [Sp.Human, Sp.Sheep, Sp.Wolf, Sp.Chicken];
  const us = tiles.map((t, i) => sim.spawnUnit(sps[i % 4], (t % w.W) + 0.5, ((t / w.W) | 0) + 0.5));
  const inWaterAtStart = us.filter((u) => w.isWater(w.tileAt(u.x, u.z))).length;
  let firstDeath = -1;
  for (let i = 0; i < 900; i++) { sim.step(); if (firstDeath < 0 && us.some((u) => u.flags & UF.Dead)) firstDeath = i; }
  const drowned = us.filter((u) => causes.get(u.id) === 'drown').length;
  check('B drowning far out at sea', tiles.length >= 8 && drowned >= us.length - 1 && firstDeath > 50, `dropped ${us.length} (${inWaterAtStart} in water), drowned ${drowned}, first death after ${(firstDeath / 10).toFixed(1)} s`);
}
// C. near a coast
{
  const tiles = pick(3, 6, 16);
  const sps = [Sp.Human, Sp.Sheep, Sp.Wolf, Sp.Deer];
  const us = tiles.map((t, i) => sim.spawnUnit(sps[i % 4], (t % w.W) + 0.5, ((t / w.W) | 0) + 0.5));
  let maxT = 0;
  for (let i = 0; i < 400; i++) { sim.step(); for (const u of us) if (!(u.flags & UF.Dead) && w.isWater(w.tileAt(u.x, u.z))) maxT = i; }
  const ashore = us.filter((u) => !(u.flags & UF.Dead) && !w.isWater(w.tileAt(u.x, u.z))).length;
  const drowned = us.filter((u) => causes.get(u.id) === 'drown').length;
  if (process.env.VERBOSE) for (const u of us) if (u.flags & UF.Dead || w.isWater(w.tileAt(u.x, u.z))) console.log('C left', u.sp, causes.get(u.id), u.task?.k, u.x.toFixed(1), u.z.toFixed(1));
  const killed = us.filter((u) => u.flags & UF.Dead && causes.get(u.id) !== 'drown').length;
  check('C swimming ashore from near the coast', drowned === 0 && ashore + killed === us.length, `dropped ${us.length}, ashore alive ${ashore}, drowned ${drowned}, killed in fights ashore ${killed}, last one landed after ${(maxT / 10).toFixed(1)} s`);
}
// D. marooned on a tiny islet
{
  const t0 = pick(6, 7, 1)[0];
  const cx = t0 % w.W, cz = (t0 / w.W) | 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const t = w.idx(cx + dx, cz + dz); w.height[t] = 0.8; w.water[t] = 0; }
  w.markTerrain(cx - 1, cz - 1, cx + 1, cz + 1);
  const us = [Sp.Sheep, Sp.Deer, Sp.Human].map((sp) => sim.spawnUnit(sp, cx + 0.5, cz + 0.5));
  for (const u of us) { u.village = -1; u.kingdom = -1; }
  const onIslet = () => us.filter((u) => !(u.flags & UF.Dead) && Math.abs(u.x - cx - 0.5) < 2 && Math.abs(u.z - cz - 0.5) < 2).length;
  const start = onIslet();
  let off = -1;
  const reached = new Set<number>();
  for (let i = 0; i < 600; i++) {
    sim.step(); if (off < 0 && onIslet() === 0) off = i;
    if (w.islandsDirty) w.computeIslands();
    for (const u of us) if (!(u.flags & UF.Dead) && (w.islandSize[w.island[w.tileAt(u.x, u.z)]] ?? 0) >= 40) reached.add(u.id);
  }
  const onMain = reached.size;
  if (process.env.VERBOSE) for (const u of us) console.log('D', u.sp, u.flags & UF.Dead ? 'dead:' + causes.get(u.id) : 'alive', u.task?.k, u.x.toFixed(1), u.z.toFixed(1), 'islet at', cx, cz, 'island size', w.islandSize[w.island[w.tileAt(u.x, u.z)]]);
  check('D marooned creatures swim to the mainland', start === 3 && onMain >= 2, `on islet at start ${start}, left it after ${(off / 10).toFixed(1)} s, reached a real landmass ${onMain}/3 (${us.filter((u) => u.flags & UF.Dead).length} later killed by predators ashore)`);
}
// E. flooded trees die back
{
  let best = -1, bn = 0;
  for (const v of sim.villages.values()) { if (!v.alive) continue; let n = 0; for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++) { const t = w.tileAt(v.cx + dx, v.cz + dz); if (t >= 0 && isTree(w.feat[t])) n++; } if (n > bn) { bn = n; best = v.id; } }
  const v = sim.villages.get(best)!;
  spawnFlood(sim, v.cx + 0.5, v.cz + 0.5, 10);
  const f = sim.floods[0];
  const drownedTrees0 = f.tiles.filter((t) => isTree(w.feat[t]) && w.isWater(t)).length;
  for (let i = 0; i < 400; i++) sim.step();
  const left = f.tiles.filter((t) => isTree(w.feat[t]) && w.isWater(t)).length;
  check('E flooded trees die back', drownedTrees0 === 0 || left < drownedTrees0 * 0.6, `trees under the flood ${drownedTrees0} -> still standing in water ${left}`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
