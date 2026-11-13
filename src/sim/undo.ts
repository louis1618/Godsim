import { Sim } from './sim';
import { World } from './world';

/**
 * Undo / redo for hand edits of the land (sculpting, biome and forest painting, lakes).
 * A stroke records the 16x16 chunks it is about to touch, once each, before they change; undoing
 * swaps those chunks back (keeping what was there for redo). It restores the land itself: heights,
 * water, ground material, plants and grass. What the edit did to creatures and buildings stays done.
 */
const CS = 16;
interface Snap { h: Float32Array; wt: Float32Array; mat: Uint8Array; feat: Uint8Array; amt: Uint8Array; grass: Uint8Array; }
interface Stroke { W: number; H: number; chunks: Map<number, Snap>; }
const BYTES_PER_CHUNK = CS * CS * 12;

export class TerrainHistory {
  private undos: Stroke[] = [];
  private redos: Stroke[] = [];
  private cur: Stroke | null = null;
  /** memory kept for undo (bytes); the oldest strokes are dropped beyond this */
  static BUDGET = 48e6;

  get canUndo() { return this.undos.length > 0; }
  get canRedo() { return this.redos.length > 0; }
  get depth() { return this.undos.length; }
  clear() { this.undos = []; this.redos = []; this.cur = null; }

  /** A stroke starts (pointer down with an editing tool). */
  begin(w: World) { this.cur = { W: w.W, H: w.H, chunks: new Map() }; }

  /** Tiles x0..x1, z0..z1 are about to change: keep their chunks (first touch per stroke only). */
  touch(w: World, x0: number, z0: number, x1: number, z1: number) {
    const c = this.cur;
    if (!c || c.W !== w.W || c.H !== w.H) return;
    const cw = Math.ceil(w.W / CS);
    const cx0 = Math.max(0, x0 >> 4), cz0 = Math.max(0, z0 >> 4), cx1 = Math.min(cw - 1, x1 >> 4), cz1 = Math.min(Math.ceil(w.H / CS) - 1, z1 >> 4);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const id = cz * cw + cx;
      if (!c.chunks.has(id)) c.chunks.set(id, grab(w, cx, cz));
    }
  }

  /** The stroke is over; it joins the history if it touched anything. */
  end() {
    const c = this.cur;
    this.cur = null;
    if (!c || c.chunks.size === 0) return;
    this.undos.push(c);
    this.redos = [];
    let bytes = 0;
    for (const s of this.undos) bytes += s.chunks.size * BYTES_PER_CHUNK;
    while (bytes > TerrainHistory.BUDGET && this.undos.length > 1) bytes -= this.undos.shift()!.chunks.size * BYTES_PER_CHUNK;
  }

  undo(sim: Sim): boolean { return this.swap(sim, this.undos, this.redos); }
  redo(sim: Sim): boolean { return this.swap(sim, this.redos, this.undos); }

  private swap(sim: Sim, from: Stroke[], to: Stroke[]): boolean {
    const w = sim.world;
    const s = from.pop();
    if (!s) return false;
    if (s.W !== w.W || s.H !== w.H) { this.clear(); return false; } // the world has been resized since
    const cw = Math.ceil(w.W / CS);
    const other: Stroke = { W: s.W, H: s.H, chunks: new Map() };
    let x0 = 1e9, z0 = 1e9, x1 = -1, z1 = -1;
    for (const [id, snap] of s.chunks) {
      const cx = id % cw, cz = (id / cw) | 0;
      other.chunks.set(id, grab(w, cx, cz));
      put(w, cx, cz, snap);
      x0 = Math.min(x0, cx * CS); z0 = Math.min(z0, cz * CS); x1 = Math.max(x1, cx * CS + CS - 1); z1 = Math.max(z1, cz * CS + CS - 1);
    }
    to.push(other);
    w.markTerrain(x0 - 2, z0 - 2, x1 + 2, z1 + 2);
    return true;
  }
}

function grab(w: World, cx: number, cz: number): Snap {
  const n = CS * CS;
  const s: Snap = { h: new Float32Array(n), wt: new Float32Array(n), mat: new Uint8Array(n), feat: new Uint8Array(n), amt: new Uint8Array(n), grass: new Uint8Array(n) };
  for (let dz = 0; dz < CS; dz++) for (let dx = 0; dx < CS; dx++) {
    const x = cx * CS + dx, z = cz * CS + dz;
    if (x >= w.W || z >= w.H) continue;
    const t = z * w.W + x, i = dz * CS + dx;
    s.h[i] = w.height[t]; s.wt[i] = w.water[t]; s.mat[i] = w.mat[t]; s.feat[i] = w.feat[t]; s.amt[i] = w.featAmt[t]; s.grass[i] = w.grass[t];
  }
  return s;
}

function put(w: World, cx: number, cz: number, s: Snap) {
  for (let dz = 0; dz < CS; dz++) for (let dx = 0; dx < CS; dx++) {
    const x = cx * CS + dx, z = cz * CS + dz;
    if (x >= w.W || z >= w.H) continue;
    const t = z * w.W + x, i = dz * CS + dx;
    w.height[t] = s.h[i]; w.water[t] = s.wt[i]; w.mat[t] = s.mat[i]; w.grass[t] = s.grass[i];
    // plants go back too, except under a building that has since been put there
    if (w.bld[t] < 0) w.setFeat(t, s.feat[i], s.amt[i]);
  }
}
