/**
 * Controlled checks for the economy/order systems:
 *  A. shortage -> trade: a starving town next to a rich market town receives caravans
 *  B. shortage -> war: a starving, stronger kingdom declares a resource war on a rich neighbour
 *  C. crime -> prison: a thief is chased, arrested, escorted and jailed, then released
 *  D. development -> jobs/facilities: eras unlock buildings and professions
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { Bk, Sp, YEAR_TICKS } from '../src/sim/defs';
import { Job, UF, Village, Kingdom } from '../src/sim/entities';
import { placeBuilding, findSite, diplomacyThink, declareWar, makePeace, addResident } from '../src/sim/civ';
import { addWanted } from '../src/sim/jobs';

function world(seed: number) {
  const w = generateWorld({ size: 192, shape: 'pangaea', seed });
  const sim = new Sim(w, seed);
  seedLife(sim, { tribes: 4 });
  for (let i = 0; i < YEAR_TICKS * 6; i++) sim.step();
  return sim;
}
const alive = (sim: Sim) => [...sim.villages.values()].filter((v) => v.alive && v.residents.length > 4);
const build = (sim: Sim, v: Village, kind: Bk) => { for (let i = 0; i < 30; i++) { const s = findSite(sim, v, kind); if (s) { const b = placeBuilding(sim, v, kind, s[0], s[1], v.race, 1); b.hp = b.maxHp; return b; } } v.radius += 3; return null; };
let fails = 0;
const check = (name: string, ok: boolean, info: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${info}`); if (!ok) fails++; };

// ---------------- A. shortage -> trade
for (const seedA of [101, 102, 103, 104, 105]) {
  const sim = world(seedA);
  const vs = alive(sim);
  // two towns of different kingdoms at peace; the rich one has a market
  let rich: Village | undefined, poor: Village | undefined, best = 1e9;
  const adultsOf = (v: Village) => v.residents.filter((id) => { const u = sim.getUnit(id); return u && u.age >= 9; }).length;
  rich = vs.slice().sort((a, b) => adultsOf(b) - adultsOf(a))[0];
  for (const b of vs) {
    if (b === rich || b.kingdom === rich.kingdom) continue;
    const d = Math.hypot(rich.cx - b.cx, rich.cz - b.cz);
    if (d < best && d < 90) { best = d; poor = b; }
  }
  if (rich && poor) {
    const ka = sim.kingdoms.get(rich.kingdom)!, kb = sim.kingdoms.get(poor.kingdom)!;
    if (ka.wars.includes(kb.id)) makePeace(sim, ka, kb);
    ka.era = Math.max(ka.era, 1); ka.opinion[kb.id] = 20; kb.opinion[ka.id] = 20;
    build(sim, rich, Bk.Market);
    rich.food = 400; rich.wood = 300; poor.food = 0; poor.wood = 2;
    sim.laws.wars = false; // isolate trade from war
    const before = sim.stats.trades ?? 0;
    let poorGot = 0;
    for (let i = 0; i < YEAR_TICKS * 5; i++) {
      const f0 = poor.food;
      sim.step();
      if (ka.wars.includes(kb.id)) makePeace(sim, ka, kb);
      ka.opinion[kb.id] = Math.max(ka.opinion[kb.id] ?? 0, 10); kb.opinion[ka.id] = Math.max(kb.opinion[ka.id] ?? 0, 10); // friendly neighbours
      if (poor.food > f0 + 3) poorGot += poor.food - f0;
    }
    const traders = rich.residents.filter((id) => sim.getUnit(id)?.job === Job.Trader).length;
    console.log('   rich town', rich.name, 'pop', rich.residents.length, 'jobs', JSON.stringify(rich.residents.reduce((m: Record<number, number>, id) => { const u = sim.getUnit(id); if (u) m[u.job] = (m[u.job] ?? 0) + 1; return m; }, {})));
    check(`shortage->trade (seed ${seedA})`, (sim.stats.trades ?? 0) - before >= 2 && (ka.trade?.[kb.id] ?? 0) > 0, `caravans=${(sim.stats.trades ?? 0) - before} traders=${traders} tradeAB=${(ka.trade?.[kb.id] ?? 0).toFixed(1)} opinion ${ka.opinion[kb.id]?.toFixed(0)} poor town received ~${poorGot.toFixed(0)} goods`);
    break;
  } else console.log(`   seed ${seedA}: no foreign town within reach, next world`);
}

// ---------------- B. shortage -> war
for (const seedB of [202, 203, 204, 205, 206, 207]) {
  const sim = world(seedB);
  sim.laws.wars = true;
  const ks = [...sim.kingdoms.values()].filter((k) => k.alive);
  let wars = 0, raids = 0, trials = 0;
  sim.onHistory = (h) => { if (h.type === 'raidWar') raids++; };
  // the strongest kingdom goes hungry; its nearest neighbour is rich
  const power = (k: Kingdom) => k.villages.reduce((n, id) => n + (sim.villages.get(id)?.residents.length ?? 0), 0);
  const a = ks.slice().sort((x, y) => power(y) - power(x))[0];
  const dist = (x: Kingdom, y: Kingdom) => { let m = 1e9; for (const p of x.villages) for (const q of y.villages) { const P = sim.villages.get(p)!, Q = sim.villages.get(q)!; m = Math.min(m, Math.hypot(P.cx - Q.cx, P.cz - Q.cz) - P.radius - Q.radius); } return m; };
  const b = ks.filter((k) => k !== a).sort((x, y) => dist(a, x) - dist(a, y))[0];
  console.log(`   hungry ${a.name} power ${power(a)} vs rich ${b.name} power ${power(b)}, gap ${dist(a, b).toFixed(0)} tiles`);
  if (dist(a, b) > 36) { console.log(`   seed ${seedB}: kingdoms not neighbours, next world`); continue; }
  for (let trial = 0; trial < 40; trial++) {
    trials++;
    for (const k of ks) for (const o of ks) if (k !== o && k.wars.includes(o.id)) makePeace(sim, k, o);
    for (const k of ks) for (const o of ks) { k.peaceT[o.id] = -1e9; }
    a.allies = a.allies.filter((x) => x !== b.id); b.allies = b.allies.filter((x) => x !== a.id);
    a.opinion[b.id] = 5; b.opinion[a.id] = 5;
    for (const vid of a.villages) { const v = sim.villages.get(vid)!; v.food = 0; v.famineT = sim.tick; }
    for (const vid of b.villages) { const v = sim.villages.get(vid)!; v.food = 300; v.wood = 200; v.gold = 30; }
    diplomacyThink(sim);
    if (a.wars.includes(b.id)) wars++;
    sim.tick += 10;
  }
  check('shortage->war', raids > 0, `resource wars declared ${raids} in ${trials} diplomacy rounds (wars ${wars})`);
  // control: same kingdoms, nobody hungry -> no resource wars
  let ctrl = 0; sim.onHistory = (h) => { if (h.type === 'raidWar') ctrl++; };
  for (let trial = 0; trial < 40; trial++) {
    for (const k of ks) for (const o of ks) if (k !== o && k.wars.includes(o.id)) makePeace(sim, k, o);
    for (const k of ks) for (const vid of k.villages) { const v = sim.villages.get(vid)!; v.food = 200; v.famineT = -1e9; }
    diplomacyThink(sim);
  }
  check('no shortage -> no resource war', ctrl === 0, `resource wars in fed control: ${ctrl}`);
  break;
}

// ---------------- C. crime -> prison
{
  const sim = world(303);
  const v = alive(sim).sort((a, b) => b.residents.length - a.residents.length)[0];
  const k = sim.kingdoms.get(v.kingdom)!;
  k.era = Math.max(1, k.era);
  const prison = build(sim, v, Bk.Prison);
  // two guards
  const adults = v.residents.map((id) => sim.getUnit(id)!).filter((u) => u && u.age >= 9 && !(u.flags & UF.King));
  for (const g of adults.slice(0, 2)) { g.job = Job.Guard; g.task = null; g.think = 0; }
  const thief = adults[adults.length - 1];
  thief.crimes = 2; thief.traits = 0;
  addWanted(sim, v, thief);
  let arrestedAt = -1, jailedAt = -1, releasedAt = -1, escorted = false;
  for (let i = 0; i < YEAR_TICKS * 4 && releasedAt < 0; i++) {
    // keep the guard role assigned (village planner may reshuffle jobs)
    for (const g of adults.slice(0, 2)) if (g.job !== Job.Guard && !(g.flags & UF.Dead)) g.job = Job.Guard;
    sim.step();
    if (thief.flags & UF.Escorted) escorted = true;
    if (arrestedAt < 0 && thief.flags & UF.Escorted) arrestedAt = sim.tick;
    if (jailedAt < 0 && thief.flags & UF.Jailed) jailedAt = sim.tick;
    if (jailedAt >= 0 && releasedAt < 0 && !(thief.flags & UF.Jailed)) releasedAt = sim.tick;
    if (thief.flags & UF.Dead) break;
  }
  const inYard = prison ? Math.abs(thief.x - (prison.x + 1)) < 2 : false;
  check('crime->arrest->prison->release', !!prison && escorted && jailedAt > 0 && releasedAt > jailedAt, `prison=${!!prison} escorted=${escorted} arrested@${arrestedAt} jailed@${jailedAt} released@${releasedAt} (sentence ${((releasedAt - jailedAt) / YEAR_TICKS).toFixed(1)}y) dead=${!!(thief.flags & UF.Dead)} nearPrisonAfter=${inYard}`);
}

// ---------------- D. development
{
  const sim = world(404);
  const v = alive(sim).sort((a, b) => b.residents.length - a.residents.length)[0];
  const k = sim.kingdoms.get(v.kingdom)!;
  const snap = () => {
    const kinds = new Set<number>(); for (const id of v.buildings) { const b = sim.buildings.get(id); if (b?.alive) kinds.add(b.kind); }
    const jobs = new Set<number>(); for (const id of v.residents) { const u = sim.getUnit(id); if (u) jobs.add(u.job); }
    return { kinds: [...kinds].sort((a, b) => a - b), jobs: [...jobs].sort((a, b) => a - b) };
  };
  // a solid town to develop: top it up with settlers so it has enough adults for every trade
  for (let i = 0; i < 24; i++) { const u = sim.spawnUnit(v.race, v.cx + 0.5 + sim.rng.range(-3, 3), v.cz + 0.5 + sim.rng.range(-3, 3), { kingdom: v.kingdom }); addResident(sim, v, u); }
  const s0 = snap();
  // give the town means and raise its age step by step
  const out: string[] = [`era0 ${JSON.stringify(s0)}`];
  const seenJobs = new Set<number>();
  for (const era of [1, 2, 3, 4]) {
    k.era = era; k.tech = [0, 30, 110, 280, 600][era];
    for (let i = 0; i < YEAR_TICKS * 3; i++) { v.wood = Math.max(v.wood, 120); v.stone = Math.max(v.stone, 120); v.gold = Math.max(v.gold, 30); v.food = Math.max(v.food, 80); sim.step(); }
    const sn = snap(); sn.jobs.forEach((j) => seenJobs.add(j));
    out.push(`era${era} ${JSON.stringify(sn)}`);
  }
  const s4 = snap();
  const machines = sim.units.filter((u) => u.sp >= Sp.Boat && u.kingdom === k.id && !(u.flags & UF.Dead)).length;
  const hasNew = [Bk.Market, Bk.Library].every((b) => s4.kinds.includes(b));
  const newJobs = [Job.Guard, Job.Trader, Job.Scholar, Job.Fisher, Job.Worker].filter((j) => seenJobs.has(j)).length;
  console.log('   ' + out.join('\n   '));
  check('development->facilities/jobs', hasNew && newJobs >= 3, `market+library=${hasNew} new professions=${newJobs} machines=${machines} soldiers' weapon item=${[...new Set(v.residents.map((id) => sim.getUnit(id)).filter((u) => u?.job === Job.Warrior).map((u) => u!.item))]}`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
void declareWar; void ({} as Kingdom);
