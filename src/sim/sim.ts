import { Rng } from '../core/rng';
import { World } from './world';
import { PathFinder } from './path';
import { SPECIES, Sp, YEAR_TICKS, SEASON_TICKS, Trait, BUILDINGS, Bk, isCiv, isVehicle, Mat } from './defs';
import { enemyOf, cannonTick } from './vehicles';
import { addWanted } from './jobs';
import { Unit, Building, Village, Kingdom, HistoryEntry, Job, Anim, Emote, UF, Res } from './entities';
import { unitName } from './names';
import { unitTick } from './ai';
import { villageThink, kingdomThink, diplomacyThink, onBuildingDestroyed } from './civ';
import { natureTick } from './nature';
import { disasterTick } from './disasters';
import { resolveInside } from './nav';
import { onDeath } from './mind';

export interface FxEvent {
  t: string;
  x: number; z: number; y?: number;
  a?: number; b?: number; c?: number;
  u?: number;
  tx?: number; tz?: number;
}

export interface Laws {
  wars: boolean; rebellions: boolean; disasters: boolean; plague: boolean;
  seasons: boolean; growth: boolean; births: boolean; animals: boolean; fire: boolean;
}

export const CELL = 4;

/** Engine-agnostic physics hook: the sim asks it to launch bodies and advances it once per tick. */
export interface PhysicsPort {
  fling(sim: Sim, u: Unit, vx: number, vy: number, vz: number, spin: number): void;
  tick(sim: Sim): void;
}

/** The whole simulation state + fixed-step update. No rendering code here. */
export class Sim {
  world: World;
  rng: Rng;
  tick = 0;
  units: Unit[] = [];
  unitMap = new Map<number, Unit>();
  buildings = new Map<number, Building>();
  villages = new Map<number, Village>();
  kingdoms = new Map<number, Kingdom>();
  history: HistoryEntry[] = [];
  fx: FxEvent[] = [];
  nextId = 1;
  pf: PathFinder;
  pathCalls = 0;
  laws: Laws = { wars: true, rebellions: true, disasters: true, plague: true, seasons: true, growth: true, births: true, animals: true, fire: true };
  weather = { rain: 0, rainT: 0, cloudX: 0, cloudZ: 0, storm: 0 };
  tornadoes: { id: number; x: number; z: number; vx: number; vz: number; life: number; power: number }[] = [];
  meteors: { id: number; x: number; z: number; y: number; vy: number; size: number }[] = [];
  rainClouds: { id: number; x: number; z: number; vx: number; vz: number; life: number; r: number; storm: boolean }[] = [];
  volcanoes: { id: number; x: number; z: number; life: number }[] = [];
  droughts: { id: number; x: number; z: number; r: number; life: number }[] = [];
  floods: { id: number; x: number; z: number; r: number; life: number; tiles: number[]; base: number[]; level: number }[] = [];
  // spatial hash
  cw: number; ch: number;
  cellHead: Int32Array;
  cellNext: Int32Array = new Int32Array(0);
  stats = { births: 0, deaths: 0, wars: 0, kills: 0, jailed: 0, trades: 0, machines: 0 };
  deathCauses: Record<string, number> = {};
  onHistory: ((h: HistoryEntry) => void) | null = null;
  physics: PhysicsPort | null = null;

  /** Throw a creature (explosions, tornadoes, quakes). Without a physics engine it just staggers. */
  fling(u: Unit, vx: number, vy: number, vz: number, spin = 8) {
    if (isVehicle(u.sp)) return;
    this.fx.push({ t: 'fling', x: u.x, z: u.z, u: u.id, a: vy });
    if (this.physics) { this.physics.fling(this, u, vx, vy, vz, spin); return; }
    const nx = u.x + vx * 0.15, nz = u.z + vz * 0.15;
    const t = this.world.tileAt(nx, nz);
    if (t >= 0 && this.world.walkable(t)) { u.x = nx; u.z = nz; }
  }
  usedColors = new Set<number>();

  constructor(world: World, seed: number) {
    this.world = world;
    this.rng = new Rng(seed ^ 0x5eed);
    this.pf = new PathFinder(world);
    this.cw = 0; this.ch = 0; this.cellHead = new Int32Array(0);
    this.bindWorld(world);
  }

  /** (Re)attach a world: used at creation and when the world grows. */
  bindWorld(world: World) {
    this.world = world;
    this.pf = new PathFinder(world);
    world.bldPassable = (t) => {
      const b = this.buildings.get(world.bld[t]);
      return !b || b.kind === Bk.Farm || b.kind === Bk.Ruin || b.progress < 0.15;
    };
    this.cw = Math.ceil(world.W / CELL); this.ch = Math.ceil(world.H / CELL);
    this.cellHead = new Int32Array(this.cw * this.ch).fill(-1);
  }

  get navVersion() { return this.world.navVersion; }
  get year() { return Math.floor(this.tick / YEAR_TICKS); }
  get season() { return Math.floor((this.tick % YEAR_TICKS) / SEASON_TICKS); }
  get seasonF() { return (this.tick % YEAR_TICKS) / SEASON_TICKS; }

  id() { return this.nextId++; }

  // ---------------------------------------------------------------- units
  spawnUnit(sp: Sp, x: number, z: number, opts: Partial<Unit> = {}): Unit {
    const def = SPECIES[sp];
    const r = this.rng;
    const adult = opts.age === undefined;
    const u: Unit = {
      id: this.id(), sp, x, z, px: x, pz: z, y: 0, dir: r.range(0, Math.PI * 2),
      hp: def.hp, maxHp: def.hp,
      age: adult ? def.adultAge + r.range(0, def.lifespan[0] * 0.3) : 0,
      maxAge: r.range(def.lifespan[0], def.lifespan[1]),
      hunger: r.range(0, 30), name: isCiv(sp) ? unitName(r, sp) : '', female: r.chance(0.5),
      kingdom: -1, village: -1, job: Job.None, task: null, path: null, pathI: 0,
      carry: Res.None, carryAmt: 0, traits: 0, kills: 0, xp: 0, level: 1, flags: 0, cd: 0,
      anim: Anim.Idle, animT: 0, emote: Emote.None, emoteT: 0, home: -1, born: this.tick,
      think: r.int(1, 10), look: r.int(0, 1 << 20), stuck: 0, lastHit: -1, breedT: Math.floor(def.breedEvery * YEAR_TICKS * r.range(0.5, 1.2)),
      hitT: 0, speedMul: 1, dmgMul: 1, item: 0, vx: 0, vz: 0, vy: 0, spin: 0, pathNav: 0, mood: 60,
      energy: r.range(60, 100), social: r.range(50, 90), mems: [], partner: -1, parents: [], friend: -1, rival: -1, crimes: 0, jailUntil: -1, mother: -1,
      ...opts,
    };
    if (isCiv(sp) && opts.traits === undefined) {
      const pool = [Trait.Brave, Trait.Strong, Trait.Fast, Trait.Wise, Trait.Lucky, Trait.Greedy, Trait.Peaceful, Trait.Bloodlust, Trait.Fertile, Trait.Weak];
      const n = r.chance(0.6) ? 1 : r.chance(0.3) ? 2 : 0;
      for (let i = 0; i < n; i++) u.traits |= r.pick(pool);
      if (u.traits & Trait.Peaceful) u.traits &= ~Trait.Bloodlust;
      if (u.traits & Trait.Weak) u.traits &= ~Trait.Strong;
    }
    this.applyTraits(u);
    if (opts.hp === undefined) u.hp = u.maxHp;
    this.units.push(u);
    this.unitMap.set(u.id, u);
    resolveInside(this, u);
    return u;
  }

  applyTraits(u: Unit) {
    const def = SPECIES[u.sp];
    let hp = def.hp, dmg = 1, spd = 1;
    if (u.traits & Trait.Strong) { hp *= 1.3; dmg *= 1.3; }
    if (u.traits & Trait.Weak) { hp *= 0.75; dmg *= 0.75; }
    if (u.traits & Trait.Fast) spd *= 1.3;
    if (u.traits & Trait.Blessed) { hp *= 1.25; dmg *= 1.2; spd *= 1.1; }
    if (u.traits & Trait.Bloodlust) dmg *= 1.15;
    hp *= 1 + (u.level - 1) * 0.12;
    dmg *= 1 + (u.level - 1) * 0.1;
    if (u.flags & UF.Hero) { hp *= 1.4; dmg *= 1.3; }
    const ratio = u.maxHp > 0 ? u.hp / u.maxHp : 1;
    u.maxHp = Math.round(hp); u.hp = Math.max(1, u.maxHp * ratio);
    u.dmgMul = dmg; u.speedMul = spd;
  }

  getUnit(id: number) { const u = this.unitMap.get(id); return u && !(u.flags & UF.Dead) ? u : undefined; }

  killUnit(u: Unit, cause: string, by?: Unit) {
    if (u.flags & UF.Dead) return;
    if (u.traits & Trait.Immortal && cause !== 'god') { u.hp = u.maxHp * 0.5; return; }
    u.flags |= UF.Dead;
    u.hp = 0;
    this.stats.deaths++;
    if (isCiv(u.sp)) this.deathCauses[cause] = (this.deathCauses[cause] ?? 0) + 1;
    if (isVehicle(u.sp)) { this.fx.push({ t: 'explosion', x: u.x, z: u.z, a: 1.4, b: 60 }); this.fx.push({ t: 'wreck', x: u.x, z: u.z, a: u.sp, u: u.id }); }
    else this.fx.push({ t: 'death', x: u.x, z: u.z, a: u.sp, u: u.id, b: cause === 'fire' ? 1 : cause === 'plague' ? 2 : 0 });
    // murder among neighbours is a crime the guards will pursue
    if (by && isCiv(by.sp) && isCiv(u.sp) && by.kingdom >= 0 && by.kingdom === u.kingdom && !(by.flags & UF.Mad) && !(u.flags & (UF.Jailed | UF.Escorted))) {
      const bv = this.villages.get(by.village);
      if (bv) { by.crimes += 2; addWanted(this, bv, by); }
    }
    if (by) {
      by.kills++; by.xp += 10 + u.level * 5;
      this.stats.kills++;
      levelCheck(this, by);
      const kb = this.kingdoms.get(by.kingdom); if (kb) kb.kills++;
    }
    const k = this.kingdoms.get(u.kingdom);
    if (k) k.deaths++;
    if (u.flags & UF.King && k) {
      k.king = -1;
      this.log('kingDied', { a: k.id, u: u.id, x: u.x, z: u.z, text: u.name });
    } else if (u.flags & UF.Hero) {
      this.log('heroDied', { a: u.kingdom, u: u.id, x: u.x, z: u.z, text: u.name });
    }
    const v = this.villages.get(u.village);
    if (v) { const i = v.residents.indexOf(u.id); if (i >= 0) v.residents.splice(i, 1); }
    onDeath(this, u, by);
    // undead rising from plague victims
    if (cause === 'plague' && this.laws.plague && this.rng.chance(0.25) && isCiv(u.sp)) {
      const x = u.x, z = u.z;
      setTimeout0(this, 30, () => { const s = this.spawnUnit(Sp.Skeleton, x, z); this.fx.push({ t: 'rise', x, z, u: s.id }); });
    }
  }

  // ---------------------------------------------------------------- spatial queries
  private rebuildCells() {
    const n = this.units.length;
    if (this.cellNext.length < n) this.cellNext = new Int32Array(Math.max(n * 2, 256));
    this.cellHead.fill(-1);
    for (let i = 0; i < n; i++) {
      const u = this.units[i];
      const cx = Math.min(this.cw - 1, Math.max(0, (u.x / CELL) | 0)), cz = Math.min(this.ch - 1, Math.max(0, (u.z / CELL) | 0));
      const c = cz * this.cw + cx;
      this.cellNext[i] = this.cellHead[c];
      this.cellHead[c] = i;
    }
  }

  /** Iterate units within radius r of (x,z). Return true from fn to stop early. */
  near(x: number, z: number, r: number, fn: (u: Unit, d2: number) => boolean | void) {
    const cx0 = Math.max(0, ((x - r) / CELL) | 0), cx1 = Math.min(this.cw - 1, ((x + r) / CELL) | 0);
    const cz0 = Math.max(0, ((z - r) / CELL) | 0), cz1 = Math.min(this.ch - 1, ((z + r) / CELL) | 0);
    const r2 = r * r;
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      let i = this.cellHead[cz * this.cw + cx];
      while (i >= 0) {
        const u = this.units[i];
        if (u && !(u.flags & UF.Dead)) {
          const dx = u.x - x, dz = u.z - z, d2 = dx * dx + dz * dz;
          if (d2 <= r2 && fn(u, d2)) return;
        }
        i = this.cellNext[i];
      }
    }
  }

  unitsNear(x: number, z: number, r: number): Unit[] {
    const out: Unit[] = [];
    this.near(x, z, r, (u) => { out.push(u); });
    return out;
  }

  /** Are these two parties hostile to each other? */
  hostile(a: Unit, b: Unit): boolean {
    if (a === b) return false;
    if (isVehicle(a.sp)) return enemyOf(this, a.kingdom, b);
    if (isVehicle(b.sp)) return !(b.sp === Sp.Plane && b.y > 1) && enemyOf(this, b.kingdom, a);
    if ((a.flags & UF.Mad) || (b.flags & UF.Mad)) return true;
    const da = SPECIES[a.sp], db = SPECIES[b.sp];
    if (da.undead !== db.undead && (da.undead || db.undead)) return true;
    if (da.undead && db.undead) return false;
    if (isCiv(a.sp) && isCiv(b.sp)) {
      if (a.kingdom < 0 || b.kingdom < 0 || a.kingdom === b.kingdom) return false;
      const ka = this.kingdoms.get(a.kingdom);
      return !!ka && ka.wars.includes(b.kingdom);
    }
    return false;
  }

  // ---------------------------------------------------------------- history / fx
  log(type: string, e: Omit<HistoryEntry, 'tick' | 'type'>) {
    const h: HistoryEntry = { tick: this.tick, type, ...e };
    this.history.push(h);
    if (this.history.length > 400) this.history.shift();
    this.onHistory?.(h);
  }

  emote(u: Unit, e: Emote, ticks = 25) { u.emote = e; u.emoteT = ticks; }

  // ---------------------------------------------------------------- buildings
  buildingAt(t: number) { const id = this.world.bld[t]; return id >= 0 ? this.buildings.get(id) : undefined; }

  removeBuilding(b: Building, ruin: boolean) {
    if (!b.alive) return;
    b.alive = false;
    const w = this.world;
    for (let dz = 0; dz < b.size; dz++) for (let dx = 0; dx < b.size; dx++) {
      const t = w.idx(b.x + dx, b.z + dz);
      if (w.bld[t] === b.id) w.bld[t] = -1;
      if (b.kind === Bk.Farm && w.feat[t] === 12) { w.setFeat(t, 0, 0); }
      if (b.kind === Bk.Farm && w.mat[t] === Mat.Farmland) { w.mat[t] = Mat.Soil; w.markMat(b.x, b.z, b.x + b.size, b.z + b.size); }
    }
    this.buildings.delete(b.id);
    w.navVersion++;
    const v = this.villages.get(b.village);
    if (v) { const i = v.buildings.indexOf(b.id); if (i >= 0) v.buildings.splice(i, 1); }
    this.fx.push({ t: 'collapse', x: b.x + b.size / 2, z: b.z + b.size / 2, a: b.kind, b: b.size });
    onBuildingDestroyed(this, b);
    if (ruin && b.kind !== Bk.Farm && b.size >= 2 && b.progress > 0.5) {
      const r: Building = { ...b, id: this.id(), kind: Bk.Ruin, village: -1, alive: true, hp: 1, fire: 0, progress: 1, born: this.tick };
      this.buildings.set(r.id, r);
      for (let dz = 0; dz < b.size; dz++) for (let dx = 0; dx < b.size; dx++) w.bld[w.idx(b.x + dx, b.z + dz)] = r.id;
    }
  }

  damageBuilding(b: Building, dmg: number, by?: Unit) {
    if (!b.alive) return;
    b.hp -= dmg;
    const v = this.villages.get(b.village);
    if (v) v.lastAttacked = this.tick;
    if (b.hp <= 0) {
      if (by && b.kind === Bk.TownHall) {
        // capture handled by civ
      }
      this.removeBuilding(b, true);
    }
  }

  // ---------------------------------------------------------------- update
  scheduled: { at: number; fn: () => void }[] = [];

  step() {
    this.tick++;
    this.pathCalls = 0;
    this.rebuildCells();
    const units = this.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.flags & UF.Dead) continue;
      unitTick(this, u);
    }
    // villages / kingdoms (staggered)
    for (const v of this.villages.values()) if (v.alive && (this.tick + v.id * 7) % 20 === 0) villageThink(this, v);
    for (const k of this.kingdoms.values()) if (k.alive && (this.tick + k.id * 13) % 50 === 0) kingdomThink(this, k);
    if (this.tick % 100 === 0) diplomacyThink(this);
    // buildings
    for (const b of this.buildings.values()) {
      if (b.kind === Bk.Cannon) cannonTick(this, b);
      if (b.fire > 0) {
        b.fire--;
        if (this.tick % 5 === 0) this.damageBuilding(b, b.maxHp * 0.025);
        if (this.weather.rain > 0.5 && this.rng.chance(0.05)) b.fire = 0;
      }
    }
    natureTick(this);
    disasterTick(this);
    this.physics?.tick(this);
    if (this.scheduled.length) {
      const due = this.scheduled.filter((s) => s.at <= this.tick);
      if (due.length) { this.scheduled = this.scheduled.filter((s) => s.at > this.tick); for (const s of due) s.fn(); }
    }
    // compact dead units
    if (this.tick % 10 === 0) {
      let j = 0;
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u.flags & UF.Dead) { this.unitMap.delete(u.id); continue; }
        units[j++] = u;
      }
      units.length = j;
    }
  }

  count(sp?: Sp) { let n = 0; for (const u of this.units) if (!(u.flags & UF.Dead) && (sp === undefined || u.sp === sp)) n++; return n; }
}

export function setTimeout0(sim: Sim, ticks: number, fn: () => void) { sim.scheduled.push({ at: sim.tick + ticks, fn }); }

export function levelCheck(sim: Sim, u: Unit) {
  const need = u.level * u.level * 18;
  if (u.xp >= need && u.level < 10) {
    u.level++;
    sim.applyTraits(u);
    u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.3);
    sim.fx.push({ t: 'levelup', x: u.x, z: u.z, u: u.id });
    if (u.level >= 4 && !(u.flags & UF.Hero) && isCiv(u.sp)) {
      u.flags |= UF.Hero;
      sim.applyTraits(u);
      sim.emote(u, Emote.Star, 40);
      sim.log('hero', { a: u.kingdom, u: u.id, x: u.x, z: u.z, text: u.name });
    }
  }
}

void BUILDINGS;
