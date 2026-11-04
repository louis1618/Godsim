import { Sim } from './sim';
import { Unit, Memory, Mem, UF, Emote, Village } from './entities';
import { SPECIES, Sp, Trait, isCiv, isTree, YEAR_TICKS } from './defs';

/**
 * Needs, mood, memories and relationships. Mood is a single 0..100 number recomputed from the
 * creature's needs, its memories (timed events), its relationships and its village; it then feeds
 * back into work speed, walking pace, births, village loyalty, crime and desertion.
 */

const MEM_LABEL: Record<number, string> = {};
void MEM_LABEL;

export function remember(sim: Sim, u: Unit, k: Mem, v: number, years: number) {
  const until = sim.tick + Math.round(years * YEAR_TICKS);
  const ex = u.mems.find((m) => m.k === k);
  if (ex) { ex.v = Math.abs(v) > Math.abs(ex.v) ? v : ex.v; ex.until = Math.max(ex.until, until); return; }
  u.mems.push({ k, v, until });
  if (u.mems.length > 8) u.mems.shift();
}

/** Racial temperament: what each people cares about beyond the basics. */
function temperament(sim: Sim, u: Unit, v: Village | undefined): number {
  if (!v) return 0;
  const k = sim.kingdoms.get(v.kingdom);
  switch (u.sp) {
    case Sp.Orc: return k && k.wars.length ? 8 : -3;                       // restless in peace
    case Sp.Elf: return v.forest > 0.25 ? 8 : v.forest < 0.08 ? -12 : 0;    // need their woods
    case Sp.Dwarf: return Math.min(8, (v.stone + v.gold * 3) / 25) - 2;     // love a full vault
    case Sp.Human: return v.food / Math.max(1, v.residents.length) > 2 ? 6 : 0;
  }
  return 0;
}

export function computeMood(sim: Sim, u: Unit): number {
  let m = 52;
  // needs
  m += u.hunger < 30 ? 8 : u.hunger < 60 ? 0 : u.hunger < 85 ? -14 : -28;
  m += u.energy > 60 ? 5 : u.energy < 10 ? -18 : u.energy < 25 ? -9 : 0;
  m += u.social > 60 ? 7 : u.social < 20 ? -10 : 0;
  if (u.flags & UF.Sick) m -= 15;
  if (u.hp < u.maxHp * 0.4) m -= 8;
  // relationships
  const p = u.partner >= 0 ? sim.getUnit(u.partner) : undefined;
  if (p) m += 6;
  if (u.friend >= 0 && sim.getUnit(u.friend)) m += 3;
  // traits
  if (u.traits & Trait.Peaceful) m += 4;
  if (u.traits & Trait.Greedy) m -= 4;
  if (u.traits & Trait.Blessed) m += 10;
  // memories
  for (const mem of u.mems) m += mem.v;
  // village life
  const v = u.village >= 0 ? sim.villages.get(u.village) : undefined;
  if (isCiv(u.sp)) {
    if (!v) m -= 10;
    else {
      const perCap = v.food / Math.max(1, v.residents.length);
      m += perCap > 1 ? 4 : perCap < 0.15 ? -8 : 0;
      m += v.level * 2;
      if (v.blessT > sim.tick) m += 12;
      if (v.homeless) m -= 8;
      const k = sim.kingdoms.get(v.kingdom);
      if (k && k.wars.length && u.sp !== Sp.Orc) m -= 6;
      if (sim.tick - v.lastAttacked < YEAR_TICKS * 0.5) m -= 8;
    }
    m += temperament(sim, u, v);
  }
  if (u.jailUntil > sim.tick) m -= 20;
  return Math.max(0, Math.min(100, m));
}

/** Called every 10 ticks per creature (alongside metabolism). */
export function mindTick(sim: Sim, u: Unit) {
  const def = SPECIES[u.sp];
  if (def.undead) { u.mood = 50; return; }
  const sleeping = u.task?.k === 'sleep';
  const working = u.anim === 2 || u.task?.k === 'build' || u.task?.k === 'gather' || u.task?.k === 'farm';
  u.energy = Math.max(0, Math.min(100, u.energy + (sleeping ? 8 : working ? -0.75 : -0.35) * (u.age < def.adultAge ? 1.2 : 1)));
  if (isCiv(u.sp)) u.social = Math.max(0, u.social - (u.task?.k === 'chat' || u.task?.k === 'love' || u.task?.k === 'dance' ? -6 : 0.5));
  // forget expired memories
  if (u.mems.length) u.mems = u.mems.filter((m) => m.until > sim.tick);
  const prev = u.mood;
  u.mood = prev + (computeMood(sim, u) - prev) * 0.35;
  // grief may harden into a thirst for revenge
  if (u.mood < 18 && u.mems.some((m) => m.k === Mem.Grief) && u.traits & Trait.Brave && sim.rng.chance(0.01)) {
    u.traits |= Trait.Bloodlust; u.traits &= ~Trait.Peaceful; sim.applyTraits(u);
    sim.emote(u, Emote.Angry, 40);
  }
}

/** A death ripples through family and friends. */
export function onDeath(sim: Sim, u: Unit, by?: Unit) {
  const mourn = (id: number, v: number, yrs: number) => {
    const o = sim.getUnit(id);
    if (!o) return;
    remember(sim, o, Mem.Grief, v, yrs);
    sim.emote(o, Emote.Sad, 40);
    if (by && by.kingdom !== o.kingdom && sim.rng.chance(0.5)) o.rival = by.id;
  };
  if (u.partner >= 0) { mourn(u.partner, -26, 1.6); const p = sim.getUnit(u.partner); if (p) p.partner = -1; }
  for (const pid of u.parents) mourn(pid, -22, 1.2);
  if (u.friend >= 0) mourn(u.friend, -10, 0.6);
  // children of the deceased (search the village)
  const v = sim.villages.get(u.village);
  if (v) for (const id of v.residents) { const c = sim.getUnit(id); if (c && c.parents.includes(u.id)) mourn(c.id, -18, 1); }
  if (by && isCiv(by.sp) && isCiv(u.sp) && by.kingdom !== u.kingdom) remember(sim, by, Mem.Victory, 6, 0.5);
}

/** Two villagers who chat may become friends, rivals, or fall in love. */
export function socialise(sim: Sim, a: Unit, b: Unit) {
  const adult = (x: Unit) => x.age >= SPECIES[x.sp].adultAge;
  if (a.sp !== b.sp) return;
  const r = sim.rng.next();
  const getsAlong = (a.mood + b.mood) / 200;
  if (adult(a) && adult(b) && a.partner < 0 && b.partner < 0 && a.female !== b.female && !a.parents.includes(b.id) && !b.parents.includes(a.id) && r < 0.3 * getsAlong + 0.08) {
    a.partner = b.id; b.partner = a.id;
    remember(sim, a, Mem.Wedding, 14, 1); remember(sim, b, Mem.Wedding, 14, 1);
    sim.emote(a, Emote.Heart, 50); sim.emote(b, Emote.Heart, 50);
    sim.fx.push({ t: 'wedding', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, u: a.id });
    return;
  }
  if (r < 0.35 * getsAlong) { if (a.friend < 0) a.friend = b.id; if (b.friend < 0) b.friend = a.id; }
  else if (r > 0.95 && (a.traits & Trait.Bloodlust || b.mood < 25)) { a.rival = b.id; b.rival = a.id; sim.emote(a, Emote.Angry, 25); sim.emote(b, Emote.Angry, 25); }
}

/** Fraction of nearby tiles that hold trees (cached per village think). */
export function forestAround(sim: Sim, cx: number, cz: number, r: number): number {
  const w = sim.world;
  let n = 0, t = 0;
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2, d = r * (0.4 + (i % 4) * 0.2);
    const tt = w.tileAt(cx + Math.cos(a) * d, cz + Math.sin(a) * d);
    if (tt < 0 || w.isWater(tt)) continue;
    n++; if (isTree(w.feat[tt])) t++;
  }
  return n ? t / n : 0;
}

export type { Memory };
