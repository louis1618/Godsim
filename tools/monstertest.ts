/**
 * New content and element interactions, run headless:
 *  zombie bites spread the infection · a sorcerer hurls fireballs and raises the dead · UFOs beam
 *  creatures up · lightning seeks metal (and downs a saucer, whose crew climbs out) · demons set the
 *  grass alight and are scalded by water · cold ones put fires out and freeze water into ice ·
 *  town mages heal · towers shoot (turrets later) · acid rain corrodes metal fastest and kills crops ·
 *  napalm sets a street on fire · burning creatures run for water · save/load keeps it all.
 * Usage: npx tsx tools/monstertest.ts
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { Sp, Bk, Feat, Mat, YEAR_TICKS, isCiv } from '../src/sim/defs';
import { UF, Job } from '../src/sim/entities';
import type { Unit } from '../src/sim/entities';
import { applyPower } from '../src/sim/powers';
import { placeBuilding, findSite, declareWar, createKingdom } from '../src/sim/civ';
import { lightning } from '../src/sim/disasters';
import { spawnVehicle } from '../src/sim/vehicles';
import { serialize, deserialize } from '../src/sim/save';
import { fireTiles } from '../src/sim/nature';
import { clearClaims } from '../src/sim/ai';
import { clearFarmClaims } from '../src/sim/civ';

let fails = 0;
const check = (name: string, ok: boolean, info: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${info}`); if (!ok) fails++; };
function make(seed: number, years = 4) {
  fireTiles.clear(); clearClaims(); clearFarmClaims();
  const w = generateWorld({ size: 192, shape: 'continents', seed });
  const sim = new Sim(w, seed); seedLife(sim, { tribes: 4 });
  sim.laws.disasters = false;
  for (let i = 0; i < YEAR_TICKS * years; i++) sim.step();
  return sim;
}
const biggest = (sim: Sim) => [...sim.villages.values()].filter((v) => v.alive).sort((a, b) => b.residents.length - a.residents.length)[0];
const count = (sim: Sim, sp: Sp) => sim.units.filter((u) => u.sp === sp && !(u.flags & UF.Dead)).length;
const fxCount = (sim: Sim, n: number, t: string, cb?: () => void) => { let c = 0; for (let i = 0; i < n; i++) { sim.fx.length = 0; sim.step(); c += sim.fx.filter((e) => e.t === t).length; cb?.(); } return c; };
const ctx = { brush: 3, dt: 0.1, first: true };
const only = (process.env.ONLY ?? '').split(',').filter(Boolean).map(Number);
const run = (n: number) => !only.length || only.includes(n);

// 1. zombies
if (run(1)){
  const sim = make(71);
  const v = biggest(sim);
  const pop0 = v.residents.length;
  applyPower(sim, 'outbreak', v.cx + 0.5, v.cz + 0.5, ctx);
  const z0 = count(sim, Sp.Zombie);
  let zMax = z0;
  for (let i = 0; i < 900; i++) { sim.step(); zMax = Math.max(zMax, count(sim, Sp.Zombie)); }
  check('zombie bites spread the infection', zMax > z0 && v.residents.length < pop0, `zombies ${z0} -> peak ${zMax}, town ${pop0} -> ${v.residents.length} people, zombies left ${count(sim, Sp.Zombie)}`);
}
// 2. sorcerer
if (run(2)){
  const sim = make(72);
  const v = biggest(sim);
  applyPower(sim, 'mage', v.cx + 6.5, v.cz + 0.5, ctx);
  const m = sim.units.find((u) => u.sp === Sp.Mage)!;
  let blinks = 0, rises = 0;
  const balls = fxCount(sim, 600, 'fireball', () => { blinks += sim.fx.filter((e) => e.t === 'blink').length; rises += sim.fx.filter((e) => e.t === 'rise').length; });
  check('sorcerer casts fireballs (and blinks / raises the dead)', balls > 0, `fireballs ${balls}, blinks ${blinks}, skeletons raised ${rises}, sorcerer ${m.flags & UF.Dead ? 'slain' : 'alive hp ' + Math.round(m.hp)}`);
}
// 3. UFO abductions; 4. lightning downs a UFO (seeks metal), crew climbs out
if (run(3)){
  const sim = make(73);
  const v = biggest(sim);
  applyPower(sim, 'ufo', v.cx + 0.5, v.cz + 0.5, ctx);
  let beams = 0;
  for (let i = 0; i < 900 && !sim.stats.abducted; i++) { sim.fx.length = 0; sim.step(); beams += sim.fx.filter((e) => e.t === 'beam').length; }
  check('UFO beams creatures up', (sim.stats.abducted ?? 0) > 0, `abducted ${sim.stats.abducted ?? 0}, beam frames ${beams}`);
  const ufo = sim.units.find((u) => u.sp === Sp.UFO && !(u.flags & UF.Dead))!;
  const aliens0 = count(sim, Sp.Alien);
  // strike 3 tiles off: the bolt should find the saucer's metal hull
  lightning(sim, ufo.x + 3, ufo.z);
  for (let i = 0; i < 40; i++) sim.step();
  check('lightning seeks metal and downs the saucer; aliens climb out', !!(ufo.flags & UF.Dead) && count(sim, Sp.Alien) > aliens0, `ufo ${ufo.flags & UF.Dead ? 'down' : 'still flying hp ' + Math.round(ufo.hp)}, aliens ${aliens0} -> ${count(sim, Sp.Alien)}`);
  // a tank draws the bolt too
  const k = sim.kingdoms.get(v.kingdom)!;
  const tank = spawnVehicle(sim, Sp.Tank, v.cx + 8, v.cz + 8, k.id, -1);
  const hp0 = tank.hp;
  lightning(sim, tank.x + 2.5, tank.z + 1);
  check('lightning seeks metal (tank 2.7 tiles away is struck)', tank.hp < hp0, `tank hp ${hp0} -> ${Math.round(tank.hp)}`);
}
// 5. demon: fire where it walks, scalded by water
if (run(5)){
  const sim = make(74);
  const v = biggest(sim);
  applyPower(sim, 'demon', v.cx + 7.5, v.cz + 0.5, ctx);
  const d = sim.units.find((u) => u.sp === Sp.Demon)!;
  let fires = 0;
  for (let i = 0; i < 300; i++) { sim.step(); if (i % 10 === 0) { let f = 0; for (let t = 0; t < sim.world.N; t++) if (sim.world.fire[t]) f++; fires = Math.max(fires, f); } }
  // drop it into water
  const w = sim.world;
  let wt = -1; for (let t = 0; t < w.N; t += 7) if (w.isWater(t) && w.waterDepth(t) > 0.5) { wt = t; break; }
  let scald = 0;
  if (!(d.flags & UF.Dead) && wt >= 0) { d.x = d.px = (wt % w.W) + 0.5; d.z = d.pz = ((wt / w.W) | 0) + 0.5; const h0 = d.hp; for (let i = 0; i < 30; i++) sim.step(); scald = h0 - d.hp; }
  check('demon sets the ground alight and water scalds it', fires > 0 && scald > 0, `burning tiles peak ${fires}, hp lost in water over 3 s ${Math.round(scald)}`);
}
// 6. cold one: puts fires out, freezes water into walkable ice
if (run(6)){
  const sim = make(75);
  const w = sim.world;
  let wt = -1; for (let t = 0; t < w.N; t++) { if (w.isWater(t) && w.waterDepth(t) < 0.6 && w.bld[t] < 0) { const x = t % w.W, z = (t / w.W) | 0; let land = -1; for (const n of [t - 1, t + 1, t - w.W, t + w.W]) if (n >= 0 && n < w.N && w.walkable(n)) land = n; if (land >= 0 && x > 4 && z > 4) { wt = land; break; } } }
  const lx = (wt % w.W) + 0.5, lz = ((wt / w.W) | 0) + 0.5;
  // light a fire next to it too
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const t = w.tileAt(lx + dx, lz + dz); if (t >= 0 && !w.isWater(t)) w.fire[t] = 200; }
  let water0 = 0; for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const t = w.tileAt(lx + dx, lz + dz); if (t >= 0 && w.isWater(t)) water0++; }
  applyPower(sim, 'coldone', lx, lz, ctx);
  const c = sim.units.find((u) => u.sp === Sp.ColdOne)!;
  c.task = { k: 'idle', t: 100 }; c.think = 100;
  for (let i = 0; i < 12; i++) sim.step();
  let water1 = 0, fire1 = 0, snow = 0; for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const t = w.tileAt(lx + dx, lz + dz); if (t < 0) continue; if (w.isWater(t)) water1++; if (w.fire[t]) fire1++; if (w.mat[t] === Mat.Snow) snow++; }
  check('cold one freezes water into ice and snuffs fires', water1 < water0 && fire1 === 0 && snow > 0, `open water tiles ${water0} -> ${water1}, burning tiles left ${fire1}, snow/ice tiles ${snow}`);
}
// 7. town mage heals; 8. towers shoot
if (run(7)){
  const sim = make(76, 6);
  const v = biggest(sim);
  const k = sim.kingdoms.get(v.kingdom)!; k.era = Math.max(1, k.era);
  for (let i = 0; i < 40; i++) { const s = findSite(sim, v, Bk.Library); if (s) { placeBuilding(sim, v, Bk.Library, s[0], s[1], v.race, 1); break; } }
  for (let i = 0; i < 40; i++) { const s = findSite(sim, v, Bk.Tower); if (s) { placeBuilding(sim, v, Bk.Tower, s[0], s[1], v.race, 1); break; } }
  for (let i = 0; i < 400; i++) sim.step();
  const mages = v.residents.map((id) => sim.getUnit(id)).filter((u) => u && u.job === Job.Mage) as Unit[];
  // wound a few townsfolk
  const hurtOnes = v.residents.map((id) => sim.getUnit(id)!).filter((u) => u && !(u.flags & UF.King) && u.job !== Job.Mage).slice(0, 4);
  for (const u of hurtOnes) u.hp = u.maxHp * 0.3;
  const heals = fxCount(sim, 500, 'heal');
  check('town mage trained at the library heals the wounded', mages.length > 0 && heals > 0, `mages ${mages.length}, heal pulses ${heals}`);
  // an enemy walks up to a tower
  const tower = [...v.buildings].map((id) => sim.buildings.get(id)!).find((b) => b && b.kind === Bk.Tower && b.progress >= 1)!;
  const ek = createKingdom(sim, Sp.Orc); declareWar(sim, ek, k, true);
  const foe = sim.spawnUnit(Sp.Orc, tower.x + 4.5, tower.z + 0.5, { kingdom: ek.id });
  foe.hp = 5000; // above max: no natural healing during the window
  const fhp = foe.hp;
  const arrows = fxCount(sim, 80, 'arrow', () => { if (!(foe.flags & UF.Dead)) { foe.x = tower.x + 4.5; foe.z = tower.z + 0.5; foe.task = { k: 'idle', t: 50 }; foe.think = 50; } });
  check('watchtower shoots enemies', arrows > 0 && (foe.hp < fhp || !!(foe.flags & UF.Dead)), `arrows ${arrows}, enemy hp ${fhp} -> ${Math.max(0, Math.round(foe.hp))}`);
  k.era = 3;
  const foe2 = sim.spawnUnit(Sp.Zombie, tower.x + 5.5, tower.z + 0.5);
  foe2.hp = 5000; // a tough target, so the turret fires for the whole window
  const shots = fxCount(sim, 80, 'shot', () => { if (!(foe2.flags & UF.Dead)) { foe2.x = tower.x + 5.5; foe2.z = tower.z + 0.5; foe2.task = { k: 'idle', t: 50 }; foe2.think = 50; } });
  check('industrial-age tower becomes a machine-gun turret', tower.level === 1 && shots > arrows, `turret ${tower.level === 1}, bursts in 8 s ${shots} (arrows in 8 s ${arrows})`);
}
// 9. acid rain
if (run(9)){
  const sim = make(77);
  const v = biggest(sim);
  const k = sim.kingdoms.get(v.kingdom)!;
  const tank = spawnVehicle(sim, Sp.Tank, v.cx + 1.5, v.cz + 1.5, k.id, -1);
  const man = v.residents.map((id) => sim.getUnit(id)!).find((u) => u && isCiv(u.sp))!;
  let crops0 = 0; const w = sim.world; for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) { const t = w.tileAt(v.cx + dx, v.cz + dz); if (t >= 0 && w.feat[t] === Feat.Crop) crops0++; }
  applyPower(sim, 'acidrain', v.cx + 0.5, v.cz + 0.5, ctx);
  let tankLoss = 0, manLoss = 0;
  for (let i = 0; i < 200; i++) {
    const th = tank.hp, mh = man.hp;
    tank.x = tank.px = v.cx + 1.5; tank.z = tank.pz = v.cz + 1.5; man.x = man.px = v.cx + 0.5; man.z = man.pz = v.cz + 2.5;
    sim.step();
    if (!(tank.flags & UF.Dead)) tankLoss += Math.max(0, th - tank.hp);
    if (!(man.flags & UF.Dead)) manLoss += Math.max(0, mh - man.hp - 0);
  }
  let crops1 = 0; for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) { const t = w.tileAt(v.cx + dx, v.cz + dz); if (t >= 0 && w.feat[t] === Feat.Crop) crops1++; }
  check('acid rain corrodes metal faster than flesh and kills crops', tankLoss > manLoss && crops1 < crops0, `tank lost ${Math.round(tankLoss)} hp, villager ${Math.round(manLoss)} hp, crops ${crops0} -> ${crops1}`);
}
// 10. napalm; 11. burning creatures run for water
if (run(10)){
  const sim = make(78);
  const v = biggest(sim);
  applyPower(sim, 'napalm', v.cx + 0.5, v.cz + 0.5, ctx);
  let peak = 0;
  for (let i = 0; i < 60; i++) { sim.step(); let f = 0; for (let t = 0; t < sim.world.N; t++) if (sim.world.fire[t]) f++; peak = Math.max(peak, f); }
  check('napalm sets a whole area on fire', peak > 25, `burning tiles peak ${peak}`);
  const w = sim.world;
  // find shore land 3 tiles from water
  let spot = -1; for (let t = 0; t < w.N && spot < 0; t += 3) { if (!w.walkable(t) || w.fire[t]) continue; const x = t % w.W, z = (t / w.W) | 0; for (let d = 2; d <= 4; d++) { const n = w.tileAt(x + d + 0.5, z + 0.5); if (n >= 0 && w.isWater(n) && w.waterDepth(n) < 1) { spot = t; break; } } }
  const u = sim.spawnUnit(Sp.Human, (spot % w.W) + 0.5, ((spot / w.W) | 0) + 0.5);
  u.flags |= UF.Burning;
  let reachedWater = false, out = -1;
  for (let i = 0; i < 120; i++) { sim.step(); if (w.isWater(w.tileAt(u.x, u.z))) reachedWater = true; if (out < 0 && !(u.flags & UF.Burning)) out = i; if (u.flags & UF.Dead) break; }
  check('burning creatures run into water to put themselves out', reachedWater && out >= 0, `reached water ${reachedWater}, flames out after ${(out / 10).toFixed(1)} s, alive ${!(u.flags & UF.Dead)}`);
}
// 12. save / load keeps the new content
if (run(12)){
  const sim = make(79, 2);
  const v = biggest(sim);
  applyPower(sim, 'acidrain', v.cx, v.cz, ctx);
  applyPower(sim, 'zombie', v.cx + 5, v.cz, ctx); applyPower(sim, 'ufo', v.cx, v.cz + 5, ctx); applyPower(sim, 'coldone', v.cx - 5, v.cz, ctx);
  for (let i = 0; i < 30; i++) sim.step();
  const s1 = deserialize(serialize(sim));
  const sameMonsters = [Sp.Zombie, Sp.UFO, Sp.ColdOne].every((sp) => count(s1, sp) === count(sim, sp));
  for (let i = 0; i < 200; i++) { sim.step(); s1.step(); }
  const h = (s: Sim) => { let x = 0; for (const u of s.units) x = (x * 31 + Math.round(u.x * 50) + u.sp) | 0; return x; };
  check('save/load keeps monsters and acid rain (and replays identically)', sameMonsters && s1.acidRains.length === sim.acidRains.length && h(s1) === h(sim), `monsters equal ${sameMonsters}, acid clouds ${sim.acidRains.length}/${s1.acidRains.length}, replay hash ${h(sim) === h(s1) ? 'match' : 'DIFF'}`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');

