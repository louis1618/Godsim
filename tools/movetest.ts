// Movement regression test: nobody inside solid buildings, no walking in place, chopping at the trunk.
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { YEAR_TICKS, isWoodTree, Sp } from '../src/sim/defs';
import { UF, Anim } from '../src/sim/entities';
import { featureOffset, navOpts, bodyRadius } from '../src/sim/nav';

const seed = Number(process.argv[2] ?? 4242), years = Number(process.argv[3] ?? 8);
const world = generateWorld({ size: 192, shape: 'continents', seed });
const sim = new Sim(world, seed);
seedLife(sim, { tribes: 6 });
let samples = 0, inside = 0, walkInPlace = 0, chops = 0, chopDistSum = 0, chopFar = 0, overlaps = 0, treesBeside = 0;
if (process.env.NOSEP) navOpts.separation = false;
const insideIds = new Set<number>();
for (let t = 0; t < YEAR_TICKS * years; t++) {
  sim.step();
  if (t % 5) continue;
  for (const u of sim.units) {
    if (u.flags & (UF.Dead | UF.Ragdoll | UF.Held | UF.Jailed)) continue; // prisoners live inside the prison yard on purpose
    if (u.sp === Sp.Fish || u.sp >= Sp.Boat && u.sp <= Sp.Plane) continue;   // swimmers and machines move on their own rules
    samples++;
    const tt = world.tileAt(u.x, u.z);
    if (tt >= 0 && world.bld[tt] >= 0 && !world.bldPassable(tt)) { inside++; if (!insideIds.has(u.id) && process.env.DEBUG) console.log('inside', u.id, u.sp, u.task?.k, u.flags, sim.buildings.get(world.bld[tt])?.kind, sim.tick); insideIds.add(u.id); }
    if ((u.anim === Anim.Walk || u.anim === Anim.Panic) && u.x === u.px && u.z === u.pz) walkInPlace++;
    // two bodies sunk into each other (more than half their combined radius)
    if (!(u.flags & (UF.Aboard | UF.Escorted)) && u.y <= 1) sim.near(u.x, u.z, 0.6, (o, d2) => { if (o.id > u.id && !(o.flags & (UF.Ragdoll | UF.Held | UF.Jailed | UF.Aboard | UF.Escorted)) && o.sp !== Sp.Fish && o.y <= 1) { const rr = (bodyRadius(u.sp) + bodyRadius(o.sp)) * 0.5; if (d2 < rr * rr) overlaps++; } });
    const task = u.task;
    if (task?.k === 'gather' && u.anim === Anim.Work && isWoodTree(world.feat[task.tile])) {
      const [fx, fz] = featureOffset(task.tile % world.W, (task.tile / world.W) | 0, world.feat[task.tile]);
      const d = Math.hypot(u.x - fx, u.z - fz);
      chops++; chopDistSum += d; if (d > 0.55) chopFar++;
    }
  }
}
let civ = 0; for (const u of sim.units) if (u.sp <= 3) civ++;
for (let t = 0; t < world.N; t++) if ((world.feat[t] >= 1 && world.feat[t] <= 8 || world.feat[t] === 10) && world.besideBuilding(t)) treesBeside++;
console.log(JSON.stringify({ years, samples, overlappingPairs: overlaps, treesOrRocksTouchingBuildings: treesBeside, insideSolidBuilding: inside, distinctUnitsInside: insideIds.size, walkInPlace, chopSamples: chops, avgChopDist: +(chopDistSum / Math.max(1, chops)).toFixed(3), chopsFartherThan055: chopFar, buildings: sim.buildings.size, civPop: civ, villages: [...sim.villages.values()].filter((v) => v.alive).length }));
