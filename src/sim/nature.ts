import { inDrought } from './disasters';
import { Sim } from './sim';
import { Feat, Mat, MATS, isTree, Bk, Sp } from './defs';
import { findSpot } from './seed';

/** Tiles currently on fire. */
export const fireTiles = new Set<number>();

const GRASS_MAX: Record<number, number> = { [Mat.Grass]: 230, [Mat.Lush]: 250, [Mat.Savanna]: 160, [Mat.Swamp]: 130, [Mat.Farmland]: 0 };

export function ignite(sim: Sim, t: number, amt = 200) {
  const w = sim.world;
  if (t < 0 || w.isWater(t)) return;
  if (w.fire[t] < amt) w.fire[t] = amt;
  fireTiles.add(t);
  w.markMat(w.tx(t), w.tz(t), w.tx(t), w.tz(t));
  const b = sim.buildingAt(t);
  if (b && b.kind !== Bk.Ruin && b.fire < 100) b.fire = 180;
}

function flammability(sim: Sim, t: number): number {
  const w = sim.world;
  if (w.isWater(t) || w.wet[t] > 60) return 0;
  const f = w.feat[t];
  let p = MATS[w.mat[t]].flammable * (w.grass[t] / 255) * 0.5;
  if (isTree(f) && f !== Feat.Cactus) p += 0.9;
  if (f === Feat.Berry || f === Feat.Crop) p += 0.6;
  if (w.bld[t] >= 0) p += 0.35;
  return p;
}

export function natureTick(sim: Sim) {
  const w = sim.world;
  const rng = sim.rng;
  const season = sim.laws.seasons ? sim.season : 1;
  const growMul = season === 0 ? 1.3 : season === 1 ? 1 : season === 2 ? 0.6 : 0.05;

  // random tile updates
  if (sim.laws.growth) {
    const K = Math.ceil(w.N / 380);
    for (let i = 0; i < K; i++) {
      const t = (rng.next() * w.N) | 0;
      if (w.isWater(t)) continue;
      const f = w.feat[t], m = w.mat[t];
      if (sim.droughts.length && inDrought(sim, w.tx(t), w.tz(t))) {
        // parched: grass and berries wither, lush land browns, young trees die
        w.grass[t] = Math.max(0, w.grass[t] - 60); w.wet[t] = 0;
        if (f === Feat.Berry) { if (w.featAmt[t] > 40) w.featAmt[t] -= 40; else w.setFeat(t, Feat.None, 0); }
        else if (f === Feat.Flower) w.setFeat(t, Feat.None, 0);
        else if (isTree(f) && f !== Feat.Dead && f !== Feat.Cactus && rng.chance(0.06)) w.setFeat(t, Feat.Dead, 120);
        if (m === Mat.Lush) { w.mat[t] = Mat.Grass; w.markMat(w.tx(t), w.tz(t), w.tx(t), w.tz(t)); }
        else if (m === Mat.Grass && rng.chance(0.5)) { w.mat[t] = Mat.Savanna; w.markMat(w.tx(t), w.tz(t), w.tx(t), w.tz(t)); }
        continue;
      }
      // dried land recovers once the rains return
      if (m === Mat.Savanna && w.moist[t] > 150 && rng.chance(0.02 * growMul)) { w.mat[t] = Mat.Grass; w.markMat(w.tx(t), w.tz(t), w.tx(t), w.tz(t)); }
      if (isTree(f) && f !== Feat.Dead) {
        const a = w.featAmt[t];
        if (a < 255 && rng.chance(growMul)) {
          const na = Math.min(255, a + 14);
          w.featAmt[t] = na;
          if ((na >> 5) !== (a >> 5)) w.markFeatTile(t);
        } else if (a >= 200 && rng.chance(0.12 * growMul)) spreadTree(sim, t, f);
      } else if (f === Feat.Berry && w.featAmt[t] < 255) {
        w.featAmt[t] = Math.min(255, w.featAmt[t] + 30 * growMul);
      } else if (f === Feat.Dead && rng.chance(0.02)) {
        w.setFeat(t, Feat.None, 0);
      } else if (f === Feat.None && w.owner[t] < 0 && w.bld[t] < 0 && rng.chance(0.004 * growMul)) {
        if (m === Mat.Grass || m === Mat.Lush) w.setFeat(t, rng.chance(0.5) ? Feat.Flower : Feat.Berry, 120);
      }
      // ground recovery
      if (m === Mat.Ash && rng.chance(0.06 * growMul)) { w.mat[t] = Mat.Grass; w.grass[t] = 60; w.markMat(w.tx(t), w.tz(t), w.tx(t), w.tz(t)); }
      else if (m === Mat.Soil && w.bld[t] < 0 && w.owner[t] < 0 && rng.chance(0.03 * growMul)) { w.mat[t] = Mat.Grass; w.markMat(w.tx(t), w.tz(t), w.tx(t), w.tz(t)); }
      const gm = GRASS_MAX[m] ?? 0;
      if (w.grass[t] < gm) w.grass[t] = Math.min(gm, w.grass[t] + 40 * growMul);
      if (w.wet[t] > 0) w.wet[t] = Math.max(0, w.wet[t] - 40);
    }
  }

  // crops grow on farms
  if (sim.tick % 20 === 0) {
    const cropMul = season === 3 ? 0 : season === 1 ? 1.25 : season === 0 ? 1.1 : 0.8;
    for (const b of sim.buildings.values()) {
      if (b.kind !== Bk.Farm || b.progress < 1) continue;
      for (let dz = 0; dz < b.size; dz++) for (let dx = 0; dx < b.size; dx++) {
        const t = w.idx(b.x + dx, b.z + dz);
        if (w.feat[t] !== Feat.Crop) continue;
        if (sim.droughts.length && inDrought(sim, b.x, b.z)) { if (w.featAmt[t] > 12) { w.featAmt[t] -= 6; w.markFeatTile(t); } continue; }
        const a = w.featAmt[t];
        if (a < 255) {
          const na = Math.min(255, a + Math.round(10 * cropMul + (sim.weather.rain > 0.3 ? 2 : 0)));
          w.featAmt[t] = na;
          if ((na >> 5) !== (a >> 5)) w.markFeatTile(t);
        }
      }
    }
  }

  // fire
  if (fireTiles.size && sim.tick % 2 === 0) {
    const summer = season === 1 ? 1.4 : season === 3 ? 0.5 : 1;
    const toAdd: number[] = [];
    for (const t of fireTiles) {
      const x = t % w.W, z = (t / w.W) | 0;
      const wet = w.wet[t] > 40 || w.isWater(t);
      w.fire[t] = Math.max(0, w.fire[t] - (wet ? 40 : 4));
      if (rng.chance(0.25)) {
        // burn fuel on this tile
        const f = w.feat[t];
        if (isTree(f) && f !== Feat.Dead) {
          if (w.featAmt[t] > 40) { w.featAmt[t] -= 40; w.markFeatTile(t); }
          else w.setFeat(t, Feat.Dead, 160);
          w.fire[t] = Math.min(255, w.fire[t] + 30);
        } else if (f === Feat.Berry || f === Feat.Crop || f === Feat.Flower) w.setFeat(t, Feat.None, 0);
        if (w.grass[t] > 0) { w.grass[t] = Math.max(0, w.grass[t] - 80); }
        const m = w.mat[t];
        if ((m === Mat.Grass || m === Mat.Lush || m === Mat.Savanna) && w.fire[t] > 80) w.mat[t] = Mat.Ash;
      }
      if (sim.laws.fire && !wet) {
        for (let k = 0; k < 4; k++) {
          const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), nz = z + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (!w.inside(nx, nz)) continue;
          const n = nz * w.W + nx;
          if (w.fire[n] > 0) continue;
          if (rng.chance(0.06 * flammability(sim, n) * summer * (w.fire[t] / 200))) toAdd.push(n);
        }
      }
      if (w.fire[t] === 0) fireTiles.delete(t);
      if (rng.chance(0.2)) w.markMat(x, z, x, z);
    }
    for (const n of toAdd) ignite(sim, n, 160 + rng.int(0, 60));
    if (toAdd.length) sim.fx.push({ t: 'firespread', x: 0, z: 0, a: toAdd.length });
  }

  // wildlife migrates in when a species is close to extinction
  if (sim.laws.animals && sim.tick % 400 === 200) {
    const floors: [number, number, number[]][] = [[Sp.Wolf, 4, [Mat.Lush, Mat.Snow, Mat.Grass]], [Sp.Bear, 2, [Mat.Lush, Mat.Snow]], [Sp.Sheep, 8, [Mat.Grass, Mat.Savanna]], [Sp.Deer, 8, [Mat.Lush, Mat.Grass]], [Sp.Chicken, 6, [Mat.Grass, Mat.Savanna]]];
    for (const [sp, floor, mats] of floors) {
      if (sim.count(sp) >= floor * (w.N / 36864)) continue;
      const s = findSpot(sim, mats, 120);
      if (!s) continue;
      // stay away from villages
      if (w.owner[w.tileAt(s[0], s[1])] >= 0) continue;
      const n = sp === Sp.Bear ? 1 : 3;
      for (let i = 0; i < n; i++) sim.spawnUnit(sp, s[0] + rng.range(-1, 1), s[1] + rng.range(-1, 1));
    }
  }

  // weather: rain clouds wander, wet the ground, put out fires
  if (sim.tick % 5 === 0) {
    const want = season === 0 ? 3 : season === 2 ? 2.5 : season === 3 ? 1.5 : 1;
    if (sim.rainClouds.length < want * (w.N / 36864) && rng.chance(0.01)) {
      sim.rainClouds.push({ id: sim.id(), x: rng.range(0, w.W), z: rng.range(0, w.H), vx: rng.range(-0.08, 0.08), vz: rng.range(-0.08, 0.08), life: rng.int(300, 900), r: rng.range(5, 10), storm: rng.chance(0.15) });
    }
    for (const c of sim.rainClouds) {
      c.x += c.vx * 5; c.z += c.vz * 5; c.life -= 5;
      const R = Math.ceil(c.r);
      for (let i = 0; i < 12; i++) {
        const xx = Math.floor(c.x + rng.range(-R, R)), zz = Math.floor(c.z + rng.range(-R, R));
        if (!w.inside(xx, zz)) continue;
        const t = w.idx(xx, zz);
        w.wet[t] = 255;
        if (w.fire[t] > 0) w.fire[t] = Math.max(0, w.fire[t] - 120);
        if (w.grass[t] < 200) w.grass[t] = Math.min(255, w.grass[t] + 20);
      }
      if (c.storm && rng.chance(0.012)) sim.fx.push({ t: 'lightningReq', x: c.x + rng.range(-c.r, c.r), z: c.z + rng.range(-c.r, c.r) });
    }
    sim.rainClouds = sim.rainClouds.filter((c) => c.life > 0 && c.x > -20 && c.z > -20 && c.x < w.W + 20 && c.z < w.H + 20);
  }
}

function spreadTree(sim: Sim, t: number, f: number) {
  const w = sim.world;
  const x = t % w.W, z = (t / w.W) | 0;
  const nx = x + sim.rng.int(-2, 2), nz = z + sim.rng.int(-2, 2);
  if (!w.inside(nx, nz)) return;
  const n = nz * w.W + nx;
  if (w.feat[n] !== Feat.None && w.feat[n] !== Feat.Flower) return;
  if (w.bld[n] >= 0 || !w.walkable(n) || w.fire[n] > 0 || w.besideBuilding(n)) return;
  const m = w.mat[n];
  if (m === Mat.Rock || m === Mat.Farmland || m === Mat.Soil || m === Mat.Lava || m === Mat.Ash) return;
  // villages keep their core clear
  if (w.owner[n] >= 0) {
    const v = sim.villages.get(w.owner[n]);
    if (v && Math.hypot(v.cx - nx, v.cz - nz) < v.radius * 0.75) return;
  }
  let crowd = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (!w.inside(nx + dx, nz + dz)) continue;
    if (isTree(w.feat[(nz + dz) * w.W + nx + dx])) crowd++;
  }
  if (crowd > 5) return;
  let sp = f;
  if (m === Mat.Desert) sp = Feat.Cactus;
  else if (m === Mat.Snow) sp = Feat.SnowPine;
  else if (m === Mat.Sand) { if (f !== Feat.Palm) return; }
  else if (f === Feat.Cactus || f === Feat.Palm) return;
  w.setFeat(n, sp, 20);
  sim.fx.push({ t: 'sprout', x: nx + 0.5, z: nz + 0.5, u: n });
}
