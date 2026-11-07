/**
 * Body physics checks (simulation side, headless):
 *  1. knockback carries momentum: the victim slides back over several ticks (no teleport) and stops
 *  2. walls stop a slide: nobody is ever knocked or thrown into a building or a rock face
 *  3. gravity: a creature in the air falls, lands, and a long fall hurts more than a short one
 *  4. a downed saucer drops whoever it was beaming up
 *  5. solid features: over a long run, bodies do not stand inside tree trunks or boulders
 *  6. thrown creatures (no physics engine) fly in an arc and come down
 * Usage: npx tsx tools/physicstest.ts
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { Sp, YEAR_TICKS, Feat } from '../src/sim/defs';
import { UF } from '../src/sim/entities';
import { impulse, motionOpts } from '../src/sim/motion';
if (process.env.NOSOLID) motionOpts.features = false;
import { featureOffset, free } from '../src/sim/nav';

let fails = 0;
const check = (name: string, ok: boolean, info: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${info}`); if (!ok) fails++; };
const w = generateWorld({ size: 160, shape: 'pangaea', seed: 515 });
const sim = new Sim(w, 515); seedLife(sim, { tribes: 3 });
for (let i = 0; i < YEAR_TICKS * 3; i++) sim.step();
function openSpot(): [number, number] {
  for (let i = 0; i < 5000; i++) { const x = 8 + sim.rng.int(0, w.W - 16), z = 8 + sim.rng.int(0, w.H - 16); let ok = true; for (let dz = -3; dz <= 3 && ok; dz++) for (let dx = -3; dx <= 3 && ok; dx++) { const t = w.idx(x + dx, z + dz); if (!free(w, t) || w.feat[t] !== Feat.None) ok = false; } if (ok) return [x + 0.5, z + 0.5]; }
  throw new Error('no spot');
}
// 1. knockback slide
{
  const [x, z] = openSpot();
  const u = sim.spawnUnit(Sp.Sheep, x, z); u.task = { k: 'idle', t: 100 }; u.think = 100;
  for (const o of sim.units) if (o !== u && Math.hypot(o.x - x, o.z - z) < 16) { o.flags |= UF.Ragdoll; sim.killUnit(o, 'god'); } // nothing to spook it
  impulse(u, 0.25, 0);
  const xs: number[] = [];
  for (let i = 0; i < 12; i++) { sim.step(); xs.push(u.x); }
  const steps = xs.map((v, i) => v - (i ? xs[i - 1] : x));
  const total = xs[xs.length - 1] - x, first = steps[0];
  check('knockback slides with momentum and stops', first < total * 0.6 && Math.abs(steps[steps.length - 1]) < 0.01 && total > 0.4, `moved ${total.toFixed(2)} tiles over ${steps.filter((s) => s > 0.005).length} ticks (first tick ${first.toFixed(2)}), last tick ${steps[steps.length - 1].toFixed(3)}`);
}
// 2. walls stop it
{
  let bad = 0, tries = 0;
  for (const b of [...sim.buildings.values()].filter((b) => b.alive && b.progress >= 1 && b.kind !== 2).slice(0, 20)) {
    const x = b.x - 0.6, z = b.z + b.size / 2;
    const t = w.tileAt(x, z); if (t < 0 || !free(w, t)) continue;
    const u = sim.spawnUnit(Sp.Human, x, z); u.task = { k: 'idle', t: 100 }; u.think = 100;
    impulse(u, 0.6, 0); tries++;
    for (let i = 0; i < 15; i++) { sim.step(); const tt = w.tileAt(u.x, u.z); if (tt >= 0 && w.bld[tt] >= 0 && !w.bldPassable(tt)) bad++; }
  }
  check('walls stop a slide', tries > 3 && bad === 0, `shoved hard toward ${tries} buildings: samples inside a wall ${bad}`);
}
// 3. gravity & fall damage
{
  const [x, z] = openSpot();
  const a = sim.spawnUnit(Sp.Human, x, z), b = sim.spawnUnit(Sp.Human, x + 2, z);
  for (const u of [a, b]) { u.task = { k: 'idle', t: 100 }; u.think = 100; u.hp = u.maxHp; u.traits = 0; }
  a.y = 0.8; b.y = 9;
  let landA = -1, landB = -1;
  for (let i = 0; i < 40; i++) { sim.step(); if (landA < 0 && a.y === 0) landA = i; if (landB < 0 && b.y === 0) landB = i; }
  check('gravity: falls, lands; a long fall hurts more', landA >= 0 && landB > landA && b.hp < a.hp, `short drop landed after ${landA + 1} ticks (hp ${Math.round(a.hp)}), 9-tile drop after ${landB + 1} ticks (hp ${Math.round(b.hp)})`);
}
// 4. downed saucer drops its catch
{
  const [x, z] = openSpot();
  const ufo = sim.spawnUnit(Sp.UFO, x, z);
  const v = sim.spawnUnit(Sp.Bear, x, z); v.hp = 5000; // tough enough to live through the crash
  ufo.task = { k: 'abduct', u: v.id, t: 40 }; // beam it up
  for (let i = 0; i < 12; i++) sim.step();
  const caught = !!(v.flags & UF.Beamed), yUp = v.y;
  if (caught) { ufo.flags &= ~0; sim.killUnit(ufo, 'god'); }
  let landed = -1;
  const ys: string[] = [];
  for (let i = 0; i < 60; i++) { sim.step(); ys.push(v.y.toFixed(2)); if (landed < 0 && v.y === 0) landed = i; }
  if (process.env.DEBUG) console.log('heights after the crash', ys.slice(0, 16).join(' '), 'flags', v.flags, 'vy', v.vy);
  check('a downed saucer drops its catch, which falls', caught && yUp > 0.3 && landed >= 0, `beamed ${caught} at height ${yUp.toFixed(2)}, landed ${landed + 1} ticks after the crash (alive ${!(v.flags & UF.Dead)})`);
}
// 5. solid features over a long run
{
  let samples = 0, inside = 0;
  for (let i = 0; i < YEAR_TICKS * 2; i++) {
    sim.step();
    if (i % 10) continue;
    for (const u of sim.units) {
      if (u.flags & (UF.Dead | UF.Ragdoll | UF.Held) || u.y > 0.5 || u.sp === Sp.Fish) continue;
      const work = u.task && (u.task.k === 'gather' || u.task.k === 'farm') ? u.task.tile : -1;
      const x0 = Math.floor(u.x), z0 = Math.floor(u.z);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const t = w.tileAt(x0 + dx + 0.5, z0 + dz + 0.5); if (t < 0 || t === work) continue;
        const f = w.feat[t];
        const solid = f >= Feat.Oak && f <= Feat.Dead ? 0.09 : f === Feat.Boulder || f === Feat.Ore ? 0.2 : 0;
        if (!solid) continue;
        samples++;
        const [fx, fz] = featureOffset(x0 + dx, z0 + dz, f);
        if (Math.hypot(u.x - fx, u.z - fz) < solid) inside++;
      }
    }
  }
  check('bodies stay out of trunks and boulders', inside <= samples * 0.002, `${inside} of ${samples} body-near-trunk samples were inside the trunk/rock`);
}
// 6. thrown in an arc
{
  const [x, z] = openSpot();
  const u = sim.spawnUnit(Sp.Deer, x, z);
  sim.fling(u, 6, 8, 0);
  let peak = 0, landed = -1;
  for (let i = 0; i < 40; i++) { sim.step(); peak = Math.max(peak, u.y); if (landed < 0 && u.y === 0 && i > 0) landed = i; }
  check('thrown creatures fly in an arc and come down', peak > 0.5 && landed > 3 && u.x > x + 1, `peak height ${peak.toFixed(2)}, landed after ${landed + 1} ticks, ${(u.x - x).toFixed(1)} tiles downrange`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
