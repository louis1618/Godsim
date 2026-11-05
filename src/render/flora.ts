import * as THREE from 'three';
import { World, CHUNK, heightCubic } from '../sim/world';
import { FEAT_COUNT, Feat, isTree } from '../sim/defs';
import { hash2 } from '../core/rng';
import { featureOffset } from '../sim/nav';
import { buildFeatureModels } from './models/nature';
import { patchInstanced, makeInstancedDepthMaterial } from './shared';

interface Pool {
  feat: number; variant: number;
  hi: THREE.InstancedMesh; lo: THREE.InstancedMesh;
  cap: number;
}

interface ChunkCache {
  // per pool index: packed matrices + colours
  mats: Float32Array[]; cols: Float32Array[]; counts: number[];
  thinMats: Float32Array[]; thinCols: Float32Array[]; thinCounts: number[];
  box: THREE.Box3;
}

const WIND: Record<number, number> = { [Feat.Oak]: 0.03, [Feat.Pine]: 0.02, [Feat.Birch]: 0.035, [Feat.Palm]: 0.03, [Feat.Acacia]: 0.02, [Feat.SnowPine]: 0.018, [Feat.Crop]: 0.25, [Feat.Flower]: 0.4, [Feat.Berry]: 0.04, [Feat.Dead]: 0.01 };

/**
 * All trees, bushes, rocks and crops. Per-chunk caches of instance transforms are gathered
 * into a handful of global instanced meshes each refresh, choosing hi/lo LOD per chunk and
 * skipping chunks outside the view. ~2 draw calls per model variant regardless of map size.
 */
export class FloraRenderer {
  readonly group = new THREE.Group();
  private pools: Pool[] = [];
  private poolIndex: number[][] = []; // [feat][variant] -> pool idx
  private chunks: ChunkCache[] = [];
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private lastKey = '';
  private dirty = true;
  /** sprout animations: chunk -> (tile -> start time) */
  private growth = new Map<number, Map<number, number>>();
  /** pools / chunks touched since the last upload (partial refresh) */
  private changedPools = new Set<number>();
  private changedChunks = new Set<number>();
  private hiChunks = new Set<number>();
  /** at most this many chunk rebuilds per frame (the rest wait a frame; fast-forward stays smooth) */
  static REBUILDS_PER_FRAME = 6;

  constructor(private world: World) {
    const models = buildFeatureModels();
    const matCache = new Map<number, THREE.MeshStandardMaterial>();
    const depthCache = new Map<number, THREE.Material>();
    for (let f = 0; f < FEAT_COUNT; f++) {
      const vs = models[f];
      this.poolIndex[f] = [];
      if (!vs) continue;
      const wind = WIND[f] ?? 0;
      let mat = matCache.get(wind);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
        patchInstanced(mat, { wind, seasonal: true });
        matCache.set(wind, mat);
        depthCache.set(wind, makeInstancedDepthMaterial({ wind }));
      }
      vs.forEach(([hiG, loG], v) => {
        const cap = 64;
        const hi = new THREE.InstancedMesh(hiG, mat!, cap);
        const lo = new THREE.InstancedMesh(loG, mat!, cap);
        for (const m of [hi, lo]) {
          m.count = 0; m.castShadow = f !== Feat.Flower && f !== Feat.Crop; m.receiveShadow = true;
          m.frustumCulled = false;
          m.customDepthMaterial = depthCache.get(wind)!;
          m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.group.add(m);
        }
        this.poolIndex[f][v] = this.pools.length;
        this.pools.push({ feat: f, variant: v, hi, lo, cap });
      });
    }
    for (let c = 0; c < world.CW * world.CH; c++) {
      this.chunks.push({ mats: [], cols: [], counts: [], thinMats: [], thinCols: [], thinCounts: [], box: new THREE.Box3() });
    }
  }

  private rebuildChunk(ci: number, time: number) {
    const w = this.world;
    const cx = ci % w.CW, cz = (ci / w.CW) | 0;
    const cache = this.chunks[ci];
    const lists: number[][] = this.pools.map(() => []);
    const colLists: number[][] = this.pools.map(() => []);
    // a thinned copy for the map view: from far away half the trees read the same as all of them
    const thin: number[][] = this.pools.map(() => []);
    const thinCol: number[][] = this.pools.map(() => []);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const grow = this.growth.get(ci);
    let minY = Infinity, maxY = -Infinity;
    for (let z = cz * CHUNK; z < Math.min(w.H, (cz + 1) * CHUNK); z++) {
      for (let x = cx * CHUNK; x < Math.min(w.W, (cx + 1) * CHUNK); x++) {
        const t = z * w.W + x;
        const f = w.feat[t];
        if (f === Feat.None) continue;
        const vars = this.poolIndex[f];
        if (!vars || vars.length === 0) continue;
        const r1 = hash2(x, z, 11), r2 = hash2(x, z, 23), r3 = hash2(x, z, 37);
        const pi = vars[Math.floor(r1 * vars.length) % vars.length];
        const [px, pz] = featureOffset(x, z, f);
        const py = heightCubic(w.height, w.W, w.H, px, pz) - 0.04;
        let sc = 0.85 + r1 * 0.35;
        const amt = w.featAmt[t];
        if (isTree(f)) sc *= 0.35 + 0.65 * Math.min(1, amt / 200);
        if (f === Feat.Crop) sc = 0.25 + 0.75 * Math.min(1, amt / 255);
        if (f === Feat.Boulder || f === Feat.Ore) sc *= 0.6 + 0.4 * Math.min(1, amt / 160);
        const born = grow?.get(t);
        let stretch = 1;
        if (born !== undefined) {
          // springy pop: overshoot, wobble, settle (squash & stretch on the way)
          const k = Math.min(1, (time - born) / 0.95);
          if (k >= 1) grow!.delete(t);
          else {
            const el = k === 0 ? 0 : Math.pow(2, -9 * k) * Math.sin((k * 9 - 0.75) * ((2 * Math.PI) / 3)) + 1;
            sc *= Math.max(0.01, el);
            stretch = 1 + Math.sin(k * Math.PI * 3) * 0.22 * (1 - k);
            this.dirty = true;
          }
        }
        q.setFromAxisAngle(up, f === Feat.Crop ? 0 : r2 * Math.PI * 2);
        s.set(sc / Math.sqrt(stretch), sc * (0.9 + r3 * 0.25) * stretch, sc / Math.sqrt(stretch));
        p.set(px, py, pz);
        m.compose(p, q, s);
        const L = lists[pi];
        for (let k = 0; k < 16; k++) L.push(m.elements[k]);
        const tint = 0.9 + r3 * 0.2;
        colLists[pi].push(tint, tint * (0.96 + r1 * 0.08), tint);
        const keep = f === Feat.Flower || f === Feat.Crop ? false : f === Feat.Boulder || f === Feat.Ore ? true : hash2(x, z, 53) < 0.5;
        if (keep) {
          // survivors grow a little to cover for the missing neighbours
          m.compose(p, q, s.multiplyScalar(1.2));
          for (let k = 0; k < 16; k++) thin[pi].push(m.elements[k]);
          thinCol[pi].push(tint, tint * (0.96 + r1 * 0.08), tint);
        }
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
    }
    if (grow && grow.size === 0) this.growth.delete(ci);
    // which pools changed (had or now have instances here)
    for (let pi = 0; pi < this.pools.length; pi++) if ((cache.counts[pi] ?? 0) > 0 || lists[pi].length > 0) this.changedPools.add(pi);
    this.changedChunks.add(ci);
    cache.mats = lists.map((l) => new Float32Array(l));
    cache.cols = colLists.map((l) => new Float32Array(l));
    cache.counts = lists.map((l) => l.length / 16);
    cache.thinMats = thin.map((l) => new Float32Array(l));
    cache.thinCols = thinCol.map((l) => new Float32Array(l));
    cache.thinCounts = thin.map((l) => l.length / 16);
    cache.box.min.set(cx * CHUNK, Math.min(minY, 0) - 1, cz * CHUNK);
    cache.box.max.set((cx + 1) * CHUNK, Math.max(maxY, 0) + 3, (cz + 1) * CHUNK);
  }

  markGrow(t: number, time: number) {
    const w = this.world;
    const ci = ((((t / w.W) | 0) / CHUNK) | 0) * w.CW + (((t % w.W) / CHUNK) | 0);
    // only sprouts in view up close get the springy pop; elsewhere the tree simply appears
    if (!this.hiChunks.has(ci)) return;
    let g = this.growth.get(ci);
    if (!g) { g = new Map(); this.growth.set(ci, g); }
    g.set(t, time);
  }

  private rebuildCursor = 0;
  update(camera: THREE.Camera, heightScale: number, z01: number, time: number) {
    const w = this.world;
    let changed = false;
    // animating sprouts first (they are on screen), then other edits round-robin within the budget
    let budget = this.lastKey === '' ? Infinity : FloraRenderer.REBUILDS_PER_FRAME;
    for (const ci of [...this.growth.keys()]) { if (budget <= 0) break; w.featChunkDirty[ci] = 0; this.rebuildChunk(ci, time); changed = true; budget--; }
    const n = w.featChunkDirty.length;
    for (let k = 0; k < n && budget > 0; k++) {
      const ci = (this.rebuildCursor + k) % n;
      if (!w.featChunkDirty[ci]) continue;
      w.featChunkDirty[ci] = 0;
      this.rebuildChunk(ci, time);
      changed = true; budget--;
      this.rebuildCursor = (ci + 1) % n;
    }
    const cp = camera.position;
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    // visibility / LOD signature per chunk; only re-gather when it changes
    const order: [number, boolean][] = [];
    const box = new THREE.Box3();
    const hiDist = 46;
    let sig = '';
    for (let ci = 0; ci < this.chunks.length; ci++) {
      const c = this.chunks[ci];
      box.copy(c.box); box.min.y *= heightScale; box.max.y *= heightScale; box.max.y += 2;
      if (!this.frustum.intersectsBox(box)) continue;
      const d = box.distanceToPoint(cp);
      const hi = d < hiDist && z01 < 0.62;
      order.push([ci, hi]);
      sig += hi ? 'H' + ci : 'L' + ci;
    }
    const mapView = z01 > 0.82;
    sig += mapView ? 'M' : '';
    this.hiChunks.clear();
    for (const [ci, hi] of order) if (hi) this.hiChunks.add(ci);
    if (!changed && !this.dirty && sig === this.lastKey) return;
    // the view changed: every pool is re-gathered; only content changed: just the touched pools,
    // and each uploads from the first touched chunk onward instead of the whole buffer
    const full = this.dirty || sig !== this.lastKey;
    this.lastKey = sig;
    this.dirty = false;
    const counts = this.pools.map(() => [0, 0]);
    for (let pi = 0; pi < this.pools.length; pi++) {
      if (!full && !this.changedPools.has(pi)) continue;
      const pool = this.pools[pi];
      let nh = 0, nl = 0;
      for (const [ci, hi] of order) { const c = this.chunks[ci]; const n = (hi || !mapView ? c.counts[pi] : c.thinCounts[pi]) || 0; if (hi) nh += n; else nl += n; }
      const fresh = this.ensureCap(pool, Math.max(nh, nl));
      let oh = 0, ol = 0, fh = full || fresh ? 0 : -1, fl = full || fresh ? 0 : -1;
      const hm = pool.hi.instanceMatrix.array as Float32Array, lm = pool.lo.instanceMatrix.array as Float32Array;
      const hc = pool.hi.instanceColor!.array as Float32Array, lc = pool.lo.instanceColor!.array as Float32Array;
      for (const [ci, hi] of order) {
        const c = this.chunks[ci];
        const thinned = !hi && mapView;
        const n = (thinned ? c.thinCounts[pi] : c.counts[pi]) || 0;
        const touched = this.changedChunks.has(ci);
        if (hi) { if (touched && fh < 0) fh = oh; }
        else if (touched && fl < 0) fl = ol;
        if (!n) continue;
        if (hi) { hm.set(c.mats[pi], oh * 16); hc.set(c.cols[pi], oh * 3); oh += n; }
        else if (thinned) { lm.set(c.thinMats[pi], ol * 16); lc.set(c.thinCols[pi], ol * 3); ol += n; }
        else { lm.set(c.mats[pi], ol * 16); lc.set(c.cols[pi], ol * 3); ol += n; }
      }
      const upload = (mesh: THREE.InstancedMesh, from: number, count: number, prevCount: number) => {
        const end = Math.max(count, prevCount);
        mesh.visible = count > 0;
        if (from < 0 || end <= from) { mesh.count = count; return; }
        const im = mesh.instanceMatrix, ic = mesh.instanceColor!;
        im.clearUpdateRanges(); ic.clearUpdateRanges();
        im.addUpdateRange(from * 16, (end - from) * 16); ic.addUpdateRange(from * 3, (end - from) * 3);
        im.needsUpdate = true; ic.needsUpdate = true;
        mesh.count = count;
      };
      upload(pool.hi, fh, oh, pool.hi.count); upload(pool.lo, fl, ol, pool.lo.count);
      counts[pi] = [oh, ol];
    }
    this.changedPools.clear();
    this.changedChunks.clear();
  }

  /** Grow the pool's buffers if needed; true when they were recreated (needs a full upload). */
  private ensureCap(pool: Pool, n: number): boolean {
    if (n <= pool.cap && pool.hi.instanceColor) return false;
    let cap = pool.cap;
    while (cap < n) cap *= 2;
    pool.cap = cap;
    for (const key of ['hi', 'lo'] as const) {
      const old = pool[key];
      const m = new THREE.InstancedMesh(old.geometry, old.material, cap);
      m.castShadow = old.castShadow; m.receiveShadow = true; m.frustumCulled = false;
      m.customDepthMaterial = old.customDepthMaterial;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.remove(old);
      old.dispose();
      this.group.add(m);
      pool[key] = m;
    }
    return true;
  }
}
