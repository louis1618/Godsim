import { Sim } from './sim';
import { Unit, UF, Job, Emote, Anim } from './entities';
import { SPECIES, Sp, Trait, isCiv, isVehicle, isMonster } from './defs';

/**
 * Utility AI: every decision weighs a handful of options with scores built from what the creature
 * perceives and who it is, and takes the best one (ties broken by a little noise so a crowd does not
 * act in lockstep).
 *
 *   danger   = how threatening the nearest foes are (their strength vs mine, how close, how many)
 *   hazards  = fire, lava, acid rain, a tornado's path, an incoming meteor or bomb, a volcano
 *   courage  = species temperament + personality traits + health + friends close by + duty
 *   options  = fight · flee · call for help · avoid hazard · (needs) eat · sleep · rest · socialise · work
 *
 * Group behaviour comes out of the same scores: an alarmed herd animal spreads its alarm to kin
 * close by; a wolf that starts a hunt calls its pack onto the same prey; a villager under attack
 * calls the guards and soldiers of its town, who come running.
 */

/** Temperament: how readily a species stands its ground (0 = always runs, 1 = never backs down). */
const TEMPER: Partial<Record<number, number>> = {
  [Sp.Human]: 0.45, [Sp.Elf]: 0.4, [Sp.Dwarf]: 0.58, [Sp.Orc]: 0.68,
  [Sp.Sheep]: 0.08, [Sp.Chicken]: 0.06, [Sp.Rabbit]: 0.04, [Sp.Deer]: 0.12, [Sp.Fox]: 0.35,
  [Sp.Boar]: 0.72, [Sp.Wolf]: 0.75, [Sp.Bear]: 0.92, [Sp.Crocodile]: 0.9,
};

/** Fighting strength: hit points times damage, scaled by level and condition. */
export function strength(u: Unit): number {
  const d = SPECIES[u.sp];
  const gun = u.item === 12 || u.item === 13 ? 1.8 : u.item === 18 || u.item === 19 ? 1.6 : 1;
  return Math.max(1, u.hp) * d.dmg * u.dmgMul * gun * (u.age < d.adultAge ? 0.3 : 1);
}

export function courage(sim: Sim, u: Unit, allies: number): number {
  let c = TEMPER[u.sp] ?? (SPECIES[u.sp].aggressive ? 0.85 : 0.3);
  if (isMonster(u.sp) || SPECIES[u.sp].undead) return 1;
  const t = u.traits;
  if (t & Trait.Brave) c += 0.3;
  if (t & Trait.Bloodlust) c += 0.22;
  if (t & Trait.Strong) c += 0.12;
  if (t & Trait.Weak) c -= 0.15;
  if (t & Trait.Peaceful) c -= 0.25;
  if (u.flags & (UF.Hero | UF.Mad)) c += 0.4;
  // duty: soldiers, guards and mages are trained to hold the line
  if (u.job === Job.Warrior || u.job === Job.Guard) c += 0.35;
  else if (u.job === Job.Mage) c += 0.2;
  // a parent defends its young; the wounded lose heart; friends nearby give it back
  c *= 0.45 + 0.55 * (u.hp / u.maxHp);
  c += Math.min(0.3, allies * 0.06);
  if (u.age < SPECIES[u.sp].adultAge) c *= 0.3;
  if (u.mood < 25) c -= 0.1;
  return c;
}

export interface Perception {
  enemy: Unit | null; dist: number;
  danger: number;      // summed foe strength vs mine, weighted by proximity (1 = an even fight next to me)
  allies: number;      // able-bodied friends within reach
  hazard: { x: number; z: number; level: number; what: string } | null;
}

/** What is going on around a creature (threat list comes from the caller's scan). */
export function perceive(sim: Sim, u: Unit, enemy: Unit | null, dist: number): Perception {
  const mine = strength(u);
  let danger = 0, allies = 0;
  sim.near(u.x, u.z, 7, (o, d2) => {
    if (o === u || o.flags & (UF.Dead | UF.Ragdoll | UF.Held | UF.Beamed)) return;
    if (sim.hostile(u, o) || (enemy && o === enemy)) {
      const prox = 1 - Math.sqrt(d2) / 8;
      danger += (strength(o) / mine) * Math.max(0.1, prox);
    } else if (friendOf(u, o) && o.age >= SPECIES[o.sp].adultAge) allies++;
  });
  if (enemy && danger === 0) danger = (strength(enemy) / mine) * Math.max(0.1, 1 - dist / 8);
  return { enemy, dist, danger, allies, hazard: hazardNear(sim, u.x, u.z) };
}

function friendOf(u: Unit, o: Unit) {
  if (isCiv(u.sp)) return isCiv(o.sp) && o.kingdom === u.kingdom && u.kingdom >= 0;
  return o.sp === u.sp;
}

export type Response = 'fight' | 'flee' | 'none';

/**
 * Fight or flight, by score. Fighting is worth more the stronger and braver I am relative to the
 * danger; fleeing is worth more the greater the danger and the nearer it is. Peaceful folk never
 * strike first at other people; herbivores never fight predators unless they are big, cornered boars.
 */
export function fightOrFlight(sim: Sim, u: Unit, p: Perception): { choice: Response; fight: number; flee: number } {
  if (!p.enemy) return { choice: 'none', fight: 0, flee: 0 };
  const c = courage(sim, u, p.allies);
  const odds = 1 / Math.max(0.05, p.danger);                 // >1: I am the stronger party
  let fight = c * Math.min(2, odds) * 0.8;
  let flee = (1 - Math.min(1, c)) * Math.min(2, p.danger) * (p.dist < 7 ? 1 : 0.3);
  // an attacker right on top of me: cornered creatures lash out
  if (p.dist < 1.3) fight += 0.25;
  // prey animals and children do not pick fights with their hunters
  const prey = !isCiv(u.sp) && !SPECIES[u.sp].aggressive && u.sp !== Sp.Boar;
  if (prey) fight = 0;
  if (u.traits & Trait.Peaceful && !(u.flags & UF.Mad) && isCiv(p.enemy.sp)) fight *= 0.1;
  // a king keeps out of brawls unless cornered or brave
  if (u.flags & UF.King && !(u.traits & (Trait.Brave | Trait.Bloodlust)) && p.dist > 1.2) fight *= 0.3;
  // aggressive beasts and monsters attack whatever they consider a threat
  if (SPECIES[u.sp].aggressive && !isCiv(u.sp)) fight = Math.max(fight, 0.9);
  // soldiers on duty: retreat only when badly hurt and badly outnumbered
  if ((u.job === Job.Warrior || u.job === Job.Guard) && !(u.hp < u.maxHp * 0.3 && p.danger > 1.5)) fight = Math.max(fight, flee + 0.05);
  const choice: Response = fight >= flee && fight > 0.12 ? 'fight' : flee > 0.12 ? 'flee' : 'none';
  return { choice, fight, flee };
}

/** Hazards that are worth walking away from, nearest first. */
export function hazardNear(sim: Sim, x: number, z: number, wild = false): { x: number; z: number; level: number; what: string } | null {
  const w = sim.world;
  let best: { x: number; z: number; level: number; what: string } | null = null;
  const consider = (hx: number, hz: number, r: number, level: number, what: string) => {
    const d = Math.hypot(hx - x, hz - z);
    if (d > r) return;
    const l = level * (1 - d / (r + 0.01));
    if (!best || l > best.level) best = { x: hx, z: hz, level: l, what };
  };
  // fire and lava within two tiles
  const x0 = Math.floor(x), z0 = Math.floor(z);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const t = w.tileAt(x0 + dx + 0.5, z0 + dz + 0.5);
    if (t < 0) continue;
    if (w.fire[t] > 30) consider(x0 + dx + 0.5, z0 + dz + 0.5, 2.6, 0.9, 'fire');
    else if (w.mat[t] === 10) consider(x0 + dx + 0.5, z0 + dz + 0.5, 1.8, 0.8, 'lava');
  }
  for (const a of sim.acidRains) consider(a.x, a.z, a.r + 1, 0.6, 'acid');
  for (const t of sim.tornadoes) consider(t.x, t.z, 6, 1, 'tornado');
  for (const m of sim.meteors) consider(m.x, m.z, 4 + m.size * 2, 1, 'meteor');
  for (const m of sim.missiles) consider(m.x, m.z, m.kind === 'nuke' ? 14 : 4, 1, 'bomb');
  for (const v of sim.volcanoes) consider(v.x, v.z, 6, 0.9, 'volcano');
  // wild animals leave a parched land for greener pastures (townsfolk stay with their homes)
  if (wild) for (const d of sim.droughts) {
    // anywhere inside it is equally bad: head out, away from its heart
    if ((x - d.x) ** 2 + (z - d.z) ** 2 < d.r * d.r && (!best || (best as { level: number }).level < 0.35)) best = { x: d.x, z: d.z, level: 0.35, what: 'drought' };
  }
  return best;
}

/**
 * A creature in trouble calls for help:
 *  - townsfolk shout for the guards, soldiers and mages of their town (and any brave neighbour)
 *  - herd animals spread their alarm: kin close by bolt too
 *  - a hunting wolf brings its pack onto the same prey
 * Returns how many answered.
 */
export function callForHelp(sim: Sim, u: Unit, enemy: Unit, kind: 'defend' | 'alarm' | 'pack', setTask: (sim: Sim, u: Unit, t: any) => void, flee: (sim: Sim, u: Unit, x: number, z: number) => void): number {
  let n = 0;
  const r = kind === 'defend' ? 12 : kind === 'pack' ? 10 : 6;
  sim.near(u.x, u.z, r, (o) => {
    if (o === u || o.flags & (UF.Dead | UF.Ragdoll | UF.Held | UF.Jailed | UF.Aboard | UF.Escorted | UF.Beamed) || n >= 6) return;
    if (kind === 'defend') {
      if (!isCiv(o.sp) || o.kingdom !== u.kingdom || o.age < SPECIES[o.sp].adultAge) return;
      const duty = o.job === Job.Warrior || o.job === Job.Guard || o.job === Job.Mage || o.traits & Trait.Brave || o.flags & UF.Hero;
      if (!duty) return;
      const busy = o.task?.k === 'attack' || o.task?.k === 'escort' || o.task?.k === 'arrest' || o.task?.k === 'flee';
      if (busy) return;
      setTask(sim, o, { k: 'attack', u: enemy.id });
      sim.emote(o, Emote.Swords, 20);
      o.intent = Intent.Rescue;
      n++;
    } else if (kind === 'alarm') {
      if (o.sp !== u.sp || o.task?.k === 'flee') return;
      flee(sim, o, enemy.x, enemy.z);
      o.intent = Intent.Flee;
      n++;
    } else {
      if (o.sp !== u.sp || o.task?.k === 'hunt' || o.task?.k === 'attack' || o.hunger < 30 || o.lastHit === enemy.id) return;
      if (o.skipPrey === enemy.id && sim.tick < o.skipT) return; // it already found no way to that one
      setTask(sim, o, { k: 'hunt', u: enemy.id });
      o.intent = Intent.Hunt;
      n++;
    }
  });
  if (n) sim.fx.push({ t: 'callhelp', x: u.x, z: u.z, u: u.id, a: n });
  return n;
}

/** Why a creature is doing what it does (shown in the inspector as an icon with an explanation). */
export const enum Intent {
  None = 0, Fight = 1, Flee = 2, CallHelp = 3, Rescue = 4, AvoidHazard = 5, Eat = 6, Sleep = 7, Rest = 8,
  Social = 9, Work = 10, Wander = 11, Hunt = 12, Graze = 13, Swim = 14, Breed = 15,
}

/**
 * Needs, scored (civilians). Returns the winning need, or 'work' when nothing presses.
 *  eat:    rises steeply past half-hungry
 *  sleep:  rises as energy runs out (children tire sooner)
 *  rest:   badly hurt folk stop working and recover (near a mage or at home)
 *  social: lonely folk (and singles looking for a partner) seek company
 *  work:   the baseline, lifted by good mood
 */
export function pickNeed(sim: Sim, u: Unit, adult: boolean): { need: 'eat' | 'sleep' | 'rest' | 'social' | 'work'; scores: Record<string, number> } {
  const curve = (v: number, lo: number, hi: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const eat = curve(u.hunger, 50, 92) * 1.2;
  const sleep = curve(100 - u.energy, adult ? 70 : 55, 95) * 1.1;
  const rest = u.hitT === 0 ? curve(1 - u.hp / u.maxHp, 0.45, 0.85) * 0.9 : 0;
  const single = adult && u.partner < 0;
  const social = curve(100 - u.social, single ? 40 : 65, 100) * 0.55;
  const work = 0.32 + (u.mood - 50) / 400;
  const scores = { eat, sleep, rest, social, work };
  let need: 'eat' | 'sleep' | 'rest' | 'social' | 'work' = 'work', best = work;
  for (const k of ['eat', 'sleep', 'rest', 'social'] as const) if (scores[k] > best) { best = scores[k]; need = k; }
  void sim; void isVehicle;
  return { need, scores };
}
