/**
 * Terrain tools (headless):
 *  1. land: one stamp of a big brush makes land over the whole disc (no rubbing back and forth)
 *  2. strength scales a sculpting pass
 *  3. smooth evens out rough ground
 *  4. lake: a stroke cuts a basin filled to one level, with no water hanging above lower dry ground
 *  5. drain empties inland water and leaves the sea alone
 *  6. fill turns an enclosed body of water into land in one click
 *  7. undo / redo restore the land exactly, stroke by stroke
 * Usage: npx tsx tools/terraintest.ts
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { applyPower, editHooks } from '../src/sim/powers';
import { TerrainHistory } from '../src/sim/undo';
import { World } from '../src/sim/world';

let fails = 0;
const check = (name: string, ok: boolean, info: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${info}`); if (!ok) fails++; };
const make = () => { const w = generateWorld({ size: 256, shape: 'continents', seed: 4321 }); return new Sim(w, 4321); };
const ctx = (brush: number, extra = {}) => ({ brush, dt: 0.1, first: true, shape: 'circle' as const, ...extra });
const digest = (w: World) => { let h = 2166136261 >>> 0; const mix = (n: number) => { h ^= n | 0; h = Math.imul(h, 16777619) >>> 0; }; for (let t = 0; t < w.N; t++) { mix(Math.round(w.height[t] * 1000)); mix(Math.round(w.water[t] * 1000)); mix(w.mat[t] | (w.feat[t] << 8) | (w.featAmt[t] << 16)); mix(w.grass[t]); } return h; };
/** the middle of the widest stretch of open sea / dry land */
function findSpot(w: World, water: boolean, r: number): [number, number] {
  for (let z = r + 1; z < w.H - r - 1; z += 2) for (let x = r + 1; x < w.W - r - 1; x += 2) {
    let ok = true;
    for (let dz = -r; dz <= r && ok; dz += 2) for (let dx = -r; dx <= r; dx += 2) { const t = w.idx(x + dx, z + dz); if (w.isWater(t) !== water) { ok = false; break; } }
    if (ok) return [x + 0.5, z + 0.5];
  }
  throw new Error('no spot');
}

/** test fixture: a level plateau of plain ground (so results do not depend on the generated relief) */
function plateau(w: World, x: number, z: number, r: number, h = 2) {
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const t = w.idx(Math.floor(x) + dx, Math.floor(z) + dz); w.height[t] = h; w.water[t] = 0; w.setFeat(t, 0, 0); }
}

// 1. land in one stamp
{
  const sim = make(), w = sim.world, R = 20;
  const [x, z] = findSpot(w, true, R + 2);
  applyPower(sim, 'land', x, z, ctx(R));
  let inDisc = 0, land = 0;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) { if (Math.hypot(dx, dz) > R * 0.85) continue; inDisc++; if (!w.isWater(w.idx(Math.floor(x) + dx, Math.floor(z) + dz))) land++; }
  check('land: one stamp fills the disc', land / inDisc > 0.99, `${land}/${inDisc} tiles inside 85% of a radius-${R} brush are land after a single stamp`);
}
// 2. strength
{
  const a = make(), b = make();
  const [x, z] = findSpot(a.world, false, 6);
  const t = a.world.tileAt(x, z), h0 = a.world.height[t];
  applyPower(a, 'raise', x, z, ctx(5, { strength: 1 })); applyPower(b, 'raise', x, z, ctx(5, { strength: 2 }));
  const da = a.world.height[t] - h0, db = b.world.height[t] - h0;
  check('strength scales a pass', Math.abs(db / da - 2) < 0.01, `raise at the centre: +${da.toFixed(2)} at 100%, +${db.toFixed(2)} at 200%`);
}
// 3. smooth
{
  const sim = make(), w = sim.world;
  const [x, z] = findSpot(w, false, 12); plateau(w, x, z, 14);
  const rough = () => { let s = 0, n = 0; for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) { const t = w.idx(Math.floor(x) + dx, Math.floor(z) + dz); s += Math.abs(w.height[t] * 4 - w.height[t - 1] - w.height[t + 1] - w.height[t - w.W] - w.height[t + w.W]); n++; } return s / n; };
  for (let i = 0; i < 12; i++) applyPower(sim, 'mountain', x + sim.rng.range(-5, 5), z + sim.rng.range(-5, 5), ctx(2));
  const r0 = rough();
  for (let i = 0; i < 10; i++) applyPower(sim, 'smooth', x, z, ctx(9));
  const r1 = rough();
  check('smooth evens out rough ground', r1 < r0 * 0.4, `roughness ${r0.toFixed(3)} -> ${r1.toFixed(3)} after 10 passes`);
}
// 4-5. lake stroke and drain
{
  const sim = make(), w = sim.world;
  const [x, z] = findSpot(w, false, 14); plateau(w, x, z, 20);
  let sea0 = 0; for (let t = 0; t < w.N; t++) if (w.isWater(t)) sea0++;
  const level = w.height[w.tileAt(x - 10, z)];
  for (let i = 0; i <= 20; i++) applyPower(sim, 'lake', x - 10 + i, z + Math.sin(i * 0.4) * 2, ctx(2, { level }));
  let lake = 0, levels = new Set<number>(), hanging = 0;
  for (let dz = -8; dz <= 8; dz++) for (let dx = -16; dx <= 16; dx++) {
    const t = w.idx(Math.floor(x) + dx, Math.floor(z) + dz);
    if (!w.isWater(t)) continue;
    lake++; levels.add(Math.round(w.water[t] * 100));
    for (const n of [t - 1, t + 1, t - w.W, t + w.W]) if (!w.isWater(n) && w.height[n] < w.water[t] - 0.02) hanging++;
  }
  check('lake: a dragged stroke is one river at one level, with banks', lake > 60 && levels.size === 1 && hanging === 0, `water tiles ${lake}, distinct water levels ${levels.size}, water tiles above a lower dry neighbour ${hanging}`);
  for (let i = 0; i <= 20; i += 2) applyPower(sim, 'drain', x - 10 + i, z, ctx(6));
  let left = 0; for (let dz = -8; dz <= 8; dz++) for (let dx = -16; dx <= 16; dx++) { const t = w.idx(Math.floor(x) + dx, Math.floor(z) + dz); if (w.isWater(t)) left++; }
  const [sx, sz] = findSpot(w, true, 8);
  let seaBefore = 0, seaAfter = 0;
  for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) if (w.isWater(w.idx(Math.floor(sx) + dx, Math.floor(sz) + dz))) seaBefore++;
  applyPower(sim, 'drain', sx, sz, ctx(6));
  for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) if (w.isWater(w.idx(Math.floor(sx) + dx, Math.floor(sz) + dz))) seaAfter++;
  check('drain empties inland water, not the sea', left === 0 && seaAfter === seaBefore, `river tiles left ${left}; sea tiles under the brush ${seaBefore} -> ${seaAfter}`);
  void sea0;
}
// 6. fill
{
  const sim = make(), w = sim.world;
  const [x, z] = findSpot(w, false, 14); plateau(w, x, z, 20);
  const level = w.height[w.tileAt(x, z)];
  for (let i = 0; i < 6; i++) applyPower(sim, 'lake', x + Math.cos(i) * 3, z + Math.sin(i) * 3, ctx(5, { level }));
  let lake = 0; for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++) if (w.isWater(w.idx(Math.floor(x) + dx, Math.floor(z) + dz))) lake++;
  const ok = applyPower(sim, 'fill', x, z, ctx(4));
  let left = 0; for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++) if (w.isWater(w.idx(Math.floor(x) + dx, Math.floor(z) + dz))) left++;
  check('fill: a lake becomes land in one click', ok && lake > 40 && left === 0, `lake tiles ${lake} -> ${left}`);
}
// 7. undo / redo
{
  const sim = make(), w = sim.world, hist = new TerrainHistory();
  const stroke = (id: string, pts: [number, number][], brush: number) => {
    hist.begin(w); editHooks.touch = (x0, z0, x1, z1) => hist.touch(w, x0, z0, x1, z1);
    const level = w.height[Math.max(0, w.tileAt(pts[0][0], pts[0][1]))];
    for (const [px, pz] of pts) applyPower(sim, id, px, pz, ctx(brush, { level }));
    editHooks.touch = null; hist.end();
  };
  const [x, z] = findSpot(w, false, 14);
  const [sx, sz] = findSpot(w, true, 22);
  const d0 = digest(w);
  stroke('mountain', [[x, z], [x + 3, z + 1], [x + 6, z + 2]], 5); const d1 = digest(w);
  stroke('land', [[sx, sz], [sx + 8, sz]], 16); const d2 = digest(w);
  stroke('forest', [[x - 4, z - 4], [x, z - 6]], 6); const d3 = digest(w);
  stroke('lake', [[x - 8, z + 6], [x - 4, z + 7], [x, z + 8]], 3); const d4 = digest(w);
  const back: number[] = [];
  for (let i = 0; i < 4; i++) { hist.undo(sim); back.push(digest(w)); }
  const undoOk = back[0] === d3 && back[1] === d2 && back[2] === d1 && back[3] === d0;
  const fwd: number[] = [];
  for (let i = 0; i < 4; i++) { hist.redo(sim); fwd.push(digest(w)); }
  const redoOk = fwd[0] === d1 && fwd[1] === d2 && fwd[2] === d3 && fwd[3] === d4;
  check('undo / redo restore the land exactly', undoOk && redoOk && d0 !== d4 && !hist.canRedo, `4 strokes (mountain, land, forest, river): undo matches each earlier state ${undoOk}, redo matches each later state ${redoOk}`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
