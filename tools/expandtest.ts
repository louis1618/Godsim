// World growth: entities shift with the map, building footprints stay registered, sim keeps running.
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { growWorld } from '../src/sim/expand';
import { applyPower } from '../src/sim/powers';
import { YEAR_TICKS } from '../src/sim/defs';

const w0 = generateWorld({ size: 128, shape: 'continents', seed: 99 });
const sim = new Sim(w0, 99); seedLife(sim, { tribes: 4 });
for (let i = 0; i < YEAR_TICKS * 2; i++) sim.step();
const check = (label: string) => {
  const w = sim.world; let bad = 0, tiles = 0;
  for (const b of sim.buildings.values()) for (let dz = 0; dz < b.size; dz++) for (let dx = 0; dx < b.size; dx++) { tiles++; if (w.bld[w.idx(b.x + dx, b.z + dz)] !== b.id) bad++; }
  let owned = 0; for (let i = 0; i < w.N; i++) if (w.owner[i] >= 0) owned++;
  const civ = sim.units.filter((u) => u.sp <= 3).length;
  const outOfBounds = sim.units.filter((u) => u.x < 0 || u.z < 0 || u.x >= w.W || u.z >= w.H).length;
  console.log(label, JSON.stringify({ size: `${w.W}x${w.H}`, buildings: sim.buildings.size, footprintMismatch: bad, footprintTiles: tiles, ownedTiles: owned, civ, outOfBounds, tick: sim.tick }));
};
check('before');
const sh = growWorld(sim, 40, 10, 0, 70);
console.log('shift', JSON.stringify(sh));
check('after-grow');
// paint new land in the grown strip and let people expand onto it
for (let z = 20; z < 60; z += 3) applyPower(sim, 'land', 12, z, { brush: 6, dt: 0, first: true });
let land = 0; for (let x = 0; x < 30; x++) for (let z = 10; z < 70; z++) if (!sim.world.isWater(sim.world.idx(x, z))) land++;
console.log('new land tiles in grown strip', land);
for (let i = 0; i < YEAR_TICKS * 4; i++) sim.step();
check('after-4y');
let paths = 0, ok = 0;
for (const u of sim.units.slice(0, 60)) { const p = sim.pf.find(u.x, u.z, sim.world.idx(Math.floor(u.x) + 3, Math.floor(u.z)), 4000, 1); paths++; if (p) ok++; }
console.log('pathfinding after growth', ok, '/', paths);
const g2 = growWorld(sim, 2000, 0, 0, 0);
console.log('cap respected:', sim.world.W <= 768, JSON.stringify(g2));
