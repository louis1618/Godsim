/**
 * Frozen-creature detector (runs flat out, no rendering - i.e. "max speed"):
 *  - a creature is frozen when it has not moved 0.15 tiles in 30 s of game time while its job is not
 *    one that legitimately stands still (sleeping, jailed, on a guard post, building, aboard, ...)
 *  - also reports creatures trapped in water and trees standing in water
 * Usage: npx tsx tools/stucktest.ts [seed] [years] [size]
 * NOWATCHDOG=1 disables the in-sim watchdog to see the raw failure rate.
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { YEAR_TICKS, Sp, isVehicle, isTree, isCiv } from '../src/sim/defs';
import { UF, Unit } from '../src/sim/entities';
import { aquatic } from '../src/sim/animals';
import { watchdogOpts } from '../src/sim/ai';

const seed = Number(process.argv[2] ?? 777), years = Number(process.argv[3] ?? 10), size = Number(process.argv[4] ?? 192);
if (process.env.NOWATCHDOG) watchdogOpts.enabled = false;
const world = generateWorld({ size, shape: 'continents', seed });
const sim = new Sim(world, seed);
seedLife(sim, { tribes: 6 });
const FROZEN = 300;
const STILL_OK = new Set(['sleep', 'jailed', 'escorted', 'voyage', 'post', 'board', 'build', 'farm', 'gather', 'dance', 'chat', 'love', 'graze', 'eat']);
const anchor = new Map<number, { x: number; z: number; t: number; reported: boolean }>();
const byKind: Record<string, number> = {};
const frozenIds = new Set<number>();
let samples = 0, frozen = 0, inWater = 0, longInWater = 0, maxWaterTicks = 0;
const waterT = new Map<number, number>();
const examples: string[] = [];
const exempt = (u: Unit) => u.flags & (UF.Dead | UF.Ragdoll | UF.Held | UF.Jailed | UF.Aboard | UF.Escorted) || isVehicle(u.sp) || u.sp === Sp.Fish || u.sp === Sp.Dragon;
const t0 = performance.now();
for (let tick = 0; tick < YEAR_TICKS * years; tick++) {
  sim.step();
  if (tick % 10) continue;
  for (const u of sim.units) {
    if (exempt(u)) { anchor.delete(u.id); continue; }
    samples++;
    const a = anchor.get(u.id);
    const k = u.task?.k ?? 'none';
    const fighting = u.anim === 3 && (k === 'attack' || k === 'hunt' || k === 'raze'); // Anim.Attack: trading blows in place
    if (!a || Math.hypot(u.x - a.x, u.z - a.z) > 0.15 || STILL_OK.has(k) || fighting) { anchor.set(u.id, { x: u.x, z: u.z, t: sim.tick, reported: false }); }
    else if (sim.tick - a.t > FROZEN && !a.reported) {
      a.reported = true; frozen++; frozenIds.add(u.id);
      const key = `${SPECIES_KEY(u.sp)}:${k}`;
      byKind[key] = (byKind[key] ?? 0) + 1;
      if (examples.length < 14) examples.push(`#${u.id} ${SPECIES_KEY(u.sp)} task=${JSON.stringify(u.task)?.slice(0, 90)} anim=${u.anim} path=${u.path ? u.path.length : '-'} stuck=${u.stuck} blocked=${u.blocked ?? 0} think=${u.think} at ${u.x.toFixed(1)},${u.z.toFixed(1)} tile=${world.tileAt(u.x, u.z)} water=${world.isWater(world.tileAt(u.x, u.z))} walk=${world.walkable(world.tileAt(u.x, u.z))}`);
    }
    const t = world.tileAt(u.x, u.z);
    if (t >= 0 && world.isWater(t) && !aquatic(u.sp)) {
      inWater++;
      const n = (waterT.get(u.id) ?? 0) + 10; waterT.set(u.id, n);
      if (n > maxWaterTicks) maxWaterTicks = n;
      if (n === 300) longInWater++;
    } else waterT.delete(u.id);
  }
}
let treesInWater = 0;
for (let t = 0; t < world.N; t++) if (isTree(world.feat[t]) && world.isWater(t)) treesInWater++;
let civ = 0; for (const u of sim.units) if (isCiv(u.sp)) civ++;
console.log(JSON.stringify({ seed, years, size, samples, frozenEpisodes: frozen, distinctFrozen: frozenIds.size, byKind, inWaterSamples: inWater, inWater30sEpisodes: longInWater, maxSecondsInWater: maxWaterTicks / 10, treesInWater, drowned: sim.deathCauses['drown'] ?? 0, watchdogRescues: sim.stats.rescued ?? 0, units: sim.units.length, civ, secs: +((performance.now() - t0) / 1000).toFixed(1) }));
if (process.env.VERBOSE) for (const e of examples) console.log(e);
function SPECIES_KEY(sp: number) { return ['human', 'elf', 'dwarf', 'orc', 'sheep', 'wolf', 'deer', 'bear', 'skeleton', 'chicken', 'troll', 'boat', 'tank', 'plane', 'rabbit', 'fox', 'boar', 'croc', 'fish', 'dragon'][sp] ?? String(sp); }
