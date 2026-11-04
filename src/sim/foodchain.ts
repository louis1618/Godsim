import { Sp, SPECIES } from './defs';

/**
 * The food chain as data. The AI hunts and flees from it, and the manual draws its pyramid from it,
 * so what players read is exactly what the creatures do.
 */
export const PLANTS = -1; // grass, berries, crops

/** Who eats whom. PLANTS means grazing / foraging. */
export const EATS: Partial<Record<Sp, number[]>> = {
  [Sp.Rabbit]: [PLANTS],
  [Sp.Chicken]: [PLANTS],
  [Sp.Sheep]: [PLANTS],
  [Sp.Deer]: [PLANTS],
  [Sp.Fish]: [PLANTS],
  [Sp.Boar]: [PLANTS, Sp.Rabbit],
  [Sp.Fox]: [Sp.Rabbit, Sp.Chicken, Sp.Fish],
  [Sp.Human]: [PLANTS, Sp.Rabbit, Sp.Chicken, Sp.Sheep, Sp.Deer, Sp.Boar, Sp.Fish],
  [Sp.Elf]: [PLANTS, Sp.Fish],
  [Sp.Dwarf]: [PLANTS, Sp.Rabbit, Sp.Sheep, Sp.Boar, Sp.Fish],
  [Sp.Orc]: [Sp.Rabbit, Sp.Chicken, Sp.Sheep, Sp.Deer, Sp.Boar, Sp.Fish, PLANTS],
  [Sp.Wolf]: [Sp.Rabbit, Sp.Sheep, Sp.Deer, Sp.Chicken, Sp.Boar, Sp.Fox],
  [Sp.Bear]: [PLANTS, Sp.Fish, Sp.Deer, Sp.Sheep, Sp.Boar, Sp.Rabbit],
  [Sp.Crocodile]: [Sp.Fish, Sp.Deer, Sp.Sheep, Sp.Boar, Sp.Human, Sp.Elf, Sp.Dwarf, Sp.Orc],
  [Sp.Dragon]: [Sp.Bear, Sp.Crocodile, Sp.Wolf, Sp.Deer, Sp.Sheep, Sp.Boar, Sp.Human, Sp.Elf, Sp.Dwarf, Sp.Orc],
};

/** Prey a starving predator will also try (desperation widens the menu). */
export const DESPERATE: Partial<Record<Sp, number[]>> = {
  [Sp.Wolf]: [Sp.Human, Sp.Elf, Sp.Dwarf, Sp.Orc],
  [Sp.Bear]: [Sp.Human, Sp.Elf, Sp.Dwarf, Sp.Orc, Sp.Wolf],
  [Sp.Fox]: [Sp.Sheep],
};

export function eats(pred: Sp, prey: Sp, starving = false): boolean {
  const list = EATS[pred];
  if (list?.includes(prey)) return true;
  return starving && !!DESPERATE[pred]?.includes(prey);
}
export const grazes = (sp: Sp) => !!EATS[sp]?.includes(PLANTS);
export const hunts = (sp: Sp) => !!EATS[sp]?.some((x) => x !== PLANTS);

/** Trophic level: 0 plants, 1 grazers, 2 small hunters & omnivores, 3 big predators & peoples, 4 apex. */
export function trophic(sp: Sp): number {
  const list = EATS[sp];
  if (!list) return SPECIES[sp].undead ? 4 : 1;
  const prey = list.filter((x) => x !== PLANTS) as Sp[];
  if (!prey.length) return 1;
  return 1 + Math.max(...prey.map((p) => (p === sp ? 0 : trophicOf(p, 0))));
}
function trophicOf(sp: Sp, depth: number): number {
  if (depth > 6) return 1;
  const list = EATS[sp];
  if (!list) return 1;
  const prey = list.filter((x) => x !== PLANTS) as Sp[];
  if (!prey.length) return 1;
  return 1 + Math.max(...prey.map((p) => (p === sp ? 0 : trophicOf(p, depth + 1))));
}

/** Species that appear in the pyramid, grouped by level (bottom first). */
export function pyramid(): Sp[][] {
  const levels: Sp[][] = [[], [], [], [], [], []];
  for (const k of Object.keys(EATS)) { const sp = Number(k) as Sp; levels[Math.min(5, trophic(sp))].push(sp); }
  return levels.filter((l) => l.length);
}
