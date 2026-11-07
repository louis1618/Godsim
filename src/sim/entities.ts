import { Sp, Bk } from './defs';

export const enum Job { None = 0, Gatherer = 1, Farmer = 2, Woodcutter = 3, Miner = 4, Builder = 5, Warrior = 6, Hunter = 7, Guard = 8, Trader = 9, Fisher = 10, Scholar = 11, Worker = 12, Mage = 13 }
export const enum Anim { Idle = 0, Walk = 1, Work = 2, Attack = 3, Panic = 4, Sleep = 5, Cheer = 6, Swim = 7, Fly = 8, Eat = 9, Drive = 10, Float = 11, Soar = 12, Drown = 14, Cast = 15, Die = 16, Hover = 17 }
export const enum Emote { None = 0, Heart = 1, Angry = 2, Alert = 3, Sad = 4, Zzz = 5, Music = 6, Skull = 7, Crown = 8, Sick = 9, Star = 10, Food = 11, Swords = 12 }
export const enum UF {
  King = 1 << 0, Hero = 1 << 1, Sick = 1 << 2, Mad = 1 << 3, Settler = 1 << 4, Leader = 1 << 5,
  Burning = 1 << 6, Ragdoll = 1 << 7, Held = 1 << 8, Dead = 1 << 9, Blessed = 1 << 10, Cursed = 1 << 11,
  Jailed = 1 << 12, Aboard = 1 << 13, Escorted = 1 << 14, Beamed = 1 << 15,
}
export const enum Res { None = 0, Food = 1, Wood = 2, Stone = 3, Gold = 4 }

export type Task =
  | { k: 'idle'; t: number; plant?: number }
  | { k: 'wander'; tx: number; tz: number }
  | { k: 'move'; tx: number; tz: number; then?: Task }
  | { k: 'gather'; tile: number; res: Res; work: number; sx?: number; sz?: number }
  | { k: 'deliver' }
  | { k: 'build'; b: number; sx?: number; sz?: number }
  | { k: 'farm'; b: number; tile: number; work: number }
  | { k: 'attack'; u: number }
  | { k: 'raze'; b: number; sx?: number; sz?: number }
  | { k: 'flee'; tx: number; tz: number; n?: number }
  | { k: 'eat' }
  | { k: 'graze'; work: number }
  | { k: 'hunt'; u: number }
  | { k: 'settle'; tx: number; tz: number }
  | { k: 'march'; v: number }
  | { k: 'rally'; tx: number; tz: number }
  | { k: 'love'; u: number; t: number }
  | { k: 'chat'; u: number; t: number }
  | { k: 'sleep'; t: number; sx?: number; sz?: number }
  | { k: 'dance'; t: number }
  | { k: 'steal'; v: number; sx?: number; sz?: number }
  | { k: 'post'; b: number; t: number; sx?: number; sz?: number }
  | { k: 'arrest'; u: number; n: number; fought?: boolean }
  | { k: 'escort'; u: number; b: number; sx?: number; sz?: number }
  | { k: 'escorted'; g: number }
  | { k: 'jailed'; b: number }
  | { k: 'trade'; v: number; res: Res; amt: number; back: boolean; sx?: number; sz?: number; n: number }
  | { k: 'board'; boat: number }
  | { k: 'swim'; tx: number; tz: number; n: number }
  | { k: 'heal'; u: number; t: number }
  | { k: 'abduct'; u: number; t: number }
  | { k: 'voyage'; phase: number; tx: number; tz: number; wp: number[]; wi: number; n: number; riders?: number[]; site?: [number, number] };

export interface Unit {
  id: number;
  sp: Sp;
  x: number; z: number;     // position in tiles (continuous)
  px: number; pz: number;   // previous tick position (render interpolation)
  y: number;                // height offset above ground (jumps / flung)
  dir: number;
  hp: number; maxHp: number;
  age: number; maxAge: number;
  hunger: number;
  name: string;
  female: boolean;
  kingdom: number; village: number;
  job: Job;
  task: Task | null;
  path: Int32Array | null; pathI: number;
  carry: Res; carryAmt: number;
  traits: number;
  kills: number; xp: number; level: number;
  flags: number;
  cd: number;               // attack cooldown (ticks)
  anim: Anim; animT: number;
  emote: Emote; emoteT: number;
  home: number;
  born: number;             // tick
  think: number;            // ticks until next decision
  look: number;             // appearance seed
  stuck: number;
  lastHit: number;          // attacker unit id
  breedT: number;           // animals: ticks until can breed
  hitT: number;             // flash timer for render
  speedMul: number; dmgMul: number;
  item: number;             // held tool/weapon id for rendering
  vx: number; vz: number; vy: number; // flung velocity (when airborne)
  spin: number;
  pathNav: number;          // nav version the current path was planned against
  mood: number;             // 0..100, derived from needs + memories + surroundings
  energy: number;           // 0 exhausted .. 100 rested
  social: number;           // 0 lonely .. 100 fulfilled
  mems: Memory[];           // timed mood modifiers (grief, wedding, victory, ...)
  partner: number;          // unit id or -1
  parents: number[];        // [mother, father] unit ids (may be dead)
  friend: number;           // best friend unit id or -1
  rival: number;            // grudge unit id or -1
  crimes: number;           // crimes committed (police / prison)
  jailUntil: number;        // tick until release when imprisoned (-1 free)
  mother: number;           // convenience: mother id or -1
  blocked: number;          // consecutive blocked re-plans
  pathWait: number;         // ticks spent waiting for a share of the path-search budget
  wdX: number; wdZ: number; wdT: number; // watchdog anchor: last place/time real progress was seen (wdT < 0 = unset)
  idleRun: number;          // consecutive idle decisions (restless after a while)
  air: number | undefined;  // breath left (0..100) while under deep water; undefined = breathing freely
  lod: number;              // 1 = half-rate update (calm wildlife); see sim.step
  lodTick: number;          // tick of the last half-rate update (render interpolation)
}

export const enum Mem { Grief = 1, Wedding = 2, NewBaby = 3, Victory = 4, Defeat = 5, Injured = 6, Blessed = 7, Famine = 8, Homeless = 9, Jailed = 10, Robbed = 11, Party = 12, Fire = 13, Disaster = 14, Trade = 15 }
export interface Memory { k: Mem; v: number; until: number; }

export interface Building {
  id: number;
  kind: Bk;
  race: Sp;
  village: number;
  x: number; z: number;     // top-left tile
  size: number;
  rot: number;              // 0..3 quarter turns
  progress: number;         // 0..1 constructed
  hp: number; maxHp: number;
  fire: number;             // burning ticks remaining
  level: number;            // town hall tier etc.
  alive: boolean;
  born: number;
  look: number;
  aim?: number;             // turret yaw (cannons)
}

export interface Village {
  id: number;
  name: string;
  kingdom: number;
  race: Sp;
  cx: number; cz: number;   // centre tile coords
  buildings: number[];
  residents: number[];
  food: number; wood: number; stone: number; gold: number;
  level: number;
  radius: number;
  loyalty: number;
  happiness: number;
  planT: number;
  founded: number;
  alive: boolean;
  hall: number;             // town hall building id
  rallyT: number;
  avgMood: number;          // mean resident mood (drives output, births, loyalty)
  forest: number;           // share of wooded land around (elves care)
  homeless: boolean;        // more people than beds
  famineT: number;          // last tick a famine was felt
  crime?: number;           // thefts / fights recently (police respond)
  coastal: boolean;         // could host a dock (false once a search failed)
  wanted: number[];         // criminals the guards are after
  captureT: number;
  blessT: number;
  lastAttacked: number;
  industry?: number;        // factory output banked toward the next machine
  needStone?: boolean;      // a wanted building is waiting on stone
  saveFor?: number;         // building kind the town is saving materials for
  saveT?: number;
}

export interface Banner { symbol: number; pattern: number; c1: number; c2: number; }

export interface Kingdom {
  id: number;
  name: string;
  race: Sp;
  color: number;            // index into KINGDOM_COLORS
  banner: Banner;
  capital: number;
  king: number;
  villages: number[];
  opinion: Record<number, number>;
  wars: number[];
  allies: number[];
  warStart: Record<number, number>;
  peaceT: Record<number, number>; // tick of last peace with
  founded: number;
  alive: boolean;
  target: number;           // current war target village
  kills: number; deaths: number;
  aggression: number;
  rebelOf: number;
  lastKing: number;         // for succession by heirs
  era: number;              // Era
  tech: number;             // accumulated knowledge
  tradeBoost?: number;      // knowledge multiplier from recent trade
  trade?: Record<number, number>; // recent caravans with each kingdom (decays)
}

export interface HistoryEntry {
  tick: number;
  type: string;
  a?: number; b?: number;   // kingdom ids
  u?: number;               // unit id
  v?: number;               // village id
  x?: number; z?: number;
  text: string;             // short label (names)
}
