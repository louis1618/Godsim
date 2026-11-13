/**
 * Terrain brush through the real page: a fast flick with the land brush must leave an unbroken
 * strip, a huge brush must stay responsive, and Ctrl+Z must bring the sea back.
 * Needs the dev server:  npm run dev   then   node tools/browser/brush_stroke.cjs [out.png]
 */
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 }, locale: 'ko-KR' });
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  let fails = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${info}`); if (!ok) fails++; };
  await p.goto((process.env.URL || 'http://localhost:5173/') + '?play&noauto');
  await p.waitForSelector('.dock', { timeout: 240000 });
  // look straight down at the longest stretch of open sea
  const spot = await p.evaluate(() => {
    // test fixture: a stretch of open sea in the middle of the map
    const w = game.sim.world; const best = { x: w.W / 2, z: w.H / 2 };
    for (let z = (w.H >> 1) - 30; z <= (w.H >> 1) + 30; z++) for (let x = 6; x < w.W - 6; x++) { const t = w.idx(x, z); w.height[t] = -3; w.water[t] = 0; w.mat[t] = 2; w.setFeat(t, 0, 0); const bd = game.sim.buildingAt(t); if (bd) game.sim.removeBuilding(bd, false); }
    w.markTerrain(0, 0, w.W - 1, w.H - 1);
    const r = game.gr.rig; r.follow = null; r.tOrbit = 0; r.focus.set(best.x, 0, best.z); r.tFocus.copy(r.focus); r.V = r.tV = 46; r.tTilt = 0; r.tYaw = 0;
    game.paused = true;
    return best;
  });
  // software rendering is slow: wait until the camera has really arrived before measuring anything
  await p.evaluate(() => app.setQuality('low'));
  // pin the camera where it should be (no easing still in flight when positions are measured)
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await p.evaluate(() => { const r = game.gr.rig; r.follow = null; r['flyRate'] = 0; r.focus.copy(r.tFocus); r.V = r.tV; r.tilt = r.tTilt; r.yaw = r.tYaw; r.orbit = r.tOrbit = 0; r.apply(); });
      await p.waitForTimeout(900);
    }
  };
  await settle();
  const ground = (x, y) => p.evaluate(([x, y]) => { app.ctl['updateMouse']({ clientX: x, clientY: y }); const g = app.ctl.pickGround(); return g ? { x: g.x, z: g.z } : null; }, [x, y]);
  const seaBetween = (a, c) => p.evaluate(([a, c]) => { const w = game.sim.world; let n = 0, sea = 0; const where = []; const d = Math.hypot(c.x - a.x, c.z - a.z); for (let i = 0; i <= d * 2; i++) { const t = w.tileAt(a.x + (c.x - a.x) * i / (d * 2), a.z + (c.z - a.z) * i / (d * 2)); n++; if (t < 0 || w.isWater(t)) { sea++; where.push(i); } } return { n, sea, tiles: Math.round(d), where: where.length > 12 ? [] : where }; }, [a, c]);
  const frameTimes = (ms) => p.evaluate((ms) => new Promise((res) => { const ts = []; let last = performance.now(); const t0 = last; const f = () => { const n = performance.now(); ts.push(n - last); last = n; if (n - t0 < ms) requestAnimationFrame(f); else { ts.sort((a, b) => a - b); res({ avg: ts.reduce((a, b) => a + b, 0) / ts.length, p95: ts[Math.floor(ts.length * 0.95)], n: ts.length }); } }; requestAnimationFrame(f); }), ms);

  // 1. a fast flick: 700 px in 5 mouse events
  await p.evaluate(async () => { app.ctl.selectPower('land'); store.set({ brush: 3 }); });
  // both ends of the flick must be on the canvas itself (not on a HUD card)
  let A = { x: 300, y: 250 }, C = { x: 900, y: 250 };
  for (const y of [250, 200, 300, 160, 340]) { const ok = await p.evaluate(([y]) => [300, 600, 900].every((x) => document.elementFromPoint(x, y)?.tagName === 'CANVAS'), [y]); if (ok) { A = { x: 300, y }; C = { x: 900, y }; break; } }
  const ga = await ground(A.x, A.y), gc = await ground(C.x, C.y);
  const before = await seaBetween(ga, gc);
  await p.mouse.move(A.x, A.y); await p.mouse.down(); await p.waitForTimeout(60);
  for (let i = 1; i <= 5; i++) { await p.mouse.move(A.x + (C.x - A.x) * i / 5, A.y); await p.waitForTimeout(45); }
  await p.waitForTimeout(120); await p.mouse.up();
  await p.waitForTimeout(400);
  const after = await seaBetween(ga, gc);
  check('a fast flick leaves an unbroken strip of land', after.sea === 0, `${after.tiles} tiles crossed in ~0.3 s with a radius-3 brush: sea samples on the line ${before.sea}/${before.n} -> ${after.sea}/${after.n}${after.where.length ? ' (still sea at samples ' + after.where.join(',') + ')' : ''}`);
  if (process.argv[2]) await p.screenshot({ path: process.argv[2].replace('.png', '_strip.png'), timeout: 180000 });

  // 2. undo with the keyboard
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(300);
  const undone = await seaBetween(ga, gc);
  check('Ctrl+Z brings the sea back', undone.sea === before.sea, `sea samples on the line after undo ${undone.sea}/${undone.n} (was ${before.sea})`);
  await p.keyboard.press('Control+y');
  await p.waitForTimeout(300);
  const redone = await seaBetween(ga, gc);
  check('Ctrl+Y lays the strip again', redone.sea === 0, `sea samples after redo ${redone.sea}/${redone.n}`);

  // 3. a huge brush stays responsive. Frame time here is dominated by software GL, so the editing
  //    work itself is timed: brush stamps, terrain mesh and shoreline updates, per rendered frame.
  await p.evaluate(() => {
    store.set({ brush: 40 }); const r = game.gr.rig; r.V = r.tV = 150;
    const T = window.__T = { stamp: 0, stamps: 0, sync: 0, syncs: 0 };
    const wrap = (inst, name, k) => { const o = Object.getPrototypeOf(inst); const f0 = o[name]; o[name] = function (...a) { const dirty = k === 'sync' ? !game.sim.world.dirtyTerrain.empty : true; const t0 = performance.now(); const v = f0.apply(this, a); if (dirty) { T[k] += performance.now() - t0; T[k + 's']++; } return v; }; };
    wrap(game.gr.terrain, 'sync', 'sync');
    const ap = app.ctl['applyHeld'].bind(app.ctl); app.ctl['applyHeld'] = (dt) => { const t0 = performance.now(); const before = game.sim.world.terrainVersion; ap(dt); if (game.sim.world.terrainVersion !== before) { T.stamp += performance.now() - t0; T.stamps += game.sim.world.terrainVersion - before; } };
  });
  await settle();
  const land0 = await p.evaluate(() => { const w = game.sim.world; let n = 0; for (let t = 0; t < w.N; t++) if (!w.isWater(t)) n++; const T = window.__T; T.stamp = T.stamps = T.sync = T.syncs = 0; return n; });
  const sx = await p.evaluate(([y]) => [480, 400, 560, 320].find((x) => document.elementFromPoint(x, y)?.tagName === 'CANVAS') ?? 480, [A.y]);
  await p.mouse.move(sx, A.y); await p.mouse.down();
  for (let i = 0; i < 24; i++) { await p.mouse.move(sx + i * 12, A.y + Math.sin(i * 0.5) * 50); await p.waitForTimeout(50); }
  await p.mouse.up();
  await p.waitForTimeout(2500);
  const big = await p.evaluate(() => { const w = game.sim.world; let n = 0; for (let t = 0; t < w.N; t++) if (!w.isWater(t)) n++; return { land: n, ...window.__T }; });
  const perStamp = big.stamp / Math.max(1, big.stamps), perSync = big.sync / Math.max(1, big.syncs);
  check('a radius-40 brush paints a wide band and the editing work stays light', big.land - land0 > 4000 && perStamp < 8 && perSync < 12, `land tiles ${land0} -> ${big.land} in one drag; ${big.stamps} brush stamps at ${perStamp.toFixed(1)} ms each, ${big.syncs} terrain mesh updates at ${perSync.toFixed(1)} ms each`);
  if (process.argv[2]) { await p.waitForTimeout(600); await p.screenshot({ path: process.argv[2], timeout: 180000 }); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
