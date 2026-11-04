import { Rng } from '../core/rng';
import { Sp } from './defs';

const SYL: Record<number, { a: string[]; b: string[]; c: string[] }> = {
  [Sp.Human]: { a: ['Al', 'Bran', 'Ced', 'Dar', 'Ed', 'Fen', 'Gar', 'Hal', 'Isa', 'Jor', 'Kel', 'Lia', 'Mar', 'Nor', 'Os', 'Per', 'Ros', 'Sel', 'Tam', 'Ul', 'Vic', 'Wil'], b: ['a', 'e', 'i', 'o', 'an', 'el', 'or', 'en', 'ri', ''], c: ['d', 'n', 'ric', 'win', 'ton', 'la', 'ra', 'mund', 'beth', 'ley', 'ny', 'son'] },
  [Sp.Elf]: { a: ['Ae', 'Ela', 'Fae', 'Gal', 'Ith', 'Lae', 'Mir', 'Nim', 'Syl', 'Tha', 'Ul', 'Ves', 'Lir', 'Ara', 'Cae'], b: ['la', 'ri', 'the', 'na', 'li', 'en', 'ae', 'wy', 'ra'], c: ['nor', 'riel', 'dil', 'wen', 'thas', 'lon', 'sse', 'nis', 'ath', 'iel'] },
  [Sp.Dwarf]: { a: ['Bal', 'Bor', 'Dur', 'Gim', 'Thor', 'Kaz', 'Mor', 'Brom', 'Grun', 'Dwal', 'Fun', 'Hro', 'Orn', 'Thra'], b: ['in', 'a', 'o', 'u', 'ga', 'ri', ''], c: ['din', 'grim', 'dok', 'rak', 'li', 'nar', 'bek', 'gar', 'mund', 'dun'] },
  [Sp.Orc]: { a: ['Gro', 'Urg', 'Mog', 'Zug', 'Thra', 'Kru', 'Snag', 'Gor', 'Bru', 'Dur', 'Rok', 'Vak', 'Az'], b: ['a', 'u', 'o', 'ug', 'ra', ''], c: ['k', 'gash', 'th', 'zag', 'nak', 'gul', 'rak', 'mog', 'bash', 'dush'] },
};

const KINGDOM_SUFFIX: Record<number, string[]> = {
  [Sp.Human]: ['ia', 'land', 'mark', 'shire', 'dor', 'heim', 'ora'],
  [Sp.Elf]: ['wyn', 'lon', 'thil', 'driel', 'lindë', 'rien', 'aeth'],
  [Sp.Dwarf]: ['heim', 'grund', 'hold', 'dur', 'mor', 'karak', 'deep'],
  [Sp.Orc]: ['gash', 'mok', 'grak', 'ruk', 'zug', 'thrak', 'gor'],
};
const VILLAGE_SUFFIX: Record<number, string[]> = {
  [Sp.Human]: ['ford', 'ton', 'brook', 'vale', 'wick', 'bury', 'stead', 'haven', 'moor'],
  [Sp.Elf]: ['glade', 'ost', 'mere', 'thal', 'loth', 'ndel', 'sil'],
  [Sp.Dwarf]: ['forge', 'delve', 'hall', 'gate', 'pit', 'stone', 'helm'],
  [Sp.Orc]: ['pit', 'skull', 'camp', 'gut', 'maw', 'crag', 'hut'],
};

export function unitName(rng: Rng, sp: Sp): string {
  const s = SYL[sp] ?? SYL[Sp.Human];
  return rng.pick(s.a) + rng.pick(s.b) + rng.pick(s.c);
}
export function kingdomName(rng: Rng, sp: Sp): string {
  const s = SYL[sp] ?? SYL[Sp.Human];
  const base = rng.pick(s.a) + (rng.chance(0.5) ? rng.pick(s.b) : '');
  return base + rng.pick(KINGDOM_SUFFIX[sp] ?? KINGDOM_SUFFIX[Sp.Human]);
}
export function villageName(rng: Rng, sp: Sp): string {
  const s = SYL[sp] ?? SYL[Sp.Human];
  return rng.pick(s.a) + rng.pick(VILLAGE_SUFFIX[sp] ?? VILLAGE_SUFFIX[Sp.Human]);
}
