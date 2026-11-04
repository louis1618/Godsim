import * as THREE from 'three';
import { Sim } from '../sim/sim';
import { Bk, KINGDOM_COLORS } from '../sim/defs';
import { buildBuildingModels, bkey, scaffold } from './models/buildings';
import { patchInstanced, U } from './shared';
import { heightCubic } from '../sim/world';

const BLD_GLSL = /* glsl */ `
attribute float aSlot; attribute float aPart; attribute vec3 aPivot;
attribute vec3 iCloth; attribute vec4 iMisc; // clipY, fire, phase, unused
varying float vFire; varying float vClip;
mat3 bRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
`;

function makeBuildingMaterial(depth: boolean) {
  const mat = depth ? new THREE.MeshDepthMaterial() : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${BLD_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  int part = int(aPart + 0.5);
  float t = uTime + iMisc.z;
  if (part == 1) transformed = bRotZ(t * 1.4) * (transformed - aPivot) + aPivot;
  else if (part == 2) { float f = 0.85 + 0.25 * sin(t * 17.0) + 0.1 * sin(t * 29.0); transformed = (transformed - aPivot) * vec3(1.0, f, 1.0) + aPivot; }
  else if (part == 3) { float d = transformed.x - aPivot.x; transformed.z += sin(t * 5.0 - d * 9.0) * d * 0.25; }
  vClip = 0.0;
  if (transformed.y > iMisc.x) { vClip = 1.0; transformed.y = iMisc.x; }
}`);
    if (!depth) {
      shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
{
  int sl = int(aSlot + 0.5);
  if (sl == 1) vColor.rgb *= iCloth;
  else if (sl == 5) vColor.rgb *= mix(iCloth, vec3(1.0), 0.55);
  vFire = iMisc.y;
}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFire; varying float vClip;\nuniform float uTime;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(1.0, 0.25, vFire);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.72, 0.5), vClip * 0.6);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.35, 0.08) * vFire * (0.35 + 0.3 * sin(uTime * 9.0 + vViewPosition.x * 3.0));');
      shader.uniforms.uTime = U.uTime;
    }
  };
  mat.customProgramCacheKey = () => (depth ? 'gs-bld-d' : 'gs-bld');
  patchInstanced(mat, {});
  return mat;
}

interface Pool { mesh: THREE.InstancedMesh; cloth: THREE.InstancedBufferAttribute; misc: THREE.InstancedBufferAttribute; cap: number; height: number; }

export class BuildingRenderer {
  readonly group = new THREE.Group();
  private pools = new Map<string, Pool>();
  private scaffolds: Pool[] = [];
  private mat = makeBuildingMaterial(false);
  private depth = makeBuildingMaterial(true);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private c = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);

  constructor() {
    for (const [key, g] of buildBuildingModels()) this.pools.set(key, this.makePool(g, 16));
    for (let s = 1; s <= 3; s++) this.scaffolds[s] = this.makePool(scaffold(s), 16);
  }

  private makePool(g: THREE.BufferGeometry, cap: number): Pool {
    const mesh = new THREE.InstancedMesh(g, this.mat, cap);
    mesh.customDepthMaterial = this.depth;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    const cloth = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    const misc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    g.setAttribute('iCloth', cloth); g.setAttribute('iMisc', misc);
    mesh.count = 0;
    this.group.add(mesh);
    if (!g.boundingBox) g.computeBoundingBox();
    return { mesh, cloth, misc, cap, height: g.boundingBox!.max.y + 0.05 };
  }

  private grow(pool: Pool, n: number): Pool {
    if (n <= pool.cap) return pool;
    let cap = pool.cap; while (cap < n) cap *= 2;
    this.group.remove(pool.mesh); pool.mesh.dispose();
    const np = this.makePool(pool.mesh.geometry, cap);
    return np;
  }

  update(sim: Sim) {
    const counts = new Map<Pool, number>();
    const w = sim.world;
    const all: [Pool, number][] = [];
    // count first
    const need = new Map<string, number>();
    for (const b of sim.buildings.values()) {
      const key = bkey(b.kind, b.race, b.kind === 0 ? b.level : 0);
      need.set(key, (need.get(key) ?? 0) + 1);
    }
    for (const [key, n] of need) { const p = this.pools.get(key); if (p && n > p.cap) this.pools.set(key, this.grow(p, n)); }
    let scafNeed = [0, 0, 0, 0];
    for (const b of sim.buildings.values()) if (b.progress < 1) scafNeed[b.size]++;
    for (let s = 1; s <= 3; s++) if (scafNeed[s] > this.scaffolds[s].cap) this.scaffolds[s] = this.grow(this.scaffolds[s], scafNeed[s]);
    for (const b of sim.buildings.values()) {
      const key = bkey(b.kind, b.race, b.kind === Bk.TownHall ? b.level : 0);
      const pool = this.pools.get(key);
      if (!pool) continue;
      const i = counts.get(pool) ?? 0;
      counts.set(pool, i + 1);
      const cx = b.x + b.size / 2, cz = b.z + b.size / 2;
      const y = heightCubic(w.height, w.W, w.H, cx, cz);
      this.q.setFromAxisAngle(this.up, (b.rot * Math.PI) / 2);
      // pop-in when placed
      const age = sim.tick - b.born;
      const sc = age < 6 ? 0.7 + 0.3 * (age / 6) : 1;
      this.s.set(sc, 1, sc);
      this.p.set(cx, y - 0.02, cz);
      this.m.compose(this.p, this.q, this.s);
      pool.mesh.setMatrixAt(i, this.m);
      const v = sim.villages.get(b.village);
      const k = v ? sim.kingdoms.get(v.kingdom) : undefined;
      this.c.setHex(k ? KINGDOM_COLORS[k.color][0] : 0x9a9088);
      if (!k) this.c.multiplyScalar(0.8);
      pool.cloth.setXYZ(i, this.c.r, this.c.g, this.c.b);
      const prog = b.kind === Bk.TownHall && b.level > 0 && b.progress < 1 ? Math.max(b.progress, 0.55) : b.progress;
      const clip = prog >= 1 ? 99 : 0.05 + pool.height * Math.pow(prog, 0.85);
      pool.misc.setXYZW(i, clip, b.fire > 0 ? Math.min(1, b.fire / 60) * 0.85 : 0, (b.look % 100) * 0.37, 0);
      if (b.progress < 1 && b.kind !== Bk.Farm) {
        const sp = this.scaffolds[b.size];
        const j = counts.get(sp) ?? 0;
        counts.set(sp, j + 1);
        this.m.compose(this.p, this.q, new THREE.Vector3(1, 1, 1));
        sp.mesh.setMatrixAt(j, this.m);
        sp.cloth.setXYZ(j, 1, 1, 1);
        sp.misc.setXYZW(j, 99, 0, 0, 0);
      }
    }
    for (const pool of [...this.pools.values(), ...this.scaffolds.slice(1)]) {
      pool.mesh.count = counts.get(pool) ?? 0;
      pool.mesh.instanceMatrix.needsUpdate = true;
      pool.cloth.needsUpdate = true; pool.misc.needsUpdate = true;
    }
    void all;
  }
}
