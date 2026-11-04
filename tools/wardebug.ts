import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { YEAR_TICKS } from '../src/sim/defs';

const world = generateWorld({ size: 192, shape: 'continents', seed: 4242 });
const sim = new Sim(world, 4242);
seedLife(sim, { tribes: 7 });
const killCause: Record<string, number> = {};
const orig = sim.killUnit.bind(sim);
sim.killUnit = (u, cause, by) => { if (u.flags & 1) killCause[cause] = (killCause[cause] ?? 0) + 1; orig(u, cause, by); };
let tracked = -1;
for (let t = 0; t < YEAR_TICKS * 14; t++) {
  sim.step();
  if (tracked < 0) {
    const m = sim.units.find((u) => u.task?.k === 'march');
    if (m) { tracked = m.id; console.log('tracking', m.id, 'at tick', sim.tick); }
  } else if (sim.tick % 40 === 0) {
    const u = sim.getUnit(tracked);
    if (!u) { console.log('tracked died', sim.tick); tracked = -1; continue; }
    const k = sim.kingdoms.get(u.kingdom)!;
    const tv = sim.villages.get(k.target);
    console.log(sim.tick, u.task?.k, (u.task as any)?.v ?? '', 'pos', u.x.toFixed(1), u.z.toFixed(1), 'target', tv ? `${tv.cx},${tv.cz} d=${Math.hypot(tv.cx - u.x, tv.cz - u.z).toFixed(1)}` : 'none', 'stuck', u.stuck, 'path', u.path?.length ?? 0, 'wars', k.wars.length);
  }
}
console.log('king deaths by cause', killCause);
