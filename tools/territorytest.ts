/**
 * Territory hygiene after decades of growth:
 *  - every tile has at most one owner (by construction) and owners are live villages
 *  - speckle: owned tiles with no same-owner 4-neighbour (single-tile islands)
 *  - interleaving: border tiles whose owner flips more than twice along a 5-tile row (zig-zag fronts)
 *  - buildings standing on another village's land
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { YEAR_TICKS } from '../src/sim/defs';

const years = Number(process.argv[2] ?? 30);
const w = generateWorld({ size: 256, shape: 'continents', seed: 909 });
const sim = new Sim(w, 909);
seedLife(sim, { tribes: 8 });
for (let y = 1; y <= years; y++) {
  for (let i = 0; i < YEAR_TICKS; i++) sim.step();
  if (y % 10 && y !== years) continue;
  let owned = 0, dead = 0, speckle = 0, zig = 0, foreignBld = 0;
  for (let z = 1; z < w.H - 1; z++) for (let x = 1; x < w.W - 1; x++) {
    const t = z * w.W + x, o = w.owner[t];
    if (o < 0) continue;
    owned++;
    if (!sim.villages.get(o)?.alive) dead++;
    const same = (w.owner[t - 1] === o ? 1 : 0) + (w.owner[t + 1] === o ? 1 : 0) + (w.owner[t - w.W] === o ? 1 : 0) + (w.owner[t + w.W] === o ? 1 : 0);
    if (same === 0) speckle++;
    if (x >= 2 && x < w.W - 2) {
      let flips = 0;
      for (let k = -2; k < 2; k++) if (w.owner[t + k] !== w.owner[t + k + 1] && w.owner[t + k] >= 0 && w.owner[t + k + 1] >= 0) flips++;
      if (flips > 2) zig++;
    }
    const b = w.bld[t] >= 0 ? sim.buildings.get(w.bld[t]) : undefined;
    if (b && b.village >= 0 && b.village !== o) foreignBld++;
  }
  const vs = [...sim.villages.values()].filter((v) => v.alive).length;
  console.log(`y${years >= 100 ? String(y).padStart(3) : y}  villages ${vs}  owned tiles ${owned}  by dead villages ${dead}  single-tile specks ${speckle}  zig-zag border tiles ${zig}  buildings on foreign land ${foreignBld}`);
}
