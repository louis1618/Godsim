import { Sim } from './sim';
import { Unit, Village, Building, Task, Job, Anim, Emote, UF, Res, Mem } from './entities';
import { Bk, SPECIES, Trait, YEAR_TICKS, isCiv } from './defs';
import { standAtBuilding, stepToward, resolveInside, nearestFree } from './nav';
import { remember } from './mind';

/**
 * Professions of a developing town: guards keep order and fill the prison, traders carry surplus to
 * neighbours (and back with payment), scholars research at the library, workers run the factory,
 * fishers work the dock. Each one feeds the wider simulation (tech, loyalty, food, opinion, war).
 */

// --------------------------------------------------------------------------- helpers

export function completed(sim: Sim, v: Village, kind: Bk): Building[] {
  const out: Building[] = [];
  for (const id of v.buildings) { const b = sim.buildings.get(id); if (b && b.alive && b.kind === kind && b.progress >= 1) out.push(b); }
  return out;
}

/** The prison serving a village: its own, otherwise one in a sister village close by. */
export function prisonFor(sim: Sim, v: Village): Building | undefined {
  const own = completed(sim, v, Bk.Prison)[0];
  if (own) return own;
  const k = sim.kingdoms.get(v.kingdom);
  if (!k) return undefined;
  for (const vid of k.villages) {
    const o = sim.villages.get(vid);
    if (!o || o === v || Math.hypot(o.cx - v.cx, o.cz - v.cz) > 45) continue;
    const p = completed(sim, o, Bk.Prison)[0];
    if (p) return p;
  }
  return undefined;
}

function face(u: Unit, x: number, z: number) { u.dir = Math.atan2(x - u.x, z - u.z); }

export function addWanted(sim: Sim, v: Village, u: Unit) {
  if (!v.wanted) v.wanted = [];
  if (!v.wanted.includes(u.id)) v.wanted.push(u.id);
  v.crime = (v.crime ?? 0) + 1;
}

function dropWanted(sim: Sim, id: number) {
  for (const v of sim.villages.values()) if (v.wanted?.length) { const i = v.wanted.indexOf(id); if (i >= 0) v.wanted.splice(i, 1); }
}

// --------------------------------------------------------------------------- work selection

export function guardWork(sim: Sim, u: Unit, v: Village): Task | null {
  v.wanted = (v.wanted ?? []).filter((id) => {
    const o = sim.getUnit(id);
    return !!o && !(o.flags & (UF.Jailed | UF.Escorted)) && Math.hypot(o.x - v.cx, o.z - v.cz) < v.radius + 30;
  });
  // nearest suspect nobody else is chasing (two guards may team up on a fighter)
  let best: Unit | null = null, bd = 1e9;
  for (const id of v.wanted) {
    const o = sim.getUnit(id)!;
    let chasers = 0;
    for (const gid of v.residents) { const g = sim.getUnit(gid); if (g && g !== u && g.task?.k === 'arrest' && g.task.u === id) chasers++; }
    if (chasers >= (o.traits & (Trait.Strong | Trait.Bloodlust) ? 2 : 1)) continue;
    const d = (o.x - u.x) ** 2 + (o.z - u.z) ** 2;
    if (d < bd) { bd = d; best = o; }
  }
  if (best) { sim.emote(u, Emote.Alert, 20); return { k: 'arrest', u: best.id, n: 0 }; }
  // stand watch at the prison when it holds someone, otherwise walk the streets
  const prison = completed(sim, v, Bk.Prison)[0];
  if (prison && sim.rng.chance(0.35) && sim.units.some((o) => o.task?.k === 'jailed' && o.task.b === prison.id)) return { k: 'post', b: prison.id, t: 60 };
  const bs = v.buildings;
  if (bs.length) {
    const b = sim.buildings.get(bs[sim.rng.int(0, bs.length - 1)]);
    if (b && b.alive) { const [sx, sz] = standAtBuilding(sim, b, u, 4); return { k: 'wander', tx: sx, tz: sz }; }
  }
  return null;
}

const RES_VALUE = [0, 1, 1, 1.3, 4];
const TRADER_SPEED = 1.6;
function stock(v: Village, r: Res) { return r === Res.Food ? v.food : r === Res.Wood ? v.wood : r === Res.Stone ? v.stone : r === Res.Gold ? v.gold : 0; }
function addStock(v: Village, r: Res, n: number) {
  if (r === Res.Food) v.food += n; else if (r === Res.Wood) v.wood += n; else if (r === Res.Stone) v.stone += n; else if (r === Res.Gold) v.gold += n;
}
/** How much of a resource a village can spare / how badly it lacks one. */
function surplus(v: Village, r: Res) {
  const pop = v.residents.length;
  return r === Res.Food ? v.food - 24 - pop * 0.6 : r === Res.Wood ? v.wood - 45 - v.level * 10 : r === Res.Stone ? v.stone - 30 - v.level * 8 : v.gold - 10;
}

export function tradePartnerOk(sim: Sim, a: Village, b: Village, enRoute = false) {
  if (!b.alive || b === a || !b.residents.length) return false;
  if (a.kingdom !== b.kingdom) {
    const ka = sim.kingdoms.get(a.kingdom);
    // a caravan already on the road only turns back if war breaks out
    if (!ka || ka.wars.includes(b.kingdom) || (!enRoute && (ka.opinion[b.kingdom] ?? 0) < -35)) return false;
  }
  const w = sim.world;
  return w.island[w.idx(a.cx, a.cz)] === w.island[w.idx(b.cx, b.cz)];
}

/** Pick goods and a partner: the best match between our surplus and their shortage. */
export function traderWork(sim: Sim, u: Unit, v: Village): Task | null {
  let best: { p: Village; r: Res; amt: number; score: number } | null = null;
  for (const p of sim.villages.values()) {
    const d = Math.hypot(p.cx - v.cx, p.cz - v.cz);
    if (d > 90 || !tradePartnerOk(sim, v, p)) continue;
    for (const r of [Res.Food, Res.Wood, Res.Stone, Res.Gold]) {
      const s = surplus(v, r);
      if (s < 4) continue;
      const need = Math.max(0, -surplus(p, r));
      const amt = Math.min(12, Math.floor(s), Math.max(4, Math.ceil(need)));
      const score = need * 1.5 + amt * 0.2 - d * 0.14 + (p.kingdom !== v.kingdom ? 1.5 : 0) + sim.rng.next();
      if (!best || score > best.score) best = { p, r, amt, score };
    }
  }
  if (!best || best.score < 0.5) {
    const m = completed(sim, v, Bk.Market)[0];
    return m ? { k: 'post', b: m.id, t: 50 } : null;
  }
  addStock(v, best.r, -best.amt);
  u.carry = best.r; u.carryAmt = best.amt;
  return { k: 'trade', v: best.p.id, res: best.r, amt: best.amt, back: false, n: 0 };
}

/** Workplaces: a library desk, a factory floor, a dock. */
export function postWork(sim: Sim, u: Unit, v: Village, kind: Bk, t: number): Task | null {
  const bs = completed(sim, v, kind);
  if (!bs.length) return null;
  return { k: 'post', b: bs[u.id % bs.length].id, t };
}

// --------------------------------------------------------------------------- task runners

type MoveFn = (sim: Sim, u: Unit, tx: number, tz: number, arrive?: number, speed?: number) => boolean;

export function runPost(sim: Sim, u: Unit, t: Extract<Task, { k: 'post' }>, moveTo: MoveFn, workRate: (u: Unit) => number) {
  const b = sim.buildings.get(t.b);
  if (!b || !b.alive || b.progress < 1) { u.task = null; u.think = 0; return; }
  if (t.sx === undefined || t.sz === undefined) [t.sx, t.sz] = standAtBuilding(sim, b, u, 3);
  if (!moveTo(sim, u, t.sx, t.sz!, 0.15)) return;
  const cx = b.x + b.size / 2, cz = b.z + b.size / 2;
  face(u, cx, cz);
  const v = sim.villages.get(u.village);
  const k = v && sim.kingdoms.get(v.kingdom);
  switch (b.kind) {
    case Bk.Library: u.anim = Anim.Work; if (sim.tick % 25 === u.id % 25) sim.fx.push({ t: 'study', x: u.x, z: u.z, u: u.id }); break;
    case Bk.Factory: u.anim = Anim.Work; if (sim.tick % 9 === u.id % 9) sim.fx.push({ t: 'hammer', x: u.x, z: u.z, u: u.id, tx: cx, tz: cz }); break;
    case Bk.Dock: u.anim = sim.tick % 60 < 40 ? Anim.Idle : Anim.Work; break;
    case Bk.Prison: u.anim = Anim.Idle; if (sim.tick % 40 === 0) u.dir += sim.rng.range(-1.2, 1.2); break;
    default: u.anim = Anim.Idle;
  }
  if (--t.t > 0) return;
  const rate = workRate(u);
  if (b.kind === Bk.Library && k) { k.tech += 0.7 * rate * (u.traits & Trait.Wise ? 1.5 : 1); sim.emote(u, Emote.Star, 15); }
  else if (b.kind === Bk.Factory && v) v.industry = (v.industry ?? 0) + 2 * rate;
  else if (b.kind === Bk.Dock && u.job === Job.Fisher) {
    u.carry = Res.Food; u.carryAmt = Math.round(4 * rate);
    sim.fx.push({ t: 'fish', x: cx, z: cz, u: u.id });
    u.task = { k: 'deliver' };
    return;
  }
  u.task = null; u.think = 0;
}

export function runArrest(sim: Sim, u: Unit, t: Extract<Task, { k: 'arrest' }>, moveTo: MoveFn) {
  const o = sim.getUnit(t.u);
  const v = sim.villages.get(u.village);
  if (!o || !v || o.flags & (UF.Jailed | UF.Escorted) || ++t.n > 500) { u.task = null; u.think = 0; return; }
  const d = Math.hypot(o.x - u.x, o.z - u.z);
  if (d > 40) { u.task = null; u.think = 0; return; }
  if (d > 0.85) {
    if (u.path && sim.tick % 12 === u.id % 12) u.path = null;
    if (d < 2.5 && !u.path) { if (stepToward(sim.world, u, o.x, o.z, SPECIES[u.sp].speed * u.speedMul * 0.12, false) > 0) { face(u, o.x, o.z); u.anim = Anim.Walk; } }
    else moveTo(sim, u, o.x, o.z, 0.8, 1.15);
    if (sim.tick % 30 === u.id % 30) sim.emote(u, Emote.Alert, 18);
    return;
  }
  face(u, o.x, o.z);
  // hard cases resist arrest once
  if (!t.fought && (o.traits & (Trait.Bloodlust | Trait.Strong) || o.flags & UF.Mad) && sim.rng.chance(0.5)) {
    t.fought = true;
    o.task = { k: 'attack', u: u.id }; o.think = 30;
    sim.emote(o, Emote.Angry, 30);
    u.task = { k: 'attack', u: o.id }; u.think = 30;
    return;
  }
  const prison = prisonFor(sim, v);
  if (!prison) {
    // no cells: a fine and a beating
    const fine = Math.min(o.carryAmt, 3);
    o.carryAmt -= fine; v.gold += 1;
    sim.fx.push({ t: 'hit', x: o.x, z: o.z, u: o.id, a: u.sp, tx: u.x, tz: u.z });
    o.hp = Math.max(1, o.hp - o.maxHp * 0.12);
    remember(sim, o, Mem.Jailed, -6, 0.4);
    sim.emote(o, Emote.Sad, 30);
    o.crimes = Math.max(0, o.crimes - 1);
    dropWanted(sim, o.id);
    u.task = null; u.think = 0;
    return;
  }
  o.flags |= UF.Escorted;
  o.task = { k: 'escorted', g: u.id }; o.path = null; o.carry = Res.None; o.carryAmt = 0;
  sim.emote(o, Emote.Sad, 40); sim.emote(u, Emote.Alert, 20);
  sim.fx.push({ t: 'arrest', x: o.x, z: o.z, u: o.id });
  u.task = { k: 'escort', u: o.id, b: prison.id };
}

export function runEscort(sim: Sim, u: Unit, t: Extract<Task, { k: 'escort' }>, moveTo: MoveFn) {
  const o = sim.getUnit(t.u);
  if (!o || !(o.flags & UF.Escorted)) { u.task = null; u.think = 0; return; }
  const b = sim.buildings.get(t.b);
  if (!b || !b.alive) { o.flags &= ~UF.Escorted; o.task = null; u.task = null; u.think = 0; return; }
  if (t.sx === undefined || t.sz === undefined) [t.sx, t.sz] = standAtBuilding(sim, b, u, 2);
  if (moveTo(sim, u, t.sx, t.sz!, 0.35, 0.8)) { imprison(sim, o, b); u.task = null; u.think = 0; sim.emote(u, Emote.Star, 15); }
}

/** The arrested follow one step behind their guard. */
export function escortedTick(sim: Sim, u: Unit) {
  const t = u.task;
  const g = t && t.k === 'escorted' ? sim.getUnit(t.g) : undefined;
  if (!g || g.task?.k !== 'escort' || g.task.u !== u.id) { u.flags &= ~UF.Escorted; u.task = null; u.think = 0; return; }
  const bx = g.x - Math.sin(g.dir) * 0.55, bz = g.z - Math.cos(g.dir) * 0.55;
  const d = Math.hypot(bx - u.x, bz - u.z);
  if (d > 3) { u.x = bx; u.z = bz; resolveInside(sim, u); }
  else if (d > 0.08) stepToward(sim.world, u, bx, bz, Math.min(d, SPECIES[u.sp].speed * 0.13), false);
  face(u, g.x, g.z);
  u.anim = Math.abs(u.x - u.px) + Math.abs(u.z - u.pz) > 1e-4 ? Anim.Walk : Anim.Idle;
  if (sim.tick % 50 === u.id % 50) sim.emote(u, Emote.Sad, 25);
}

export function imprison(sim: Sim, o: Unit, b: Building) {
  o.flags = (o.flags & ~UF.Escorted) | UF.Jailed;
  o.task = { k: 'jailed', b: b.id };
  o.jailUntil = sim.tick + Math.min(YEAR_TICKS * 3, 240 + o.crimes * 140);
  o.path = null;
  const [yx, yz] = yardSpot(b, o.look);
  o.x = o.px = yx; o.z = o.pz = yz;
  dropWanted(sim, o.id);
  const v = sim.villages.get(b.village);
  if (v) v.crime = Math.max(0, (v.crime ?? 0) - 2);
  remember(sim, o, Mem.Jailed, -16, 1.5);
  sim.fx.push({ t: 'jail', x: b.x + b.size / 2, z: b.z + b.size / 2, u: o.id });
  sim.stats.jailed = (sim.stats.jailed ?? 0) + 1;
}

function yardSpot(b: Building, seed: number): [number, number] {
  const r = ((seed * 9301 + 49297) % 233280) / 233280, r2 = ((seed * 4561 + 1231) % 7919) / 7919;
  return [b.x + b.size / 2 + (r - 0.5) * 0.9, b.z + b.size / 2 + (r2 - 0.5) * 0.9];
}

/** Behind bars: fed, pacing the yard, released when the sentence is served (or the walls fall). */
export function jailTick(sim: Sim, u: Unit) {
  const t = u.task;
  const b = t && t.k === 'jailed' ? sim.buildings.get(t.b) : undefined;
  if (!b || !b.alive || sim.tick >= u.jailUntil) { release(sim, u, b); return; }
  u.hunger = Math.min(u.hunger, 45);
  u.energy = Math.max(u.energy, 50);
  if (sim.tick % 40 === u.id % 40) {
    const [x, z] = yardSpot(b, u.look + Math.floor(sim.tick / 40));
    u.dir = Math.atan2(x - u.x, z - u.z);
    (u as Unit & { gx?: number; gz?: number }).gx = x; (u as Unit & { gz?: number }).gz = z;
  }
  const g = u as Unit & { gx?: number; gz?: number };
  if (g.gx !== undefined && g.gz !== undefined) {
    const dx = g.gx - u.x, dz = g.gz - u.z, d = Math.hypot(dx, dz);
    if (d > 0.02) { const s = Math.min(d, 0.04); u.x += (dx / d) * s; u.z += (dz / d) * s; u.anim = Anim.Walk; }
    else u.anim = Anim.Idle;
  }
  if (sim.tick % 90 === u.id % 90) sim.emote(u, sim.rng.chance(0.5) ? Emote.Sad : Emote.Angry, 25);
}

export function release(sim: Sim, u: Unit, b?: Building) {
  u.flags &= ~UF.Jailed;
  u.jailUntil = -1;
  u.task = null; u.think = 0;
  if (b) { const [sx, sz] = standAtBuilding(sim, b, u, 2); u.x = u.px = sx; u.z = u.pz = sz; }
  resolveInside(sim, u);
  const p = nearestFree(sim.world, u.x, u.z, 6);
  if (p) { u.x = u.px = p[0]; u.z = u.pz = p[1]; }
  u.crimes = 0;
  sim.emote(u, Emote.Music, 30);
  sim.fx.push({ t: 'freed', x: u.x, z: u.z, u: u.id });
}

export function runTrade(sim: Sim, u: Unit, t: Extract<Task, { k: 'trade' }>, moveTo: MoveFn) {
  const home = sim.villages.get(u.village);
  const p = sim.villages.get(t.v);
  if (!home || !home.alive) { u.task = null; return; }
  if (++t.n > 2400) { u.task = { k: 'deliver' }; u.path = null; return; }
  if (!t.back) {
    if (!p || !tradePartnerOk(sim, home, p, true)) { t.back = true; t.sx = undefined; u.path = null; return; }
    if (t.sx === undefined || t.sz === undefined) {
      const b = completed(sim, p, Bk.Market)[0] ?? sim.buildings.get(p.hall);
      [t.sx, t.sz] = b && b.alive ? standAtBuilding(sim, b, u, 3) : [p.cx + 0.5, p.cz + 1.5];
    }
    if (!moveTo(sim, u, t.sx, t.sz!, 0.6, TRADER_SPEED)) return;
    // goods change hands; the buyer pays in what it can spare
    addStock(p, t.res, t.amt);
    home.gold += 1; // market levy
    const value = t.amt * RES_VALUE[t.res];
    let pay = Res.None, best = 0;
    for (const r of [Res.Gold, Res.Stone, Res.Wood, Res.Food]) { if (r === t.res) continue; const s = surplus(p, r) * RES_VALUE[r]; if (s > best) { best = s; pay = r; } }
    let payAmt = 0;
    if (pay !== Res.None) { payAmt = Math.max(1, Math.min(Math.floor(stock(p, pay)), Math.round(value / RES_VALUE[pay]))); addStock(p, pay, -payAmt); }
    u.carry = pay; u.carryAmt = payAmt;
    sim.fx.push({ t: 'trade', x: u.x, z: u.z, u: u.id, a: t.res, b: pay });
    sim.emote(u, Emote.Star, 25);
    remember(sim, u, Mem.Trade, 6, 0.5);
    const ka = sim.kingdoms.get(home.kingdom), kb = sim.kingdoms.get(p.kingdom);
    if (ka) ka.tradeBoost = Math.max(ka.tradeBoost ?? 1, 1.25);
    if (kb) kb.tradeBoost = Math.max(kb.tradeBoost ?? 1, 1.25);
    if (ka && kb && ka !== kb) {
      ka.trade ??= {}; kb.trade ??= {};
      const first = !(ka.trade[kb.id] > 0);
      ka.trade[kb.id] = (ka.trade[kb.id] ?? 0) + 1; kb.trade[ka.id] = (kb.trade[ka.id] ?? 0) + 1;
      ka.opinion[kb.id] = (ka.opinion[kb.id] ?? 0) + (pay === Res.None ? 6 : 3);
      kb.opinion[ka.id] = (kb.opinion[ka.id] ?? 0) + (pay === Res.None ? 8 : 3);
      if (first) sim.log('tradeRoute', { a: ka.id, b: kb.id, v: p.id, x: p.cx, z: p.cz, text: `${home.name}|${p.name}` });
    }
    sim.stats.trades = (sim.stats.trades ?? 0) + 1;
    t.back = true; t.sx = undefined; t.sz = undefined; u.path = null;
    if (payAmt <= 0) { u.task = null; u.think = 0; }
    return;
  }
  // heading home with the payment (traders travel with a pack animal: quicker than walkers)
  if (t.sx === undefined || t.sz === undefined) {
    const b = completed(sim, home, Bk.Market)[0] ?? sim.buildings.get(home.hall);
    [t.sx, t.sz] = b && b.alive ? standAtBuilding(sim, b, u, 3) : [home.cx + 0.5, home.cz + 1.5];
  }
  if (!moveTo(sim, u, t.sx, t.sz!, 0.8, TRADER_SPEED)) return;
  if (u.carry !== Res.None && u.carryAmt > 0) { addStock(home, u.carry, u.carryAmt); sim.fx.push({ t: 'deliver', x: u.x, z: u.z, a: u.carry, u: u.id }); }
  u.carry = Res.None; u.carryAmt = 0;
  u.task = null; u.think = 0;
}

// --------------------------------------------------------------------------- crime & order

/** Discontent in a poorly-loyal town turns into agitation; guards arrest the ringleaders. */
export function unrestTick(sim: Sim, v: Village, adults: Unit[]) {
  const k = sim.kingdoms.get(v.kingdom);
  if (!k || k.capital === v.id || v.loyalty > 22 || !prisonFor(sim, v)) return;
  if (!sim.rng.chance(0.12)) return;
  const agitator = adults.find((a) => a.mood < 35 && !(a.flags & (UF.Jailed | UF.Escorted | UF.King)) && a.job !== Job.Guard && !(v.wanted ?? []).includes(a.id));
  if (!agitator) return;
  agitator.crimes++;
  addWanted(sim, v, agitator);
  sim.emote(agitator, Emote.Angry, 40);
  sim.fx.push({ t: 'riot', x: agitator.x, z: agitator.z, u: agitator.id });
}

/** With a prison and enough guards a brewing rebellion can be crushed by arresting its leaders. */
export function tryCrushRebellion(sim: Sim, v: Village): boolean {
  const prison = prisonFor(sim, v);
  if (!prison) return false;
  const res = v.residents.map((id) => sim.getUnit(id)).filter((u): u is Unit => !!u);
  const guards = res.filter((u) => u.job === Job.Guard || u.job === Job.Warrior).length;
  if (guards < 2 || !sim.rng.chance(Math.min(0.75, 0.25 + guards * 0.08))) return false;
  const leaders = res.filter((u) => u.age >= SPECIES[u.sp].adultAge && !(u.flags & (UF.Jailed | UF.Escorted | UF.King))).sort((a, b) => a.mood - b.mood).slice(0, 3);
  for (const l of leaders) { l.crimes += 2; addWanted(sim, v, l); sim.emote(l, Emote.Angry, 40); }
  v.loyalty += 15;
  sim.log('rebellionCrushed', { a: v.kingdom, v: v.id, x: v.cx, z: v.cz, text: v.name });
  return true;
}

/** Fleeing suspects run from guards they can see. */
export function suspectFlee(sim: Sim, u: Unit, v: Village): [number, number] | null {
  if (!u.crimes || !(v.wanted ?? []).includes(u.id)) return null;
  let g: Unit | null = null;
  sim.near(u.x, u.z, 6, (o) => { if (o.job === Job.Guard && o.village === v.id && o.task?.k === 'arrest' && o.task.u === u.id) { g = o; return true; } });
  return g ? [(g as Unit).x, (g as Unit).z] : null;
}

void isCiv;
