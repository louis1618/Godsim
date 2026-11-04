/** Static game data: materials, features, species, buildings. Pure data, engine agnostic. */

export const TICKS_PER_SEC = 10;
export const TICK_DT = 1 / TICKS_PER_SEC;
export const YEAR_TICKS = 480;
export const SEASON_TICKS = YEAR_TICKS / 4;

export const enum Mat {
  Sand = 0, Grass = 1, Lush = 2, Savanna = 3, Desert = 4, Snow = 5, Rock = 6, Soil = 7, Ash = 8, Swamp = 9, Lava = 10, Farmland = 11,
}
export const MAT_COUNT = 12;

export const enum Feat {
  None = 0, Oak = 1, Pine = 2, Birch = 3, Palm = 4, Cactus = 5, SnowPine = 6, Acacia = 7, Dead = 8, Berry = 9, Boulder = 10, Ore = 11, Crop = 12, Flower = 13,
}
export const FEAT_COUNT = 14;
export const isTree = (f: number) => (f >= 1 && f <= 8);
export const isWoodTree = (f: number) => (f >= 1 && f <= 7 && f !== 5);

export interface MatDef { key: string; walkCost: number; fertile: number; flammable: number; }
export const MATS: MatDef[] = [
  { key: 'sand', walkCost: 1.2, fertile: 0.15, flammable: 0 },
  { key: 'grass', walkCost: 1, fertile: 1, flammable: 0.5 },
  { key: 'lush', walkCost: 1.05, fertile: 1.2, flammable: 0.6 },
  { key: 'savanna', walkCost: 1, fertile: 0.6, flammable: 1 },
  { key: 'desert', walkCost: 1.3, fertile: 0.05, flammable: 0 },
  { key: 'snow', walkCost: 1.5, fertile: 0.1, flammable: 0 },
  { key: 'rock', walkCost: 1.8, fertile: 0, flammable: 0 },
  { key: 'soil', walkCost: 1, fertile: 0.8, flammable: 0 },
  { key: 'ash', walkCost: 1.1, fertile: 0.9, flammable: 0 },
  { key: 'swamp', walkCost: 2, fertile: 0.7, flammable: 0.1 },
  { key: 'lava', walkCost: 50, fertile: 0, flammable: 0 },
  { key: 'farmland', walkCost: 1.1, fertile: 1.4, flammable: 0.3 },
];

export const enum Sp {
  Human = 0, Elf = 1, Dwarf = 2, Orc = 3, Sheep = 4, Wolf = 5, Deer = 6, Bear = 7, Skeleton = 8, Chicken = 9, Troll = 10,
  Boat = 11, Tank = 12, Plane = 13,
  Rabbit = 14, Fox = 15, Boar = 16, Crocodile = 17, Fish = 18, Dragon = 19,
}
export const SPECIES_COUNT = 20;
/** Machines: no hunger, no mood, no ageing; they belong to a kingdom. */
export const isVehicle = (sp: number) => sp >= 11 && sp <= 13;
export type Race = Sp.Human | Sp.Elf | Sp.Dwarf | Sp.Orc;
export const RACES: Race[] = [Sp.Human, Sp.Elf, Sp.Dwarf, Sp.Orc];

export interface SpeciesDef {
  key: string;
  civ: boolean;
  speed: number;        // tiles per second
  hp: number;
  dmg: number;
  attackRate: number;   // seconds between attacks
  range: number;        // melee reach in tiles
  lifespan: [number, number];
  adultAge: number;
  size: number;         // render & collision scale
  diet: 'plant' | 'meat' | 'omni';
  aggressive: boolean;  // attacks other species on sight
  breedEvery: number;   // years between births (animals); civ uses housing
  litter: number;
  biomes: number[];     // preferred mats for spawning/wandering
  fertility: number;    // civ birth chance multiplier
  buildSpeed: number;
  favoredFeat?: number; // wood source preference
  undead?: boolean;
}

export const SPECIES: SpeciesDef[] = [
  { key: 'human', civ: true, speed: 1.55, hp: 100, dmg: 12, attackRate: 1.0, range: 0.9, lifespan: [50, 70], adultAge: 6, size: 1, diet: 'omni', aggressive: false, breedEvery: 0, litter: 1, biomes: [Mat.Grass, Mat.Lush, Mat.Savanna], fertility: 1.15, buildSpeed: 1 },
  { key: 'elf', civ: true, speed: 1.7, hp: 85, dmg: 11, attackRate: 0.9, range: 0.9, lifespan: [100, 140], adultAge: 8, size: 1.05, diet: 'plant', aggressive: false, breedEvery: 0, litter: 1, biomes: [Mat.Lush, Mat.Grass], fertility: 0.75, buildSpeed: 0.9 },
  { key: 'dwarf', civ: true, speed: 1.3, hp: 130, dmg: 14, attackRate: 1.1, range: 0.85, lifespan: [70, 100], adultAge: 7, size: 0.85, diet: 'omni', aggressive: false, breedEvery: 0, litter: 1, biomes: [Mat.Rock, Mat.Grass, Mat.Snow], fertility: 0.85, buildSpeed: 1.35 },
  { key: 'orc', civ: true, speed: 1.5, hp: 140, dmg: 16, attackRate: 1.15, range: 0.95, lifespan: [38, 50], adultAge: 5, size: 1.12, diet: 'meat', aggressive: false, breedEvery: 0, litter: 1, biomes: [Mat.Savanna, Mat.Desert, Mat.Grass], fertility: 1.35, buildSpeed: 0.95 },
  { key: 'sheep', civ: false, speed: 1.0, hp: 40, dmg: 2, attackRate: 1.5, range: 0.7, lifespan: [12, 18], adultAge: 2, size: 0.8, diet: 'plant', aggressive: false, breedEvery: 1.6, litter: 1, biomes: [Mat.Grass, Mat.Lush, Mat.Savanna], fertility: 1, buildSpeed: 0 },
  { key: 'wolf', civ: false, speed: 2.1, hp: 60, dmg: 10, attackRate: 0.9, range: 0.8, lifespan: [10, 15], adultAge: 2, size: 0.85, diet: 'meat', aggressive: true, breedEvery: 2.2, litter: 2, biomes: [Mat.Lush, Mat.Grass, Mat.Snow], fertility: 1, buildSpeed: 0 },
  { key: 'deer', civ: false, speed: 2.0, hp: 45, dmg: 3, attackRate: 1.5, range: 0.7, lifespan: [12, 18], adultAge: 2, size: 0.95, diet: 'plant', aggressive: false, breedEvery: 2.0, litter: 1, biomes: [Mat.Lush, Mat.Grass], fertility: 1, buildSpeed: 0 },
  { key: 'bear', civ: false, speed: 1.5, hp: 220, dmg: 22, attackRate: 1.3, range: 1.0, lifespan: [20, 30], adultAge: 4, size: 1.35, diet: 'omni', aggressive: true, breedEvery: 3.5, litter: 1, biomes: [Mat.Lush, Mat.Snow], fertility: 1, buildSpeed: 0 },
  { key: 'skeleton', civ: false, speed: 1.35, hp: 70, dmg: 12, attackRate: 1.0, range: 0.9, lifespan: [9999, 9999], adultAge: 0, size: 1.0, diet: 'meat', aggressive: true, breedEvery: 0, litter: 0, biomes: [Mat.Ash, Mat.Desert], fertility: 0, buildSpeed: 0, undead: true },
  { key: 'chicken', civ: false, speed: 1.1, hp: 15, dmg: 1, attackRate: 2, range: 0.5, lifespan: [6, 9], adultAge: 1, size: 0.55, diet: 'plant', aggressive: false, breedEvery: 1.0, litter: 2, biomes: [Mat.Grass, Mat.Savanna], fertility: 1, buildSpeed: 0 },
  { key: 'troll', civ: false, speed: 1.2, hp: 520, dmg: 34, attackRate: 1.6, range: 1.3, lifespan: [9999, 9999], adultAge: 0, size: 1.9, diet: 'meat', aggressive: true, breedEvery: 0, litter: 0, biomes: [Mat.Rock, Mat.Lush], fertility: 0, buildSpeed: 0, undead: true },
  { key: 'boat', civ: false, speed: 1.6, hp: 220, dmg: 30, attackRate: 2.5, range: 6, lifespan: [9999, 9999], adultAge: 0, size: 1, diet: 'plant', aggressive: false, breedEvery: 0, litter: 0, biomes: [], fertility: 0, buildSpeed: 0 },
  { key: 'tank', civ: false, speed: 1.5, hp: 700, dmg: 55, attackRate: 2.2, range: 8, lifespan: [9999, 9999], adultAge: 0, size: 1, diet: 'plant', aggressive: false, breedEvery: 0, litter: 0, biomes: [], fertility: 0, buildSpeed: 0 },
  { key: 'plane', civ: false, speed: 4.5, hp: 200, dmg: 70, attackRate: 0.6, range: 1, lifespan: [9999, 9999], adultAge: 0, size: 1, diet: 'plant', aggressive: false, breedEvery: 0, litter: 0, biomes: [], fertility: 0, buildSpeed: 0 },
  { key: 'rabbit', civ: false, speed: 1.7, hp: 12, dmg: 1, attackRate: 2, range: 0.5, lifespan: [5, 8], adultAge: 0.6, size: 0.45, diet: 'plant', aggressive: false, breedEvery: 0.7, litter: 2, biomes: [Mat.Grass, Mat.Lush, Mat.Savanna], fertility: 1, buildSpeed: 0 },
  { key: 'fox', civ: false, speed: 2.25, hp: 34, dmg: 7, attackRate: 0.9, range: 0.6, lifespan: [8, 12], adultAge: 1.2, size: 0.62, diet: 'meat', aggressive: false, breedEvery: 1.4, litter: 2, biomes: [Mat.Lush, Mat.Grass, Mat.Snow], fertility: 1, buildSpeed: 0 },
  { key: 'boar', civ: false, speed: 1.6, hp: 85, dmg: 11, attackRate: 1.1, range: 0.75, lifespan: [12, 18], adultAge: 1.5, size: 0.85, diet: 'omni', aggressive: false, breedEvery: 1.8, litter: 2, biomes: [Mat.Lush, Mat.Grass, Mat.Swamp], fertility: 1, buildSpeed: 0 },
  { key: 'crocodile', civ: false, speed: 1.25, hp: 170, dmg: 24, attackRate: 1.4, range: 0.95, lifespan: [40, 60], adultAge: 4, size: 1.2, diet: 'meat', aggressive: true, breedEvery: 4, litter: 2, biomes: [Mat.Swamp, Mat.Sand], fertility: 1, buildSpeed: 0 },
  { key: 'fish', civ: false, speed: 1.3, hp: 8, dmg: 0, attackRate: 3, range: 0.3, lifespan: [4, 7], adultAge: 0.5, size: 0.42, diet: 'plant', aggressive: false, breedEvery: 0.6, litter: 3, biomes: [], fertility: 1, buildSpeed: 0 },
  { key: 'dragon', civ: false, speed: 2.6, hp: 1100, dmg: 48, attackRate: 1.8, range: 1.6, lifespan: [9999, 9999], adultAge: 0, size: 2.2, diet: 'meat', aggressive: true, breedEvery: 0, litter: 0, biomes: [Mat.Rock, Mat.Snow], fertility: 0, buildSpeed: 0 },
];
export const isCiv = (sp: number) => sp <= Sp.Orc;

export const enum Bk {
  TownHall = 0, House = 1, Farm = 2, Storage = 3, Tower = 4, Temple = 5, Windmill = 6, Ruin = 7,
  Library = 8, Market = 9, Prison = 10, Dock = 11, Cannon = 12, Factory = 13, Apartment = 14,
}
export const BUILDING_KINDS = 15;

/** Ages of civilisation. Knowledge (tech) accumulates per kingdom; an era also needs a big enough town. */
export const enum Era { Tribal = 0, Medieval = 1, Gunpowder = 2, Industrial = 3, Modern = 4 }
export const ERA_TECH = [0, 30, 110, 280, 600];
export const ERA_MIN_LEVEL = [0, 1, 2, 2, 3];

export interface BuildingDef {
  key: string;
  size: number;       // square footprint in tiles
  hp: number;
  cost: { wood: number; stone: number; gold: number };
  work: number;       // builder-seconds
  housing: number;
  minPop: number;     // village population required
  era?: number;       // minimum era
}
export const BUILDINGS: BuildingDef[] = [
  { key: 'townhall', size: 3, hp: 900, cost: { wood: 10, stone: 0, gold: 0 }, work: 14, housing: 4, minPop: 0 },
  { key: 'house', size: 2, hp: 260, cost: { wood: 8, stone: 0, gold: 0 }, work: 9, housing: 4, minPop: 0 },
  { key: 'farm', size: 3, hp: 80, cost: { wood: 3, stone: 0, gold: 0 }, work: 5, housing: 0, minPop: 4 },
  { key: 'storage', size: 2, hp: 300, cost: { wood: 12, stone: 4, gold: 0 }, work: 10, housing: 0, minPop: 9 },
  { key: 'tower', size: 1, hp: 450, cost: { wood: 8, stone: 14, gold: 0 }, work: 14, housing: 0, minPop: 14 },
  { key: 'temple', size: 3, hp: 600, cost: { wood: 15, stone: 25, gold: 3 }, work: 26, housing: 0, minPop: 22 },
  { key: 'windmill', size: 2, hp: 280, cost: { wood: 18, stone: 6, gold: 0 }, work: 14, housing: 0, minPop: 16 },
  { key: 'ruin', size: 2, hp: 1, cost: { wood: 0, stone: 0, gold: 0 }, work: 0, housing: 0, minPop: 0 },
  { key: 'library', size: 2, hp: 300, cost: { wood: 20, stone: 15, gold: 2 }, work: 16, housing: 0, minPop: 14, era: 1 },
  { key: 'market', size: 2, hp: 240, cost: { wood: 18, stone: 6, gold: 0 }, work: 12, housing: 0, minPop: 12, era: 1 },
  { key: 'prison', size: 2, hp: 700, cost: { wood: 10, stone: 30, gold: 0 }, work: 18, housing: 0, minPop: 18, era: 1 },
  { key: 'dock', size: 2, hp: 260, cost: { wood: 24, stone: 0, gold: 0 }, work: 12, housing: 0, minPop: 10, era: 1 },
  { key: 'cannon', size: 1, hp: 380, cost: { wood: 6, stone: 12, gold: 2 }, work: 10, housing: 0, minPop: 16, era: 2 },
  { key: 'factory', size: 3, hp: 900, cost: { wood: 30, stone: 30, gold: 5 }, work: 30, housing: 0, minPop: 24, era: 3 },
  { key: 'apartment', size: 2, hp: 700, cost: { wood: 16, stone: 26, gold: 2 }, work: 22, housing: 10, minPop: 20, era: 4 },
];

/** Unit traits (bit flags). */
export const enum Trait {
  Brave = 1 << 0, Strong = 1 << 1, Fast = 1 << 2, Wise = 1 << 3, Lucky = 1 << 4, Greedy = 1 << 5,
  Peaceful = 1 << 6, Bloodlust = 1 << 7, Fertile = 1 << 8, Weak = 1 << 9, Immortal = 1 << 10, Blessed = 1 << 11,
}
export const TRAIT_KEYS: [Trait, string][] = [
  [Trait.Brave, 'brave'], [Trait.Strong, 'strong'], [Trait.Fast, 'fast'], [Trait.Wise, 'wise'], [Trait.Lucky, 'lucky'],
  [Trait.Greedy, 'greedy'], [Trait.Peaceful, 'peaceful'], [Trait.Bloodlust, 'bloodlust'], [Trait.Fertile, 'fertile'],
  [Trait.Weak, 'weak'], [Trait.Immortal, 'immortal'], [Trait.Blessed, 'blessed'],
];

/** Kingdom colours: [primary, dark] chosen to read on both terrain and in UI. */
export const KINGDOM_COLORS: [number, number][] = [
  [0xe2483d, 0x8c1f22], [0x3a7ae0, 0x1d3f86], [0xf2b632, 0x9a6512], [0x9a55d6, 0x522887],
  [0xf07c2a, 0x99410f], [0x1fb5c9, 0x0d6672], [0xff5fa8, 0x9a2a62], [0xb8203f, 0x6a0f22],
  [0x2a3d8f, 0x141f4d], [0x6a3ab8, 0x351a63], [0x74c7ff, 0x2f6f9e], [0x2f2a3a, 0x121016],
];
