import type { PowerCat } from '../sim/powers';

export type Screen = 'boot' | 'title' | 'create' | 'play';
export interface Selection { kind: 'unit' | 'village' | 'kingdom'; id: number; }
export interface WorldOpts { size: number; wide?: boolean; shape: 'continents' | 'pangaea' | 'archipelago' | 'highlands'; life: 0 | 1 | 2; seed: number; }

export interface UIState {
  screen: Screen;
  bootProgress: number;
  cat: PowerCat;
  power: string;
  brush: number;
  sel: Selection | null;
  panel: string | null;
  pairFirst: number;
  icons: Record<string, string>;
  opts: WorldOpts;
  menu: boolean;
  hover: { id: string; x: number; y: number } | null;
  tick: number; // bumps to force refresh
  toast: { icon: string; text: string; t: number } | null;
  confirm: { icon: string; title: string; actions: { label: string; primary?: boolean; fn: () => void | Promise<void> }[] } | null;
  continueMeta: import('../sim/save').SlotMeta | null;
  lastAutosave: number;
  firstVisit: boolean;
}

type L = () => void;
function firstVisit(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.has('noauto') || q.has('notut')) return false;
  try { return !localStorage.getItem('gs-seen-manual'); } catch { return false; }
}
class Store {
  s: UIState = {
    screen: 'boot', bootProgress: 0, cat: 'world', power: 'inspect', brush: 3, sel: null, panel: null, pairFirst: -1, icons: {},
    opts: { size: 192, shape: 'continents', life: 1, seed: Math.floor(Math.random() * 99999) }, menu: false, hover: null, tick: 0, toast: null, confirm: null, continueMeta: null, lastAutosave: 0, firstVisit: firstVisit(),
  };
  private ls = new Set<L>();
  set(p: Partial<UIState>) { this.s = { ...this.s, ...p }; for (const l of this.ls) l(); }
  sub(l: L) { this.ls.add(l); return () => { this.ls.delete(l); }; }
}
export const store = new Store();
