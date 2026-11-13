/**
 * Save prompt on the title screen (work order 5.3), driven through the real page.
 * Needs the dev server:  npm run dev   then   node tools/browser/intro_save.cjs
 *  1. first visit: "new world" from the title asks nothing (the backdrop world is nobody's)
 *  2. play, really change the terrain, leave through the menu: the prompt appears; save and go
 *  3. on the title the saved world stands still, and "new world" / "load" ask nothing
 *  4. reload the page: still nothing asked on the title, the world does not run behind the menu
 *  5. continue: the edit is still there; once time has passed, leaving asks again
 *  6. "leave without saving" really drops the changes and does not ask twice
 */
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 960, height: 540 }, locale: 'ko-KR' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  p.on('dialog', (d) => d.accept());
  let fails = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${info}`); if (!ok) fails++; };
  const url = process.env.URL || 'http://localhost:5173/?noauto';
  const boot = async () => { await p.goto(url); await p.waitForSelector('.title-menu', { timeout: 240000 }); await p.waitForTimeout(500); };
  const st = () => p.evaluate(async () => { const { store } = await import('/src/ui/store.ts'); return { screen: store.s.screen, confirm: !!store.s.confirm, tick: game.sim.tick, paused: game.paused, cont: !!store.s.continueMeta }; });
  const act = (code) => p.evaluate(`(async () => { const { store } = await import('/src/ui/store.ts'); ${code} })()`);
  const pressConfirm = (i) => act(`const c = store.s.confirm; store.set({ confirm: null }); await c.actions[${i}].fn();`);

  // 1. first visit
  await boot();
  let s = await st();
  await p.click('.title-card:has-text("새 세계")');
  await p.waitForTimeout(400);
  let s2 = await st();
  check('1 first visit: new world asks nothing', !s2.confirm && s2.screen === 'create', `title had a saved world: ${s.cont}; after the click: screen ${s2.screen}, prompt ${s2.confirm}`);
  await act(`app.startPlay();`);
  await p.waitForTimeout(1500);

  // 2. play and really edit the terrain
  const h0 = await p.evaluate(() => { const w = game.sim.world; return w.height[w.idx(w.W >> 1, w.H >> 1)]; });
  await p.evaluate(() => { const r = game.gr.rig; r.V = r.tV = 60; r.focus.set(game.sim.world.W / 2, 0, game.sim.world.H / 2); r.tFocus.copy(r.focus); app.ctl.selectPower('mountain'); });
  await p.waitForTimeout(600);
  await p.mouse.move(480, 270); await p.mouse.down(); await p.waitForTimeout(900); await p.mouse.up();
  const h1 = await p.evaluate(() => { const w = game.sim.world; return w.height[w.idx(w.W >> 1, w.H >> 1)]; });
  await act(`app.guard('title', () => app.toTitle());`);
  await p.waitForTimeout(300);
  s = await st();
  check('2 after a real edit, leaving asks', s.confirm && h1 > h0 + 0.5, `ground at the centre ${h0.toFixed(2)} -> ${h1.toFixed(2)}, prompt shown ${s.confirm}`);
  await pressConfirm(0); // save and go
  await p.waitForTimeout(1500);

  // 3. on the title: frozen, no prompts
  s = await st();
  await p.waitForTimeout(2500);
  s2 = await st();
  check('3a the saved world does not run behind the title', s2.screen === 'title' && s2.paused && s2.tick === s.tick, `screen ${s2.screen}, paused ${s2.paused}, tick ${s.tick} -> ${s2.tick} over 2.5 s`);
  await p.click('.title-card:has-text("새 세계")');
  await p.waitForTimeout(400);
  s = await st();
  check('3b title: new world asks nothing after a save', !s.confirm && s.screen === 'create', `screen ${s.screen}, prompt ${s.confirm}`);

  // 4. reload
  await boot();
  s = await st();
  await p.waitForTimeout(2500);
  s2 = await st();
  check('4a after a restart the saved world waits, unsimulated', s.cont && s2.paused && s2.tick === s.tick, `continue offered ${s.cont}, paused ${s2.paused}, tick ${s.tick} -> ${s2.tick} over 2.5 s`);
  let prompts = 0;
  for (let i = 0; i < 3; i++) {
    await p.click('.title-card:has-text("새 세계")'); await p.waitForTimeout(300);
    if ((await st()).confirm) { prompts++; await pressConfirm(2); }
    await act(`app.toTitle();`); await p.waitForTimeout(300);
  }
  await act(`app.guard('load', () => {});`); await p.waitForTimeout(200);
  if ((await st()).confirm) { prompts++; await pressConfirm(2); }
  check('4b title after a restart: no save prompts at all', prompts === 0, `prompts in 3 x new world + 1 x load: ${prompts}`);

  // 5. continue: edit restored; time passing makes it dirty again
  await boot();
  await p.click('.title-card.cont');
  await p.waitForTimeout(1200);
  const h2 = await p.evaluate(() => { const w = game.sim.world; return w.height[w.idx(w.W >> 1, w.H >> 1)]; });
  await act(`app.guard('newworld', () => {});`); await p.waitForTimeout(100);
  const early = (await st()).confirm; if (early) await pressConfirm(2);
  await p.waitForTimeout(3000);
  await act(`app.guard('newworld', () => {});`); await p.waitForTimeout(200);
  s = await st();
  check('5 continue restores the edit; unsaved play time asks again', Math.abs(h2 - h1) < 0.01 && s.confirm, `restored height ${h2.toFixed(2)} (saved ${h1.toFixed(2)}), prompt after 3 s of play ${s.confirm}`);
  const tickBefore = s.tick;
  // 6. leave without saving
  await act(`const c = store.s.confirm; store.set({ confirm: null }); c.actions[1].fn = ((f) => f)(c.actions[1].fn); await c.actions[1].fn();`);
  await act(`app.toTitle();`); await p.waitForTimeout(600);
  await p.click('.title-card:has-text("새 세계")'); await p.waitForTimeout(300);
  s = await st();
  const again = s.confirm; if (again) await pressConfirm(2);
  await boot();
  await p.click('.title-card.cont'); await p.waitForTimeout(800);
  s2 = await st();
  check('6 leaving without saving drops the changes and asks once', !again && s2.tick < tickBefore, `second prompt ${again}; tick when left ${tickBefore}, tick after continuing ${s2.tick}`);
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
