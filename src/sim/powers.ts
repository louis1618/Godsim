import { Sim } from './sim';
import { Sp, Mat, Feat, Trait, isCiv, SPECIES, Bk } from './defs';
import { spawnVehicle } from './vehicles';
import { Unit, UF, Emote, Job } from './entities';
import { ignite } from './nature';
import { explode, lightning, earthquake, infect, spawnMeteor, spawnTornado } from './disasters';
import { declareWar, makePeace, makeAlliance, villageOf, destroyVillage, rebelVillage, placeBuilding } from './civ';
import { panic } from './ai';
import { smoothstep } from '../core/math';

export type PowerCat = 'world' | 'life' | 'civ' | 'nature' | 'disaster' | 'military' | 'observe' | 'settings';
export type PowerMode = 'brush' | 'click' | 'unit' | 'pair' | 'village' | 'panel' | 'grab' | 'inspect';

export interface PowerDef {
  id: string;
  cat: PowerCat;
  mode: PowerMode;
  key?: string;
  rate?: number;        // applications per second while held (brush / click-drag)
  size?: [number, number, number]; // brush radius [min, default, max]
  sound?: string;
}

const B = (min: number, def: number, max: number): [number, number, number] => [min, def, max];

export const POWERS: PowerDef[] = [
  // observe (first: default tools)
  { id: 'inspect', cat: 'observe', mode: 'inspect', key: 'KeyI' },
  { id: 'hand', cat: 'observe', mode: 'grab', key: 'KeyH' },
  { id: 'follow', cat: 'observe', mode: 'unit', key: 'KeyF' },
  { id: 'stats', cat: 'observe', mode: 'panel' },
  { id: 'history', cat: 'observe', mode: 'panel' },
  { id: 'kingdoms', cat: 'observe', mode: 'panel' },
  // world
  { id: 'raise', cat: 'world', mode: 'brush', rate: 14, size: B(1, 3, 12), key: 'Digit1' },
  { id: 'lower', cat: 'world', mode: 'brush', rate: 14, size: B(1, 3, 12), key: 'Digit2' },
  { id: 'flatten', cat: 'world', mode: 'brush', rate: 10, size: B(1, 4, 12), key: 'Digit3' },
  { id: 'ocean', cat: 'world', mode: 'brush', rate: 12, size: B(1, 4, 14), key: 'Digit4' },
  { id: 'land', cat: 'world', mode: 'brush', rate: 12, size: B(1, 4, 14), key: 'Digit5' },
  { id: 'mountain', cat: 'world', mode: 'brush', rate: 10, size: B(2, 4, 12), key: 'Digit6' },
  { id: 'grass', cat: 'world', mode: 'brush', rate: 12, size: B(1, 4, 14) },
  { id: 'sand', cat: 'world', mode: 'brush', rate: 12, size: B(1, 4, 14) },
  { id: 'desert', cat: 'world', mode: 'brush', rate: 12, size: B(1, 4, 14) },
  { id: 'snow', cat: 'world', mode: 'brush', rate: 12, size: B(1, 4, 14) },
  { id: 'swamp', cat: 'world', mode: 'brush', rate: 12, size: B(1, 4, 14) },
  { id: 'lava', cat: 'world', mode: 'brush', rate: 10, size: B(1, 2, 8) },
  // life
  { id: 'human', cat: 'life', mode: 'click', rate: 6 },
  { id: 'elf', cat: 'life', mode: 'click', rate: 6 },
  { id: 'dwarf', cat: 'life', mode: 'click', rate: 6 },
  { id: 'orc', cat: 'life', mode: 'click', rate: 6 },
  { id: 'sheep', cat: 'life', mode: 'click', rate: 8 },
  { id: 'chicken', cat: 'life', mode: 'click', rate: 8 },
  { id: 'deer', cat: 'life', mode: 'click', rate: 8 },
  { id: 'wolf', cat: 'life', mode: 'click', rate: 6 },
  { id: 'bear', cat: 'life', mode: 'click', rate: 4 },
  { id: 'skeleton', cat: 'life', mode: 'click', rate: 6 },
  { id: 'troll', cat: 'life', mode: 'click', rate: 1.5 },
  // civilization
  { id: 'war', cat: 'civ', mode: 'pair' },
  { id: 'peace', cat: 'civ', mode: 'pair' },
  { id: 'alliance', cat: 'civ', mode: 'pair' },
  { id: 'rebel', cat: 'civ', mode: 'village' },
  { id: 'bless', cat: 'civ', mode: 'brush', rate: 3, size: B(2, 4, 10) },
  { id: 'madness', cat: 'civ', mode: 'unit' },
  { id: 'crown', cat: 'civ', mode: 'unit' },
  { id: 'strong', cat: 'civ', mode: 'unit' },
  { id: 'brave', cat: 'civ', mode: 'unit' },
  { id: 'fast', cat: 'civ', mode: 'unit' },
  { id: 'immortal', cat: 'civ', mode: 'unit' },
  { id: 'enlighten', cat: 'civ', mode: 'village' },
  // nature
  { id: 'rain', cat: 'nature', mode: 'click' },
  { id: 'storm', cat: 'nature', mode: 'click' },
  { id: 'forest', cat: 'nature', mode: 'brush', rate: 8, size: B(1, 4, 12) },
  { id: 'bloom', cat: 'nature', mode: 'brush', rate: 6, size: B(2, 5, 14) },
  { id: 'heat', cat: 'nature', mode: 'brush', rate: 8, size: B(2, 5, 14) },
  { id: 'frost', cat: 'nature', mode: 'brush', rate: 8, size: B(2, 5, 14) },
  // disasters
  { id: 'lightning', cat: 'disaster', mode: 'click', rate: 5, key: 'KeyL' },
  { id: 'fire', cat: 'disaster', mode: 'brush', rate: 10, size: B(1, 2, 6) },
  { id: 'bomb', cat: 'disaster', mode: 'click', rate: 2.5, key: 'KeyB' },
  { id: 'meteor', cat: 'disaster', mode: 'click', rate: 1.5, key: 'KeyM' },
  { id: 'tornado', cat: 'disaster', mode: 'click', rate: 1 },
  { id: 'quake', cat: 'disaster', mode: 'click', rate: 0.7 },
  { id: 'plague', cat: 'disaster', mode: 'click', rate: 1 },
  { id: 'smite', cat: 'disaster', mode: 'unit' },
  // weapons & machines of the later ages
  { id: 'tank', cat: 'military', mode: 'click', rate: 1.5 },
  { id: 'plane', cat: 'military', mode: 'click', rate: 1 },
  { id: 'warship', cat: 'military', mode: 'click', rate: 1 },
  { id: 'cannon', cat: 'military', mode: 'click', rate: 2 },
  { id: 'nuke', cat: 'military', mode: 'click', rate: 0.25, key: 'KeyN' },
  // settings
  { id: 'laws', cat: 'settings', mode: 'panel' },
  { id: 'saveload', cat: 'settings', mode: 'panel' },
  { id: 'newworld', cat: 'settings', mode: 'panel' },
  { id: 'audio', cat: 'settings', mode: 'panel' },
];
export const POWER_MAP = new Map(POWERS.map((p) => [p.id, p]));
export const CATS: PowerCat[] = ['world', 'life', 'civ', 'nature', 'disaster', 'military', 'observe', 'settings'];

const SPAWN: Record<string, Sp> = { human: Sp.Human, elf: Sp.Elf, dwarf: Sp.Dwarf, orc: Sp.Orc, sheep: Sp.Sheep, chicken: Sp.Chicken, deer: Sp.Deer, wolf: Sp.Wolf, bear: Sp.Bear, skeleton: Sp.Skeleton, troll: Sp.Troll };

/** Visit tiles of a circular brush with a smooth falloff weight. */
function brush(sim: Sim, x: number, z: number, r: number, fn: (t: number, k: number, tx: number, tz: number) => void) {
  const w = sim.world;
  const R = Math.ceil(r);
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const tx = Math.floor(x) + dx, tz = Math.floor(z) + dz;
    if (!w.inside(tx, tz)) continue;
    const d = Math.hypot(tx + 0.5 - x, tz + 0.5 - z);
    if (d > r + 0.5) continue;
    const k = 1 - smoothstep(r * 0.5, r + 0.5, d);
    fn(tz * w.W + tx, k, tx, tz);
  }
  const R2 = R + 2;
  w.markTerrain(Math.floor(x) - R2, Math.floor(z) - R2, Math.floor(x) + R2, Math.floor(z) + R2);
}

function setMat(sim: Sim, t: number, m: Mat) {
  const w = sim.world;
  if (w.isWater(t) || w.bld[t] >= 0 && m !== Mat.Lava) return;
  w.mat[t] = m;
  w.grass[t] = m === Mat.Grass ? 200 : m === Mat.Swamp ? 120 : 0;
  const f = w.feat[t];
  if (m === Mat.Lava) { if (f) w.setFeat(t, Feat.None, 0); ignite(sim, t, 255); }
  else if (m === Mat.Desert && (f === Feat.Oak || f === Feat.Pine || f === Feat.Birch)) w.setFeat(t, Feat.Dead, 120);
  else if (m === Mat.Snow && (f === Feat.Oak || f === Feat.Birch || f === Feat.Palm)) w.setFeat(t, Feat.SnowPine, w.featAmt[t]);
}

/** Terrain fixes after a sculpt: keep rivers/water tiles consistent and materials plausible. */
function afterSculpt(sim: Sim, t: number) {
  const w = sim.world;
  const h = w.height[t];
  if (h < 0 && w.water[t] < 0) w.water[t] = 0;
  if (w.isWater(t)) {
    if (w.feat[t] !== Feat.None) w.setFeat(t, Feat.None, 0);
    const b = sim.buildingAt(t);
    if (b) sim.damageBuilding(b, 40);
    if (w.fire[t]) w.fire[t] = 0;
  } else if (w.mat[t] === Mat.Sand && h > 1.6) w.mat[t] = Mat.Grass;
  if (h > 8.5 && w.mat[t] !== Mat.Snow && w.mat[t] !== Mat.Lava) w.mat[t] = h > 11 ? Mat.Snow : Mat.Rock;
}

export interface ApplyCtx { brush: number; dt: number; first: boolean; unit?: Unit | null; }

/** Apply a power at world coords. Returns false if nothing happened (for feedback). */
export function applyPower(sim: Sim, id: string, x: number, z: number, ctx: ApplyCtx): boolean {
  const w = sim.world;
  const r = ctx.brush;
  const t0 = w.tileAt(x, z);
  switch (id) {
    case 'raise': brush(sim, x, z, r, (t, k) => { w.height[t] += 0.55 * k; afterSculpt(sim, t); if (w.height[t] > 0 && w.mat[t] === Mat.Sand && w.height[t] > 0.8) w.mat[t] = Mat.Grass; }); break;
    case 'lower': brush(sim, x, z, r, (t, k) => { w.height[t] -= 0.55 * k; afterSculpt(sim, t); }); break;
    case 'flatten': {
      if (t0 < 0) return false;
      const target = w.height[t0];
      brush(sim, x, z, r, (t, k) => { w.height[t] += (target - w.height[t]) * 0.35 * k; afterSculpt(sim, t); });
      break;
    }
    case 'ocean': brush(sim, x, z, r, (t, k) => { w.height[t] += (-3.2 - w.height[t]) * 0.4 * k; w.water[t] = Math.max(0, Math.min(w.water[t], 0)); if (w.height[t] < 0) { w.mat[t] = Mat.Sand; } afterSculpt(sim, t); }); break;
    case 'land': brush(sim, x, z, r, (t, k) => {
      if (w.height[t] < 0.6) w.height[t] += (0.7 - w.height[t]) * 0.75 * k;
      if (k > 0.3 && w.height[t] > 0.3 && (w.mat[t] === Mat.Sand || w.mat[t] === Mat.Lava)) { w.mat[t] = w.height[t] > 0.55 ? Mat.Grass : Mat.Sand; w.grass[t] = 150; }
      if (w.water[t] > 0 && w.height[t] > 0.3) w.water[t] = 0;
      afterSculpt(sim, t);
    }); break;
    case 'mountain': brush(sim, x, z, r, (t, k) => { w.height[t] += 1.1 * k * k; if (k > 0.5) w.mat[t] = w.height[t] > 10 ? Mat.Snow : Mat.Rock; afterSculpt(sim, t); }); break;
    case 'grass': brush(sim, x, z, r, (t, k) => { if (k > 0.35) setMat(sim, t, Mat.Grass); }); break;
    case 'sand': brush(sim, x, z, r, (t, k) => { if (k > 0.35) setMat(sim, t, Mat.Sand); }); break;
    case 'desert': brush(sim, x, z, r, (t, k) => { if (k > 0.35) setMat(sim, t, Mat.Desert); }); break;
    case 'snow': brush(sim, x, z, r, (t, k) => { if (k > 0.35) setMat(sim, t, Mat.Snow); }); break;
    case 'swamp': brush(sim, x, z, r, (t, k) => { if (k > 0.35) setMat(sim, t, Mat.Swamp); }); break;
    case 'lava': brush(sim, x, z, r, (t, k) => { if (k > 0.4) { setMat(sim, t, Mat.Lava); if (w.height[t] < 0.3) w.height[t] = 0.3; } }); break;
    case 'human': case 'elf': case 'dwarf': case 'orc': case 'sheep': case 'chicken': case 'deer': case 'wolf': case 'bear': case 'skeleton': case 'troll': {
      if (t0 < 0 || !w.walkable(t0)) return false;
      const u = sim.spawnUnit(SPAWN[id], x + sim.rng.range(-0.3, 0.3), z + sim.rng.range(-0.3, 0.3));
      if (isCiv(u.sp)) { u.female = sim.rng.chance(0.5); u.born = sim.tick - 20; }
      sim.fx.push({ t: 'spawn', x: u.x, z: u.z, u: u.id, a: u.sp });
      break;
    }
    case 'rain': sim.rainClouds.push({ id: sim.id(), x, z, vx: sim.rng.range(-0.04, 0.04), vz: sim.rng.range(-0.04, 0.04), life: 600, r: 7, storm: false }); break;
    case 'storm': sim.rainClouds.push({ id: sim.id(), x, z, vx: sim.rng.range(-0.05, 0.05), vz: sim.rng.range(-0.05, 0.05), life: 600, r: 9, storm: true }); break;
    case 'forest': brush(sim, x, z, r, (t, k, tx, tz) => {
      if (w.isWater(t) || w.bld[t] >= 0 || w.feat[t] !== Feat.None || sim.rng.next() > k * 0.25) return;
      const m = w.mat[t];
      const f = m === Mat.Desert ? Feat.Cactus : m === Mat.Snow ? Feat.SnowPine : m === Mat.Sand ? Feat.Palm : m === Mat.Savanna ? Feat.Acacia : m === Mat.Rock || m === Mat.Lava ? Feat.None : sim.rng.pick([Feat.Oak, Feat.Oak, Feat.Pine, Feat.Birch]);
      if (f === Feat.None) return;
      w.setFeat(t, f, 40);
      sim.fx.push({ t: 'sprout', x: tx + 0.5, z: tz + 0.5, u: t });
    }); break;
    case 'bloom': brush(sim, x, z, r, (t, k, tx, tz) => {
      if (w.isWater(t)) return;
      if (w.mat[t] === Mat.Ash || w.mat[t] === Mat.Soil) w.mat[t] = Mat.Grass;
      if (w.mat[t] === Mat.Grass && sim.rng.chance(0.15 * k)) w.mat[t] = Mat.Lush;
      w.grass[t] = 255;
      const f = w.feat[t];
      if (f >= 1 && f <= 7 && w.featAmt[t] < 255) { w.featAmt[t] = Math.min(255, w.featAmt[t] + 60); w.markFeatTile(t); }
      else if (f === Feat.Dead) w.setFeat(t, Feat.Oak, 80);
      else if (f === Feat.None && w.bld[t] < 0 && sim.rng.chance(0.05 * k) && (w.mat[t] === Mat.Grass || w.mat[t] === Mat.Lush)) { w.setFeat(t, sim.rng.chance(0.6) ? Feat.Flower : Feat.Berry, 200); sim.fx.push({ t: 'sprout', x: tx + 0.5, z: tz + 0.5, u: t }); }
    }); sim.fx.push({ t: 'heal', x, z }); break;
    case 'heat': brush(sim, x, z, r, (t, k) => {
      if (k < 0.3) return;
      const m = w.mat[t];
      if (m === Mat.Snow) w.mat[t] = w.height[t] > 9 ? Mat.Rock : Mat.Grass;
      else if (m === Mat.Swamp) w.mat[t] = Mat.Grass;
      else if (m === Mat.Grass && sim.rng.chance(0.2)) w.mat[t] = Mat.Savanna;
      else if (m === Mat.Savanna && sim.rng.chance(0.2)) w.mat[t] = Mat.Desert;
      w.wet[t] = 0;
      if (w.isWater(t) && w.waterDepth(t) < 0.5 && w.water[t] > 0) { w.water[t] = w.height[t] - 0.01; }
      if (w.feat[t] === Feat.SnowPine) w.setFeat(t, Feat.Pine, w.featAmt[t]);
      if (sim.rng.chance(0.004 * k)) ignite(sim, t, 160);
    }); sim.near(x, z, r, (u) => { if (!SPECIES[u.sp].undead) u.hunger += 2; }); break;
    case 'frost': brush(sim, x, z, r, (t, k) => {
      if (k < 0.3) return;
      if (w.fire[t]) w.fire[t] = 0;
      const m = w.mat[t];
      if (m !== Mat.Rock && m !== Mat.Lava && !w.isWater(t) && w.bld[t] < 0 && m !== Mat.Farmland) w.mat[t] = Mat.Snow;
      if (m === Mat.Lava) w.mat[t] = Mat.Rock;
      const f = w.feat[t];
      if (f === Feat.Oak || f === Feat.Birch || f === Feat.Pine) w.setFeat(t, Feat.SnowPine, w.featAmt[t]);
      if (f === Feat.Palm || f === Feat.Cactus || f === Feat.Acacia) w.setFeat(t, Feat.Dead, 120);
    }); sim.near(x, z, r, (u) => { u.hunger += 3; if (u.flags & UF.Burning) u.flags &= ~UF.Burning; }); break;
    case 'lightning': lightning(sim, x, z); break;
    case 'fire': brush(sim, x, z, Math.max(0.6, r * 0.6), (t, k) => { if (k > 0.3) ignite(sim, t, 230); }); sim.near(x, z, r * 0.7, (u) => { u.flags |= UF.Burning; panic(sim, u, x, z); }); break;
    case 'bomb': explode(sim, x, z, 2.6, 110, { crater: 1.2, fire: true }); break;
    case 'meteor': spawnMeteor(sim, x, z, 1); break;
    case 'tornado': spawnTornado(sim, x, z); break;
    case 'quake': earthquake(sim, x, z, 10); break;
    case 'plague': infect(sim, x, z, 3.5); break;
    case 'tank': case 'plane': case 'warship': {
      if (t0 < 0) return false;
      const water = w.waterDepth(t0) > 0.4;
      if ((id === 'warship') !== water && id !== 'plane') return false;
      const vid = w.owner[t0];
      const v = vid >= 0 ? sim.villages.get(vid) : undefined;
      const kid = v ? v.kingdom : kingdomAt(sim, x, z);
      const u = spawnVehicle(sim, id === 'tank' ? Sp.Tank : id === 'plane' ? Sp.Plane : Sp.Boat, x, z, kid, v ? v.id : -1, id === 'warship' ? 1 : 0);
      if (id === 'plane') u.y = 2;
      break;
    }
    case 'cannon': {
      if (t0 < 0) return false;
      const v = sim.villages.get(w.owner[t0]);
      const tx = Math.floor(x), tz = Math.floor(z);
      if (!v || !v.alive || !w.walkable(t0) || w.bld[t0] >= 0) return false;
      placeBuilding(sim, v, Bk.Cannon, tx, tz, v.race, 1).aim = sim.rng.range(0, Math.PI * 2);
      break;
    }
    case 'nuke': nuke(sim, x, z); break;
    case 'bless': {
      let any = false;
      sim.near(x, z, r, (u) => { if (!SPECIES[u.sp].undead) { u.traits |= Trait.Blessed; u.flags &= ~UF.Sick; sim.applyTraits(u); u.hp = u.maxHp; sim.emote(u, Emote.Star, 20); any = true; } });
      const tv = t0 >= 0 ? sim.villages.get(w.owner[t0]) : undefined;
      if (tv) { tv.blessT = sim.tick + 1200; tv.food += 10; tv.loyalty += 30; any = true; }
      sim.fx.push({ t: 'heal', x, z });
      sim.fx.push({ t: 'bless', x, z, a: r });
      return any;
    }
  }
  return true;
}

/** Powers that target a single creature. */
export function applyUnitPower(sim: Sim, id: string, u: Unit): boolean {
  switch (id) {
    case 'madness':
      u.flags ^= UF.Mad;
      sim.emote(u, u.flags & UF.Mad ? Emote.Angry : Emote.Heart, 40);
      u.task = null; u.think = 0;
      sim.fx.push({ t: 'curse', x: u.x, z: u.z, u: u.id });
      return true;
    case 'crown': {
      const k = sim.kingdoms.get(u.kingdom);
      if (!k || !isCiv(u.sp)) return false;
      const old = sim.getUnit(k.king);
      if (old) old.flags &= ~UF.King;
      k.king = u.id; u.flags |= UF.King; u.job = Job.None;
      sim.emote(u, Emote.Crown, 50);
      sim.log('newKing', { a: k.id, u: u.id, x: u.x, z: u.z, text: u.name });
      sim.fx.push({ t: 'levelup', x: u.x, z: u.z, u: u.id });
      return true;
    }
    case 'strong': case 'brave': case 'fast': case 'immortal': {
      const tr = id === 'strong' ? Trait.Strong : id === 'brave' ? Trait.Brave : id === 'fast' ? Trait.Fast : Trait.Immortal;
      u.traits |= tr;
      if (tr === Trait.Strong) u.traits &= ~Trait.Weak;
      sim.applyTraits(u);
      sim.emote(u, Emote.Star, 25);
      sim.fx.push({ t: 'levelup', x: u.x, z: u.z, u: u.id });
      return true;
    }
    case 'smite':
      lightning(sim, u.x, u.z);
      sim.killUnit(u, 'god');
      return true;
  }
  return false;
}

/** Powers that need two kingdoms. */
export function applyPairPower(sim: Sim, id: string, a: number, b: number): boolean {
  const ka = sim.kingdoms.get(a), kb = sim.kingdoms.get(b);
  if (!ka || !kb || a === b || !ka.alive || !kb.alive) return false;
  if (id === 'war') { if (ka.wars.includes(b)) return false; declareWar(sim, ka, kb); return true; }
  if (id === 'peace') { if (!ka.wars.includes(b)) return false; makePeace(sim, ka, kb); return true; }
  if (id === 'alliance') { if (ka.wars.includes(b)) makePeace(sim, ka, kb); makeAlliance(sim, ka, kb); return true; }
  return false;
}

/** Knowledge from the heavens: a village's kingdom leaps toward its next age. */
export function enlighten(sim: Sim, vid: number): boolean {
  const v = sim.villages.get(vid);
  const k = v && sim.kingdoms.get(v.kingdom);
  if (!v || !k) return false;
  k.tech += 60 + k.era * 40;
  for (const id of v.residents) { const u = sim.getUnit(id); if (u) sim.emote(u, Emote.Star, 30); }
  sim.fx.push({ t: 'era', x: v.cx + 0.5, z: v.cz + 0.5, a: k.id, b: k.era });
  return true;
}

/** A nuclear blast: a vast explosion, a mushroom cloud, scorched dead land and sickness around it. */
export function nuke(sim: Sim, x: number, z: number) {
  const w = sim.world;
  sim.fx.push({ t: 'nuke', x, z, a: 12 });
  explode(sim, x, z, 11, 900, { crater: 4.5, fire: true });
  // fallout: everything withers, survivors fall sick
  const R = 20;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const tx = Math.floor(x) + dx, tz = Math.floor(z) + dz;
    if (!w.inside(tx, tz)) continue;
    const d = Math.hypot(dx, dz);
    if (d > R) continue;
    const t = tz * w.W + tx;
    const f = w.feat[t];
    if (f >= 1 && f <= 7 && sim.rng.chance(1 - d / R)) w.setFeat(t, Feat.Dead, 120);
    if (f === Feat.Berry || f === Feat.Flower || f === Feat.Crop) w.setFeat(t, Feat.None, 0);
    if (!w.isWater(t) && d < R * 0.8) { if (w.mat[t] !== Mat.Rock) w.mat[t] = Mat.Ash; w.grass[t] = 0; }
  }
  w.markTerrain(Math.floor(x) - R - 2, Math.floor(z) - R - 2, Math.floor(x) + R + 2, Math.floor(z) + R + 2);
  sim.near(x, z, R * 1.2, (u) => { if (!SPECIES[u.sp].undead && u.sp < Sp.Boat) { u.flags |= UF.Sick; sim.emote(u, Emote.Sick, 40); } });
  sim.log('nuke', { x, z, text: '☢' });
}

export function incite(sim: Sim, vid: number): boolean {
  const v = sim.villages.get(vid);
  if (!v || !v.alive) return false;
  const k = sim.kingdoms.get(v.kingdom);
  if (!k || k.villages.length < 2 || k.capital === v.id) { v.loyalty -= 60; return false; }
  v.loyalty = -50;
  // force the rebellion now
  const mod = rebelNow;
  mod(sim, v.id);
  return true;
}
let rebelNow: (sim: Sim, vid: number) => void = rebelVillage;
export function setRebelFn(fn: (sim: Sim, vid: number) => void) { rebelNow = fn; }

export function kingdomAt(sim: Sim, x: number, z: number): number {
  const t = sim.world.tileAt(x, z);
  if (t >= 0) {
    const vid = sim.world.owner[t];
    const v = sim.villages.get(vid);
    if (v && v.alive) return v.kingdom;
  }
  // nearest civ unit
  let best = -1, bd = 9;
  sim.near(x, z, 3, (u, d2) => { if (isCiv(u.sp) && u.kingdom >= 0 && d2 < bd) { bd = d2; best = u.kingdom; } });
  return best;
}

void villageOf; void destroyVillage;
