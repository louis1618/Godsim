/**
 * Utility-AI behaviour checks (headless):
 *  1. herd alarm: one sheep spots a wolf -> the flock bolts together
 *  2. pack hunting: a wolf that starts a hunt brings its pack onto the same prey
 *  3. call for help: a villager attacked by a monster -> guards / soldiers / mages come running
 *  4. hazards: villagers walk out of a fire, and clear the ground under an incoming bomb before it lands
 *  5. personality and species: a brave villager fights an orc raider, a peaceful one runs; a boar
 *     fights back against a fox, a deer runs from it
 *  6. self-preservation: a badly wounded, outnumbered soldier falls back; a healthy one holds the line
 *  7. needs by score: a starving villager eats before working, an exhausted one sleeps, a badly hurt one rests
 * Usage: npx tsx tools/aitest.ts
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { Sp, Trait, YEAR_TICKS } from '../src/sim/defs';
import { UF, Job } from '../src/sim/entities';
import type { Unit, Village } from '../src/sim/entities';
import { createKingdom, declareWar } from '../src/sim/civ';
import { spawnMissile } from '../src/sim/disasters';
import { ignite } from '../src/sim/nature';
import { perceive, fightOrFlight } from '../src/sim/utility';

let fails = 0;
const check = (name: string, ok: boolean, info: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${info}`); if (!ok) fails++; };
function make(seed: number, years = 3) {
  const w = generateWorld({ size: 160, shape: 'pangaea', seed });
  const sim = new Sim(w, seed); seedLife(sim, { tribes: 3 });
  sim.laws.disasters = false;
  for (let i = 0; i < YEAR_TICKS * years; i++) sim.step();
  return sim;
}
const biggest = (sim: Sim) => [...sim.villages.values()].filter((v) => v.alive).sort((a, b) => b.residents.length - a.residents.length)[0];
/** an open patch of land away from towns */
function openLand(sim: Sim, avoid: Village | undefined, r = 6): [number, number] {
  const w = sim.world;
  for (let i = 0; i < 4000; i++) {
    const x = 10 + sim.rng.int(0, w.W - 20), z = 10 + sim.rng.int(0, w.H - 20);
    if (avoid && Math.hypot(x - avoid.cx, z - avoid.cz) < 25) continue;
    let ok = true;
    for (let dz = -r; dz <= r && ok; dz += 2) for (let dx = -r; dx <= r && ok; dx += 2) { const t = w.tileAt(x + dx, z + dz); if (t < 0 || !w.walkable(t) || w.bld[t] >= 0 || w.owner[t] >= 0) ok = false; }
    if (ok) return [x + 0.5, z + 0.5];
  }
  throw new Error('no open land');
}
const clear = (sim: Sim, x: number, z: number, r: number, keep: Unit[]) => { for (const u of sim.units) if (!keep.includes(u) && Math.hypot(u.x - x, u.z - z) < r) { u.flags |= UF.Ragdoll; sim.killUnit(u, 'god'); } };

// 1. herd alarm
{
  const sim = make(301);
  const [x, z] = openLand(sim, biggest(sim));
  const flock: Unit[] = [];
  for (let i = 0; i < 6; i++) flock.push(sim.spawnUnit(Sp.Sheep, x + (i % 3) * 0.8, z + Math.floor(i / 3) * 0.8));
  clear(sim, x, z, 14, flock);
  for (const s of flock) { s.task = { k: 'idle', t: 300 }; s.think = 100 + s.id % 7; }
  const wolf = sim.spawnUnit(Sp.Wolf, x - 3.5, z + 0.4, { hunger: 90 });
  wolf.task = { k: 'idle', t: 400 }; wolf.think = 400; // the wolf just stands there: the flock must notice it
  flock[0].think = 1; // only one sheep looks up
  let fleeing = 0;
  for (let i = 0; i < 15; i++) { sim.step(); fleeing = Math.max(fleeing, flock.filter((s) => s.task?.k === 'flee').length); }
  check('herd alarm: the flock bolts together', fleeing >= 4, `sheep fleeing within 1.5 s: ${fleeing}/6 (only one was looking)`);
}
// 2. pack hunting
{
  const sim = make(302);
  const [x, z] = openLand(sim, biggest(sim));
  const pack: Unit[] = [];
  for (let i = 0; i < 4; i++) pack.push(sim.spawnUnit(Sp.Wolf, x + i * 0.7, z, { hunger: 80 }));
  const deer = sim.spawnUnit(Sp.Deer, x + 6, z + 1);
  clear(sim, x, z, 16, [...pack, deer]);
  for (const w of pack) { w.task = { k: 'idle', t: 300 }; w.think = 200; }
  deer.task = { k: 'idle', t: 300 }; deer.think = 300;
  pack[0].think = 1;
  let same = 0;
  for (let i = 0; i < 10; i++) { sim.step(); same = Math.max(same, pack.filter((w) => (w.task?.k === 'hunt' || w.task?.k === 'attack') && (w.task as any).u === deer.id).length); }
  check('pack hunting: wolves join the same hunt', same >= 3, `wolves on the same deer: ${same}/4 (one started the hunt)`);
}
// 3. call for help
{
  const sim = make(303, 5);
  const v = biggest(sim);
  const k = sim.kingdoms.get(v.kingdom)!; k.era = Math.max(1, k.era);
  const folk = v.residents.map((id) => sim.getUnit(id)!).filter((u) => u && u.age >= 8 && !(u.flags & UF.King));
  const guards = folk.slice(0, 3);
  for (const g of guards) { g.job = Job.Guard; g.task = { k: 'idle', t: 300 }; g.think = 300; }
  const victim = folk.find((u) => !guards.includes(u) && u.job !== Job.Warrior)!;
  victim.traits = 0; victim.job = Job.Farmer;
  const demon = sim.spawnUnit(Sp.Demon, victim.x + 1.2, victim.z);
  demon.task = { k: 'attack', u: victim.id }; demon.think = 100;
  victim.think = 1;
  let responders = 0;
  for (let i = 0; i < 30; i++) { sim.step(); responders = Math.max(responders, sim.units.filter((o) => o.kingdom === v.kingdom && o.task?.k === 'attack' && (o.task as any).u === demon.id && o !== victim).length); }
  check('call for help: the town comes to the rescue', responders >= 1, `defenders converging on the demon within 3 s: ${responders} (victim ${victim.flags & UF.Dead ? 'fell' : 'alive'})`);
}
// 4. hazards
{
  const sim = make(304, 4);
  const v = biggest(sim);
  const w = sim.world;
  const folk = v.residents.map((id) => sim.getUnit(id)!).filter((u) => u && !(u.flags & UF.King)).slice(0, 6);
  // light fires right around them
  for (const u of folk) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) { const t = w.tileAt(u.x + dx, u.z + dz); if (t >= 0) ignite(sim, t, 250); }
  for (const u of folk) u.think = 1;
  for (let i = 0; i < 40; i++) sim.step();
  const inFire = folk.filter((u) => !(u.flags & UF.Dead) && (() => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const t = w.tileAt(u.x + dx, u.z + dz); if (t >= 0 && w.fire[t] > 30) return true; } return false; })()).length;
  check('hazard: villagers walk out of the fire', inFire <= 1, `still next to flames after 4 s: ${inFire}/6`);
  // incoming bomb
  const sim2 = make(305, 4);
  const v2 = biggest(sim2);
  const cx = v2.cx + 0.5, cz = v2.cz + 0.5;
  const inBlast = () => sim2.units.filter((u) => !(u.flags & UF.Dead) && u.sp <= Sp.Orc && Math.hypot(u.x - cx, u.z - cz) < 2.8).length;
  spawnMissile(sim2, cx, cz, 'bomb');
  const n0 = inBlast();
  let nImpact = n0;
  for (let i = 0; i < 40 && sim2.missiles.length; i++) { nImpact = inBlast(); sim2.step(); }
  check('hazard: the ground under an incoming bomb clears before impact', nImpact < n0 || n0 === 0, `villagers in the blast radius at launch ${n0}, at impact ${nImpact}`);
}
// 5. personality & species
{
  const sim = make(306, 4);
  const v = biggest(sim);
  const k = sim.kingdoms.get(v.kingdom)!;
  const [x, z] = openLand(sim, v);
  const brave = sim.spawnUnit(v.race, x, z, { kingdom: k.id, traits: Trait.Brave, age: 20 });
  const meek = sim.spawnUnit(v.race, x + 1.5, z, { kingdom: k.id, traits: Trait.Peaceful, age: 20 });
  for (const u of [brave, meek]) { u.job = Job.Farmer; u.village = -1; }
  const ek = createKingdom(sim, Sp.Orc); declareWar(sim, ek, k, true);
  const raider = sim.spawnUnit(Sp.Orc, x + 0.8, z + 2.5, { kingdom: ek.id, age: 20 });
  raider.task = { k: 'idle', t: 200 }; raider.think = 200;
  clear(sim, x, z, 12, [brave, meek, raider]);
  brave.think = 1; meek.think = 1;
  if (process.env.DEBUG) { const p = perceive(sim, brave, raider, Math.hypot(raider.x - brave.x, raider.z - brave.z)); console.log('brave', JSON.stringify(fightOrFlight(sim, brave, p)), 'danger', p.danger, 'hazard', JSON.stringify(p.hazard), 'hp', brave.hp, brave.maxHp); }
  sim.step(); sim.step();
  const bChoice = brave.task?.k, mChoice = meek.task?.k;
  check('personality: the brave fight, the peaceful run', bChoice === 'attack' && mChoice === 'flee', `brave -> ${bChoice}, peaceful -> ${mChoice}`);
  const [x2, z2] = openLand(sim, v);
  const boar = sim.spawnUnit(Sp.Boar, x2, z2), deer = sim.spawnUnit(Sp.Deer, x2 + 2, z2);
  const wolf = sim.spawnUnit(Sp.Wolf, x2 + 1, z2 + 1.2, { hunger: 95 });
  clear(sim, x2, z2, 12, [boar, deer, wolf]);
  wolf.task = { k: 'attack', u: boar.id }; wolf.think = 200;
  boar.think = 1; deer.think = 1;
  sim.step(); sim.step();
  check('species: a boar fights back, a deer runs', boar.task?.k === 'attack' && deer.task?.k === 'flee', `wolf attacks a boar: boar -> ${boar.task?.k}, deer nearby -> ${deer.task?.k}`);
}
// 6. self-preservation
{
  const sim = make(307, 4);
  const v = biggest(sim);
  const k = sim.kingdoms.get(v.kingdom)!;
  const ek = createKingdom(sim, Sp.Orc); declareWar(sim, ek, k, true);
  const [x, z] = openLand(sim, v);
  const hurtOne = sim.spawnUnit(v.race, x, z, { kingdom: k.id, age: 20 });
  const fresh = sim.spawnUnit(v.race, x + 30 > sim.world.W - 5 ? x - 30 : x + 30, z, { kingdom: k.id, age: 20 });
  for (const s of [hurtOne, fresh]) { s.job = Job.Warrior; s.traits = 0; s.village = -1; }
  hurtOne.hp = hurtOne.maxHp * 0.2;
  const orcsA = [0, 1, 2].map((i) => sim.spawnUnit(Sp.Orc, hurtOne.x + 2 + i * 0.6, z + 1, { kingdom: ek.id, age: 20 }));
  const orcB = sim.spawnUnit(Sp.Orc, fresh.x + 2, z + 1, { kingdom: ek.id, age: 20 });
  for (const o of [...orcsA, orcB]) { o.task = { k: 'idle', t: 200 }; o.think = 200; }
  clear(sim, x, z, 10, [hurtOne, ...orcsA]); clear(sim, fresh.x, z, 10, [fresh, orcB]);
  hurtOne.think = 1; fresh.think = 1;
  sim.step(); sim.step();
  check('self-preservation: wounded and outnumbered retreats, healthy holds', hurtOne.task?.k === 'flee' && fresh.task?.k === 'attack', `wounded soldier (20% hp vs 3 orcs) -> ${hurtOne.task?.k}, healthy soldier (vs 1 orc) -> ${fresh.task?.k}`);
}
// 7. needs
{
  const sim = make(308, 4);
  const v = biggest(sim);
  v.food = Math.max(v.food, 50);
  const folk = v.residents.map((id) => sim.getUnit(id)!).filter((u) => u && u.age >= 8 && !(u.flags & UF.King) && u.job !== Job.Warrior).slice(0, 3);
  const [hungry, tired, wounded] = folk;
  // nothing hostile around, so only needs are in play
  for (const o of sim.units) if (folk.some((f) => Math.hypot(o.x - f.x, o.z - f.z) < 10) && (sim.hostile(folk[0], o) || o.sp === Sp.Wolf || o.sp === Sp.Bear)) { o.flags |= UF.Ragdoll; sim.killUnit(o, 'god'); }
  hungry.hunger = 92; hungry.energy = 90; hungry.task = null; hungry.think = 1;
  tired.energy = 4; tired.hunger = 10; tired.task = null; tired.think = 1;
  wounded.hp = wounded.maxHp * 0.15; wounded.hunger = 10; wounded.energy = 90; wounded.hitT = 0; wounded.task = null; wounded.think = 1;
  for (const u of folk) u.carry = 0;
  sim.step();
  // (a starving villager standing by the stores eats at once and is left resting with a full belly)
  const ate = hungry.task?.k === 'eat' || hungry.hunger < 20;
  check('needs by score: starving eats, exhausted sleeps, badly hurt rests', ate && tired.task?.k === 'sleep' && wounded.task?.k === 'sleep', `starving -> ${hungry.task?.k} (hunger now ${Math.round(hungry.hunger)}), exhausted -> ${tired.task?.k}, badly hurt -> ${wounded.task?.k} (intent ${wounded.intent})`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
