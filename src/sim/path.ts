import { World } from './world';

const MAX_STEP = 1.6; // max height difference between neighbouring tiles that can be walked

/** Reusable A* over the tile grid (8-connected, no corner cutting). */
export class PathFinder {
  private g: Float32Array;
  private from: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heapK: Float32Array;
  private heapV: Int32Array;
  private hs = 0;
  budget = 0; // node expansions left this tick
  blockBuildings = true;

  constructor(private w: World) {
    const N = w.N;
    this.g = new Float32Array(N);
    this.from = new Int32Array(N);
    this.stamp = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.heapK = new Float32Array(N * 2);
    this.heapV = new Int32Array(N * 2);
  }

  passable(t: number, goal: number): boolean {
    const w = this.w;
    if (!w.walkable(t)) return false;
    if (this.blockBuildings && w.bld[t] >= 0 && t !== goal) return w.bldPassable(t);
    return true;
  }

  stepOk(a: number, b: number) { return Math.abs(this.w.height[a] - this.w.height[b]) <= MAX_STEP; }

  /** Straight-line walkability test (cheap shortcut for open terrain). */
  lineClear(x0: number, z0: number, x1: number, z1: number, goal: number): boolean {
    const w = this.w;
    const dx = x1 - x0, dz = z1 - z0;
    const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 2);
    let prev = w.tileAt(x0, z0);
    for (let i = 1; i <= n; i++) {
      const t = w.tileAt(x0 + (dx * i) / n, z0 + (dz * i) / n);
      if (t === prev) continue;
      if (!this.passable(t, goal) || !this.stepOk(prev, t)) return false;
      prev = t;
    }
    return true;
  }

  private push(k: number, v: number) {
    let i = this.hs++;
    const K = this.heapK, V = this.heapV;
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = k; V[i] = v;
  }
  private pop(): number {
    const K = this.heapK, V = this.heapV;
    const top = V[0]; const k = K[--this.hs]; const v = V[this.hs];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1; if (c >= this.hs) break;
      if (c + 1 < this.hs && K[c + 1] < K[c]) c++;
      if (K[c] >= k) break;
      K[i] = K[c]; V[i] = V[c]; i = c;
    }
    K[i] = k; V[i] = v;
    return top;
  }

  /**
   * Find a path from world coords to the goal tile. Returns tile list (excluding start) or null.
   * `near` lets the search succeed when it reaches within that many tiles of the goal.
   */
  find(sx: number, sz: number, goal: number, maxNodes = 6000, near = 0): Int32Array | null {
    const w = this.w;
    const start = w.tileAt(sx, sz);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return new Int32Array([goal]);
    if (w.islandsDirty) w.computeIslands();
    const gx = goal % w.W, gz = (goal / w.W) | 0;
    const si = w.island[start], gi = w.island[goal];
    if (near === 0 && si >= 0 && gi >= 0 && si !== gi) return null;
    if (near === 0 && gi < 0 && !(this.blockBuildings && w.bld[goal] >= 0)) return null;
    if (this.lineClear(sx, sz, gx + 0.5, gz + 0.5, goal)) return new Int32Array([goal]);
    const gen = ++this.gen;
    const W = w.W, H = w.H;
    this.hs = 0;
    const heur = (t: number) => { const x = t % W, z = (t / W) | 0; const dx = Math.abs(x - gx), dz = Math.abs(z - gz); return (dx + dz + (1.414 - 2) * Math.min(dx, dz)) * 1.15; };
    this.g[start] = 0; this.stamp[start] = gen; this.from[start] = -1;
    this.push(heur(start), start);
    let expanded = 0, best = start, bestH = heur(start);
    while (this.hs > 0) {
      const t = this.pop();
      if (this.closed[t] === gen) continue;
      this.closed[t] = gen;
      const h = heur(t);
      if (h < bestH) { bestH = h; best = t; }
      if (t === goal || (near > 0 && h <= near)) return this.build(t);
      if (++expanded > maxNodes) break;
      const x = t % W, z = (t / W) | 0;
      const gt = this.g[t];
      for (let k = 0; k < 8; k++) {
        const dx = k < 4 ? (k === 0 ? 1 : k === 1 ? -1 : 0) : (k === 4 || k === 5 ? 1 : -1);
        const dz = k < 4 ? (k === 2 ? 1 : k === 3 ? -1 : 0) : (k === 4 || k === 6 ? 1 : -1);
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const n = nz * W + nx;
        if (this.closed[n] === gen) continue;
        if (!this.passable(n, goal) || !this.stepOk(t, n)) continue;
        if (dx !== 0 && dz !== 0) {
          if (!this.passable(t + dx, goal) || !this.passable(t + dz * W, goal)) continue;
        }
        const step = (dx !== 0 && dz !== 0 ? 1.414 : 1) * w.walkCost(n) + Math.abs(w.height[n] - w.height[t]) * 0.6;
        const ng = gt + step;
        if (this.stamp[n] !== gen || ng < this.g[n]) {
          this.stamp[n] = gen; this.g[n] = ng; this.from[n] = t;
          this.push(ng + heur(n), n);
        }
      }
    }
    this.budget -= expanded;
    // partial path toward the best node reached (lets units make progress on long trips)
    if (best !== start && bestH < heur(start) * 0.7) return this.build(best);
    return null;
  }

  private build(end: number): Int32Array {
    const out: number[] = [];
    let t = end;
    while (t >= 0 && this.from[t] !== -1) { out.push(t); t = this.from[t]; if (out.length > 4000) break; }
    out.reverse();
    // string-pull: drop intermediate waypoints that have clear line of sight
    const w = this.w;
    const res: number[] = [];
    let i = 0;
    let cx = (this.startOf(out, t) % w.W) + 0.5, cz = ((this.startOf(out, t) / w.W) | 0) + 0.5;
    while (i < out.length) {
      let j = Math.min(out.length - 1, i + 12);
      for (; j > i; j--) {
        const tj = out[j];
        if (this.lineClear(cx, cz, (tj % w.W) + 0.5, ((tj / w.W) | 0) + 0.5, end)) break;
      }
      res.push(out[j]);
      cx = (out[j] % w.W) + 0.5; cz = ((out[j] / w.W) | 0) + 0.5;
      i = j + 1;
    }
    return new Int32Array(res);
  }
  private startOf(_out: number[], t: number) { return t; }
}
