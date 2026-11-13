/**
 * Combat & disaster checks that were only eyeballed before:
 *  A. a town's cannon shells enemy soldiers that approach
 *  B. a warship shells an enemy coastal town
 *  C. a bomber at war bombs an enemy town
 *  D. a dragon burns a town (fires, damage, casualties)
 *  E. a flood submerges low ground, damages buildings, then drains back to the original water levels
 *  F. falling ordnance: a nuke dropped from the sky lands after a delay, not instantly
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { Sp, Bk, YEAR_TICKS } from '../src/sim/defs';
import { UF, Village, Job } from '../src/sim/entities';
import { placeBuilding, findSite, declareWar, createKingdom, addResident } from '../src/sim/civ';
import { spawnVehicle, enemyOf } from '../src/sim/vehicles';
import { spawnFlood } from '../src/sim/disasters';
import { applyPower } from '../src/sim/powers';
import { fireTiles } from '../src/sim/nature';
import { clearClaims } from '../src/sim/ai';
import { clearFarmClaims } from '../src/sim/civ';

let fails = 0;
const check = (name: string, ok: boolean, info: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${info}`); if (!ok) fails++; };
function make(seed: number) {
  fireTiles.clear(); clearClaims(); clearFarmClaims();
  const w = generateWorld({ size: 192, shape: 'continents', seed });
  const sim = new Sim(w, seed);
  seedLife(sim, { tribes: 4 });
  sim.laws.disasters = false;
  for (let i = 0; i < YEAR_TICKS * 3; i++) sim.step();
  return sim;
}
const biggest = (sim: Sim) => [...sim.villages.values()].filter((v) => v.alive).sort((a, b) => b.residents.length - a.residents.length)[0];
const site = (sim: Sim, v: Village, kind: Bk) => { for (let i = 0; i < 40; i++) { const s = findSite(sim, v, kind); if (s) return s; } v.radius += 4; return findSite(sim, v, kind); };
/** An enemy kingdom with a small army standing at (x,z). */
function enemyAt(sim: Sim, x: number, z: number, n: number, foe: number) {
  const ek = createKingdom(sim, Sp.Orc);
  declareWar(sim, ek, sim.kingdoms.get(foe)!, true);
  const us = [];
  for (let i = 0; i < n; i++) { const u = sim.spawnUnit(Sp.Orc, x + sim.rng.range(-1, 1), z + sim.rng.range(-1, 1), { kingdom: ek.id }); u.job = Job.Warrior; us.push(u); }
  return { ek, us };
}
let shots = 0;
const countShots = (sim: Sim) => { const o = sim.fx.length; return () => sim.fx.slice(o).filter((e) => e.t === 'shell' || e.t === 'bombdrop').length; };

// ---------------- A. cannon
{
  const sim = make(11);
  const v = biggest(sim);
  const k = sim.kingdoms.get(v.kingdom)!; k.era = 2;
  const s = site(sim, v, Bk.Cannon)!;
  const cannon = placeBuilding(sim, v, Bk.Cannon, s[0], s[1], v.race, 1);
  const { us } = enemyAt(sim, s[0] + 6, s[1] + 2, 6, k.id);
  const hp0 = us.reduce((a, u) => a + u.hp, 0);
  shots = 0;
  // (the raiders' kingdom has no town of its own and would fall at its next council: keep the war on)
  const ek = sim.kingdoms.get(us[0].kingdom)!;
  // only the six raiders are in range (stray monsters or other foes would draw the fire)
  const others = () => { for (const o of sim.units) if (!us.includes(o) && Math.hypot(o.x - s[0], o.z - s[1]) < 12 && enemyOf(sim, k.id, o)) { o.flags |= UF.Ragdoll; sim.killUnit(o, 'god'); } };
  let dealt = 0;
  for (let i = 0; i < 200; i++) {
    others(); ek.alive = true;
    if (!k.wars.includes(ek.id)) k.wars.push(ek.id); if (!ek.wars.includes(k.id)) ek.wars.push(k.id);
    const before = us.map((u) => (u.flags & UF.Dead ? 0 : u.hp));
    sim.fx.length = 0; sim.step(); shots += sim.fx.filter((e) => e.t === 'shell').length;
    us.forEach((u, j) => { dealt += Math.max(0, before[j] - (u.flags & UF.Dead ? 0 : u.hp)); });
    for (const u of us) if (!(u.flags & UF.Dead)) { u.x = s[0] + 6; u.z = s[1] + 2; u.task = null; u.think = 50; }
  }
  const hp1 = us.reduce((a, u) => a + Math.max(0, u.flags & UF.Dead ? 0 : u.hp), 0);
  const dead = us.filter((u) => u.flags & UF.Dead).length;
  check('cannon shells enemies', shots > 1 && dealt > 0, `shots ${shots}, damage dealt ${Math.round(dealt)} (enemy hp ${Math.round(hp0)} -> ${Math.round(hp1)} after healing), killed ${dead}/6, cannon aimed ${cannon.aim !== undefined}`);
}

// ---------------- B. warship
{
  const sim = make(23);
  // a coastal enemy town: find water near any village
  let target: Village | undefined, spot: [number, number] | null = null;
  for (const v of sim.villages.values()) {
    if (!v.alive) continue;
    for (let r = 3; r < 16 && !spot; r++) for (let a = 0; a < 24 && !spot; a++) { const x = v.cx + Math.cos(a / 24 * 6.283) * r, z = v.cz + Math.sin(a / 24 * 6.283) * r; const t = sim.world.tileAt(x, z); if (t >= 0 && sim.world.waterDepth(t) > 0.8) spot = [x, z]; }
    if (spot) { target = v; break; }
  }
  if (!target || !spot) check('warship shells a coastal town', false, 'no coastal town');
  else {
    const foe = createKingdom(sim, Sp.Human); foe.era = 2;
    declareWar(sim, foe, sim.kingdoms.get(target.kingdom)!, true);
    const ship = spawnVehicle(sim, Sp.Boat, spot[0], spot[1], foe.id, -1, 1);
    foe.target = target.id;
    const hp0 = [...target.buildings].reduce((a, id) => a + (sim.buildings.get(id)?.hp ?? 0), 0);
    shots = 0;
    for (let i = 0; i < 300; i++) { sim.fx.length = 0; foe.target = target.id; sim.step(); shots += sim.fx.filter((e) => e.t === 'shell').length; }
    const hp1 = [...target.buildings].reduce((a, id) => a + (sim.buildings.get(id)?.hp ?? 0), 0);
    const civHurt = sim.units.filter((u) => u.village === target!.id && u.hp < u.maxHp).length;
    check('warship shells a coastal town', shots > 0 && (hp1 < hp0 || civHurt > 0), `shots ${shots}, town building hp ${Math.round(hp0)} -> ${Math.round(hp1)}, residents hurt ${civHurt}, ship alive ${!(ship.flags & UF.Dead)}`);
  }
}

// ---------------- C. bomber
{
  const sim = make(37);
  const v = biggest(sim);
  const foe = createKingdom(sim, Sp.Human); foe.era = 4;
  declareWar(sim, foe, sim.kingdoms.get(v.kingdom)!, true);
  foe.target = v.id;
  const home = [...sim.villages.values()].find((o) => o.alive && o !== v)!;
  const plane = spawnVehicle(sim, Sp.Plane, v.cx - 25, v.cz, foe.id, -1);
  plane.y = 5;
  const hp0 = [...v.buildings].reduce((a, id) => a + (sim.buildings.get(id)?.hp ?? 0), 0);
  // (the town repairs and builds meanwhile, so damage is counted as it is dealt)
  let bombs = 0, dealt = 0;
  const hps = new Map<number, number>();
  for (let i = 0; i < 900; i++) {
    for (const id of v.buildings) { const b = sim.buildings.get(id); if (b) hps.set(id, b.hp); }
    sim.fx.length = 0; foe.target = v.id; sim.step(); bombs += sim.fx.filter((e) => e.t === 'bombdrop').length;
    for (const [id, h] of hps) { const b = sim.buildings.get(id); const now = b && b.alive ? b.hp : 0; if (now < h) dealt += h - now; }
    hps.clear();
  }
  const hp1 = [...v.buildings].reduce((a, id) => a + (sim.buildings.get(id)?.hp ?? 0), 0);
  check('bomber bombs an enemy town', bombs >= 6 && dealt > 300, `bombs ${bombs}, damage dealt to buildings ${Math.round(dealt)} (town building hp ${Math.round(hp0)} -> ${Math.round(hp1)} with repairs and new construction)`);
  void home;
}

// ---------------- D. dragon
{
  const sim = make(41);
  const v = biggest(sim);
  const pop0 = v.residents.length;
  const hp0 = [...v.buildings].reduce((a, id) => a + (sim.buildings.get(id)?.hp ?? 0), 0);
  applyPower(sim, 'dragon', v.cx + 0.5, v.cz + 0.5, { brush: 3, dt: 0.1, first: true });
  const dragon = sim.units.find((u) => u.sp === Sp.Dragon)!;
  dragon.hunger = 90;
  let breaths = 0, burning = 0;
  for (let i = 0; i < 600; i++) { sim.fx.length = 0; sim.step(); breaths += sim.fx.filter((e) => e.t === 'breath').length; }
  for (const id of v.buildings) if ((sim.buildings.get(id)?.fire ?? 0) > 0) burning++;
  const hp1 = [...v.buildings].reduce((a, id) => a + (sim.buildings.get(id)?.hp ?? 0), 0);
  const killed = sim.deathCauses['fire'] ?? 0;
  check('dragon burns a town', breaths > 0 && (hp1 < hp0 || killed > 0), `fire breaths ${breaths}, town building hp ${Math.round(hp0)} -> ${Math.round(hp1)}, buildings burning ${burning}, deaths by fire ${killed}, residents ${pop0} -> ${v.residents.length}`);
}

// ---------------- E. flood
{
  const sim = make(53);
  const v = biggest(sim);
  const w = sim.world;
  const before = new Float32Array(w.water);
  const hp0 = [...v.buildings].reduce((a, id) => a + (sim.buildings.get(id)?.hp ?? 0), 0);
  // count the damage the water does (the town keeps building, so total hit points can still rise)
  let floodDmg = 0;
  const dmgB = sim.damageBuilding.bind(sim);
  sim.damageBuilding = (b, d, by) => { if (!by) floodDmg += d; dmgB(b, d, by); };
  spawnFlood(sim, v.cx + 0.5, v.cz + 0.5, 11);
  const f = sim.floods[0];
  const flooded = f.tiles.filter((t) => w.isWater(t)).length;
  let peakTiles = flooded;
  for (let i = 0; i < 150; i++) sim.step();
  const mid = f.tiles.filter((t) => w.isWater(t)).length;
  for (let i = 0; i < 400; i++) sim.step();
  let restored = 0, diff = 0;
  for (const t of f.tiles) { if (Math.abs(w.water[t] - before[t]) < 1e-6) restored++; else diff++; }
  const hp1 = [...v.buildings].reduce((a, id) => a + (sim.buildings.get(id)?.hp ?? 0), 0);
  check('flood rises, damages, drains', peakTiles > 20 && floodDmg > 0 && diff === 0 && sim.floods.length === 0, `tiles under water ${peakTiles} (still ${mid} after 15 s), damage to buildings ${Math.round(floodDmg)} (town hp ${Math.round(hp0)} -> ${Math.round(hp1)} incl. new construction), water restored on ${restored}/${f.tiles.length} tiles`);
}

// ---------------- F. falling nuke
{
  const sim = make(67);
  const v = biggest(sim);
  const pop0 = v.residents.length;
  applyPower(sim, 'nuke', v.cx + 0.5, v.cz + 0.5, { brush: 3, dt: 0.1, first: true });
  const hAt0 = sim.missiles[0]?.y;
  let impact = -1;
  for (let i = 0; i < 60; i++) { sim.fx.length = 0; sim.step(); if (impact < 0 && sim.fx.some((e) => e.t === 'nuke')) impact = i + 1; }
  check('nuke falls from the sky before it strikes', hAt0 > 50 && impact > 20, `appears at height ${hAt0}, impact after ${impact} ticks (${(impact / 10).toFixed(1)} s at 1x), town ${pop0} -> ${v.residents.length} people`);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
void addResident;
