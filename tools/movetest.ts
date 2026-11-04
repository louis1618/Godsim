// Movement regression test: nobody inside solid buildings, no walking in place, chopping at the trunk.
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { YEAR_TICKS, isWoodTree } from '../src/sim/defs';
import { UF, Anim } from '../src/sim/entities';
import { featureOffset } from '../src/sim/nav';

const seed = Number(process.argv[2] ?? 4242), years = Number(process.argv[3] ?? 8);
const world = generateWorld({ size: 192, shape: 'continents', seed });
const sim = new Sim(world, seed);
seedLife(sim, { tribes: 6 });
let samples = 0, inside = 0, walkInPlace = 0, chops = 0, chopDistSum = 0, chopFar = 0;
const insideIds = new Set<number>();
for (let t = 0; t < YEAR_TICKS * years; t++) {
  sim.step();
  if (t % 5) continue;
  for (const u of sim.units) {
    if (u.flags & (UF.Dead | UF.Ragdoll | UF.Held)) continue;
    samples++;
    const tt = world.tileAt(u.x, u.z);
    if (tt >= 0 && world.bld[tt] >= 0 && !world.bldPassable(tt)) { inside++; insideIds.add(u.id); }
    if ((u.anim === Anim.Walk || u.anim === Anim.Panic) && u.x === u.px && u.z === u.pz) walkInPlace++;
    const task = u.task;
    if (task?.k === 'gather' && u.anim === Anim.Work && isWoodTree(world.feat[task.tile])) {
      const [fx, fz] = featureOffset(task.tile % world.W, (task.tile / world.W) | 0, world.feat[task.tile]);
      const d = Math.hypot(u.x - fx, u.z - fz);
      chops++; chopDistSum += d; if (d > 0.55) chopFar++;
    }
  }
}
let civ = 0; for (const u of sim.units) if (u.sp <= 3) civ++;
console.log(JSON.stringify({ years, samples, insideSolidBuilding: inside, distinctUnitsInside: insideIds.size, walkInPlace, chopSamples: chops, avgChopDist: +(chopDistSum / Math.max(1, chops)).toFixed(3), chopsFartherThan055: chopFar, buildings: sim.buildings.size, civPop: civ, villages: [...sim.villages.values()].filter((v) => v.alive).length }));
