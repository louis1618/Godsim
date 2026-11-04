import { Sim } from './sim';
import { Sp, Mat, SPECIES, RACES } from './defs';

/** Find a random walkable land tile whose material is in `mats`. */
export function findSpot(sim: Sim, mats: number[], tries = 400, avoid: [number, number][] = [], minDist = 0): [number, number] | null {
  const w = sim.world;
  for (let i = 0; i < tries; i++) {
    const x = sim.rng.int(8, w.W - 9), z = sim.rng.int(8, w.H - 9);
    const t = w.idx(x, z);
    if (!w.walkable(t) || !mats.includes(w.mat[t])) continue;
    if (avoid.some(([ax, az]) => Math.hypot(ax - x, az - z) < minDist)) continue;
    // need some room around
    let ok = true;
    for (let dz = -2; dz <= 2 && ok; dz++) for (let dx = -2; dx <= 2; dx++) if (!w.walkable(w.idx(x + dx, z + dz))) { ok = false; break; }
    if (ok) return [x + 0.5, z + 0.5];
  }
  return null;
}

/** Populate a fresh world with a few tribes and wildlife so it is alive from the first second. */
export function seedLife(sim: Sim, opts: { tribes?: number; animals?: boolean } = {}) {
  const placed: [number, number][] = [];
  const races = [...RACES];
  sim.rng.shuffle(races);
  const n = opts.tribes ?? 4;
  const areaMul = Math.sqrt(sim.world.N / (192 * 192));
  for (let i = 0; i < n; i++) {
    const race = races[i % races.length];
    const spot = findSpot(sim, SPECIES[race].biomes, 600, placed, 40 * areaMul) ?? findSpot(sim, [Mat.Grass, Mat.Lush, Mat.Savanna], 600, placed, 30 * areaMul);
    if (!spot) continue;
    placed.push(spot);
    spawnGroup(sim, race, spot[0], spot[1], 7);
  }
  if (opts.animals !== false) {
    const herds: [Sp, number, number[]][] = [
      [Sp.Sheep, 7, [Mat.Grass, Mat.Savanna]], [Sp.Deer, 6, [Mat.Lush, Mat.Grass]], [Sp.Chicken, 4, [Mat.Grass]],
      [Sp.Wolf, 4, [Mat.Lush, Mat.Snow, Mat.Grass]], [Sp.Bear, 2, [Mat.Lush, Mat.Snow]],
      [Sp.Rabbit, 6, [Mat.Grass, Mat.Lush, Mat.Savanna]], [Sp.Fox, 4, [Mat.Lush, Mat.Grass, Mat.Snow]], [Sp.Boar, 3, [Mat.Lush, Mat.Grass, Mat.Swamp]],
      [Sp.Crocodile, 2, [Mat.Swamp, Mat.Sand]],
    ];
    for (const [sp, groups, mats] of herds) {
      for (let g = 0; g < Math.round(groups * areaMul * areaMul); g++) {
        const s = findSpot(sim, mats, 200, placed, 14);
        if (!s) continue;
        const k = sp === Sp.Bear || sp === Sp.Fox ? 1 + (sp === Sp.Fox ? 1 : 0) : sp === Sp.Wolf ? 3 : sp === Sp.Crocodile ? 2 : 4;
        for (let i = 0; i < k; i++) sim.spawnUnit(sp, s[0] + sim.rng.range(-1.5, 1.5), s[1] + sim.rng.range(-1.5, 1.5));
      }
    }
    // schools of fish in open water
    const w = sim.world;
    let schools = 0;
    for (let i = 0; i < 2000 && schools < Math.round(14 * areaMul * areaMul); i++) {
      const x = sim.rng.int(4, w.W - 5), z = sim.rng.int(4, w.H - 5);
      const t = w.idx(x, z);
      if (w.waterDepth(t) < 0.6 || w.waterDepth(t) > 4) continue;
      schools++;
      for (let k = 0; k < 4; k++) sim.spawnUnit(Sp.Fish, x + 0.5 + sim.rng.range(-0.8, 0.8), z + 0.5 + sim.rng.range(-0.8, 0.8));
    }
  }
}

export function spawnGroup(sim: Sim, race: Sp, x: number, z: number, n: number) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = sim.spawnUnit(race, x + sim.rng.range(-1.2, 1.2), z + sim.rng.range(-1.2, 1.2));
    u.female = i % 2 === 0;
    out.push(u);
  }
  // founders arrive as couples
  for (let i = 0; i + 1 < out.length; i += 2) { out[i].partner = out[i + 1].id; out[i + 1].partner = out[i].id; }
  return out;
}
