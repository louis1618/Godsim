import * as THREE from 'three';
import { Sim } from '../sim/sim';
import { SPECIES, SPECIES_COUNT, Sp, isCiv, KINGDOM_COLORS } from '../sim/defs';
import { UF, Anim } from '../sim/entities';
import { buildCreatureModels, SKIN_TONES, HAIR_TONES } from './models/creatures';
import { patchInstanced } from './shared';
import { heightCubic } from '../sim/world';
import { U } from './shared';

const ANIM_GLSL = /* glsl */ `
attribute float aSlot; attribute float aPart; attribute vec3 aPivot; attribute float aItem;
attribute vec3 iCloth; attribute vec3 iSkin; attribute vec3 iHair; attribute vec4 iMisc;
varying float vFlash;
mat3 gsRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 gsRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 gsRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
// returns rotation (about pivot) and whole-body offset for this vertex
void gsAnim(out mat3 R, out vec3 piv, out vec3 off, out float lean) {
  float A = iMisc.x; float t = uTime + iMisc.y;
  int part = int(aPart + 0.5);
  bool walk = A == 1.0 || A == 4.0;
  float spd = A == 4.0 ? 18.0 : 12.0;
  float s = sin(t * spd);
  float bob = 0.0, legA = 0.0, lhA = 0.0, rhA = 0.0, lhZ = 0.0, rhZ = 0.0, headX = 0.0, headY = 0.0, tailA = 0.0;
  lean = 0.0;
  if (walk) { legA = s * 0.75; lhA = -s * 0.65; rhA = s * 0.65; bob = abs(cos(t * spd)) * 0.028; tailA = sin(t * spd * 0.5) * 0.5; lean = 0.06; }
  if (A == 0.0) { bob = sin(t * 2.2) * 0.004; headY = sin(t * 0.6) * 0.35 * step(0.3, sin(t * 0.23)); tailA = sin(t * 1.4) * 0.35; lhZ = -0.08; rhZ = 0.08; }
  if (A == 2.0) { float c = sin(t * 7.0); rhA = -1.7 + c * 1.15; lhA = -0.9 + c * 0.45; lean = 0.12 + c * 0.06; headX = 0.2; }
  if (A == 3.0) { float c = fract(t * 1.7); float k = c < 0.25 ? c / 0.25 : 1.0 - (c - 0.25) / 0.75; rhA = -2.6 * k + 0.4; lhA = 0.3; lean = 0.18 * k; legA = 0.25; }
  if (A == 4.0) { lhZ = -2.5 - sin(t * 22.0) * 0.45; rhZ = 2.5 + sin(t * 21.0) * 0.45; lean = 0.15; }
  if (A == 6.0) { lhZ = -2.7; rhZ = 2.7; bob = abs(sin(t * 8.0)) * 0.09; }
  if (A == 7.0) { bob = -0.2; lhA = s * 1.3; rhA = -s * 1.3; legA = s * 0.5; }
  if (A == 8.0) { lhZ = -1.4 - sin(t * 25.0) * 0.9; rhZ = 1.4 + sin(t * 23.0) * 0.9; legA = sin(t * 30.0) * 0.9; headX = sin(t * 13.0) * 0.4; }
  if (A == 9.0) { headX = 0.75 + sin(t * 9.0) * 0.15; lhA = -0.6; rhA = -0.6; }
  R = mat3(1.0); piv = aPivot; off = vec3(0.0, bob, 0.0);
  if (part == 4) R = gsRotX(legA);
  else if (part == 5) R = gsRotX(-legA);
  else if (part == 2) R = gsRotZ(lhZ) * gsRotX(lhA);
  else if (part == 3 || part == 6) R = gsRotZ(rhZ) * gsRotX(rhA);
  else if (part == 1 || part == 8) R = gsRotY(headY) * gsRotX(headX);
  else if (part == 7) R = gsRotY(tailA) * gsRotX(sin(t * 6.0) * 0.15);
}
`;

function makeCharacterMaterial(depth: boolean): THREE.Material {
  const mat = depth ? new THREE.MeshDepthMaterial() : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${ANIM_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  mat3 R; vec3 piv; vec3 off; float lean;
  gsAnim(R, piv, off, lean);
  transformed = R * (transformed - piv) + piv;
  if (int(aPart + 0.5) == 6 && abs(aItem - iMisc.z) > 0.5) transformed = piv;
  transformed = gsRotX(lean) * transformed + off;
}`);
    if (!depth) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
  mat3 R; vec3 piv; vec3 off; float lean;
  gsAnim(R, piv, off, lean);
  objectNormal = gsRotX(lean) * (R * objectNormal);
}`)
        .replace('#include <color_vertex>', `#include <color_vertex>
{
  int sl = int(aSlot + 0.5);
  if (sl == 1) vColor.rgb *= iCloth;
  else if (sl == 2) vColor.rgb *= iSkin;
  else if (sl == 3) vColor.rgb *= iHair;
  else if (sl == 4) vColor.rgb *= iCloth * 0.4 + vec3(0.1, 0.08, 0.07);
  else if (sl == 5) vColor.rgb *= mix(iCloth, vec3(1.0), 0.6);
  vFlash = iMisc.w;
}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFlash;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.35, 0.3), vFlash * 0.75);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.4, 0.3) * vFlash * 0.6;');
    }
  };
  mat.customProgramCacheKey = () => (depth ? 'gs-char-depth' : 'gs-char');
  patchInstanced(mat, {});
  return mat;
}

interface Pool { mesh: THREE.InstancedMesh; cloth: THREE.InstancedBufferAttribute; skin: THREE.InstancedBufferAttribute; hair: THREE.InstancedBufferAttribute; misc: THREE.InstancedBufferAttribute; cap: number; }

/** Characters are drawn a bit larger than their simulation footprint so they read well. */
export const CREATURE_SCALE = 1.4;

const SPECIES_TINT: Record<number, number> = { [Sp.Sheep]: 0xf4f1ea, [Sp.Wolf]: 0x7d8590, [Sp.Deer]: 0xb27a46, [Sp.Bear]: 0x7a5236, [Sp.Skeleton]: 0xe6e1d2, [Sp.Chicken]: 0xfff6e0 };

/** Renders every creature: animated 3D instances up close, coloured map pins from afar. */
export class UnitRenderer {
  readonly group = new THREE.Group();
  private pools: (Pool | null)[] = [];
  private mat: THREE.Material;
  private depthMat: THREE.Material;
  private yawCache = new Map<number, number>();
  private markers: THREE.Points;
  private markerPos: Float32Array;
  private markerCol: Float32Array;
  private markerSize: Float32Array;
  private markerCap = 0;
  readonly markerMat: THREE.ShaderMaterial;
  private crowns: THREE.InstancedMesh;
  /** unit id -> override transform from physics (ragdolls) */
  physics = new Map<number, { pos: THREE.Vector3; quat: THREE.Quaternion }>();
  heldId = -1;
  selectedId = -1;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();
  private tmpP = new THREE.Vector3();
  private c = new THREE.Color();
  visibleCount = 0;

  constructor() {
    this.mat = makeCharacterMaterial(false);
    this.depthMat = makeCharacterMaterial(true);
    const models = buildCreatureModels();
    for (let sp = 0; sp < SPECIES_COUNT; sp++) {
      const g = models[sp];
      if (!g) { this.pools.push(null); continue; }
      this.pools.push(this.makePool(g, 64));
    }
    // map markers
    this.markerMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false,
      uniforms: { uOpacity: { value: 0 }, uScale: { value: 1 }, uHeightScale: U.uHeightScale },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize;
        uniform float uScale; uniform float uHeightScale;
        varying vec3 vC; varying float vS;
        void main() {
          vC = aColor; vS = aSize;
          vec3 p = position; p.y *= uHeightScale;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = aSize * uScale;
        }`,
      fragmentShader: `
        uniform float uOpacity; varying vec3 vC; varying float vS;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          if (r > 1.0) discard;
          float edge = smoothstep(0.62, 0.75, r);
          vec3 col = mix(vC, vec3(0.08, 0.06, 0.1), edge);
          col += (0.25 - d.y) * 0.25 * (1.0 - edge);
          float a = (1.0 - smoothstep(0.85, 1.0, r)) * uOpacity;
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.markerPos = new Float32Array(0); this.markerCol = new Float32Array(0); this.markerSize = new Float32Array(0);
    this.markers = new THREE.Points(new THREE.BufferGeometry(), this.markerMat);
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 20;
    this.group.add(this.markers);
    this.ensureMarkers(512);
    // crowns for kings
    const cg = new THREE.CylinderGeometry(0.075, 0.06, 0.07, 8, 1, true);
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffcf3a, metalness: 0.6, roughness: 0.35, emissive: 0x6b4a00, side: THREE.DoubleSide });
    patchInstanced(crownMat, {});
    this.crowns = new THREE.InstancedMesh(cg, crownMat, 64);
    this.crowns.frustumCulled = false; this.crowns.count = 0;
    this.group.add(this.crowns);
  }

  private makePool(g: THREE.BufferGeometry, cap: number): Pool {
    const mesh = new THREE.InstancedMesh(g, this.mat, cap);
    mesh.customDepthMaterial = this.depthMat;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const mk = (n: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const cloth = mk(3), skin = mk(3), hair = mk(3), misc = mk(4);
    g.setAttribute('iCloth', cloth); g.setAttribute('iSkin', skin); g.setAttribute('iHair', hair); g.setAttribute('iMisc', misc);
    mesh.count = 0;
    this.group.add(mesh);
    return { mesh, cloth, skin, hair, misc, cap };
  }

  private grow(sp: number, need: number) {
    const p = this.pools[sp]!;
    if (need <= p.cap) return;
    let cap = p.cap; while (cap < need) cap *= 2;
    this.group.remove(p.mesh);
    p.mesh.dispose();
    const g = p.mesh.geometry;
    this.pools[sp] = this.makePool(g, cap);
  }

  private ensureMarkers(n: number) {
    if (n <= this.markerCap) return;
    let cap = Math.max(512, this.markerCap); while (cap < n) cap *= 2;
    this.markerCap = cap;
    this.markerPos = new Float32Array(cap * 3); this.markerCol = new Float32Array(cap * 3); this.markerSize = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.markerPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.markerCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.markerSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.markers.geometry.dispose();
    this.markers.geometry = g;
  }

  /** Render-space position of a unit (unscaled height). */
  unitPos(sim: Sim, id: number, alpha: number, out: THREE.Vector3): THREE.Vector3 | null {
    const u = sim.getUnit(id);
    if (!u) return null;
    const ph = this.physics.get(id);
    if (ph) return out.copy(ph.pos);
    const x = u.px + (u.x - u.px) * alpha, z = u.pz + (u.z - u.pz) * alpha;
    const w = sim.world;
    let y = heightCubic(w.height, w.W, w.H, x, z);
    const t = w.tileAt(x, z);
    if (t >= 0 && w.water[t] > w.height[t]) y = Math.max(y, w.water[t] - 0.05);
    return out.set(x, y + u.y, z);
  }

  update(sim: Sim, alpha: number, camPos: THREE.Vector3, focus: THREE.Vector3, viewV: number, z01: number, pixelScale: number, dt: number) {
    const show3D = z01 < 0.86;
    const counts = new Array(SPECIES_COUNT).fill(0);
    const w = sim.world;
    const radius = Math.max(30, viewV * 1.4);
    let mk = 0, crowns = 0;
    this.ensureMarkers(sim.units.length + 8);
    const time = U.uTime.value;
    // first pass: count per species for capacity
    if (show3D) {
      for (const u of sim.units) if (!(u.flags & UF.Dead)) counts[u.sp]++;
      for (let sp = 0; sp < SPECIES_COUNT; sp++) if (this.pools[sp]) this.grow(sp, counts[sp] + 4);
      counts.fill(0);
    }
    for (const u of sim.units) {
      if (u.flags & UF.Dead) continue;
      const def = SPECIES[u.sp];
      const ph = this.physics.get(u.id);
      let x: number, y: number, z: number;
      if (ph) { x = ph.pos.x; y = ph.pos.y; z = ph.pos.z; }
      else {
        x = u.px + (u.x - u.px) * alpha; z = u.pz + (u.z - u.pz) * alpha;
        y = heightCubic(w.height, w.W, w.H, x, z);
        const t = w.tileAt(x, z);
        if (t >= 0 && w.water[t] > w.height[t]) y = Math.max(y, w.water[t] - 0.05);
        y += u.y;
      }
      // team colour
      let col: number;
      if (isCiv(u.sp)) {
        const k = sim.kingdoms.get(u.kingdom);
        col = k ? KINGDOM_COLORS[k.color][0] : 0xcdbb94;
      } else col = SPECIES_TINT[u.sp] ?? 0xffffff;
      // markers (map view)
      {
        const o = mk * 3;
        this.markerPos[o] = x; this.markerPos[o + 1] = y + 0.5; this.markerPos[o + 2] = z;
        this.c.setHex(col);
        this.markerCol[o] = this.c.r; this.markerCol[o + 1] = this.c.g; this.markerCol[o + 2] = this.c.b;
        const base = isCiv(u.sp) ? 7.5 : 5;
        this.markerSize[mk] = base * (u.flags & UF.King ? 1.7 : u.flags & UF.Hero ? 1.35 : 1) * (u.age < def.adultAge ? 0.75 : 1) * (u.sp === Sp.Bear ? 1.3 : 1);
        mk++;
      }
      if (!show3D) continue;
      const dx = x - focus.x, dz = z - focus.z;
      if (dx * dx + dz * dz > radius * radius) continue;
      const pool = this.pools[u.sp];
      if (!pool) continue;
      const i = counts[u.sp]++;
      // smooth facing
      let ry = this.yawCache.get(u.id);
      if (ry === undefined) ry = u.dir;
      let d = u.dir - ry; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      ry += d * Math.min(1, dt * 12);
      this.yawCache.set(u.id, ry);
      const child = u.age < def.adultAge;
      let sc = CREATURE_SCALE * def.size * (child ? 0.5 + 0.5 * Math.min(1, u.age / def.adultAge) : 1) * (u.flags & UF.Hero ? 1.12 : 1) * (u.flags & UF.King ? 1.06 : 1);
      if (!isCiv(u.sp) && u.sp !== Sp.Skeleton) sc = CREATURE_SCALE * (child ? 0.55 + 0.45 * Math.min(1, u.age / def.adultAge) : 1);
      // a little pop when born
      const age = sim.tick - u.born;
      if (age < 8) sc *= 0.5 + 0.5 * Math.min(1, (age + alpha) / 8) + Math.sin(Math.min(1, (age + alpha) / 8) * Math.PI) * 0.25;
      if (ph) this.tmpQ.copy(ph.quat); else this.tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      this.tmpS.setScalar(sc);
      this.tmpP.set(x, y, z);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      pool.mesh.setMatrixAt(i, this.tmpM);
      // colours
      const look = u.look;
      this.c.setHex(col); pool.cloth.setXYZ(i, this.c.r, this.c.g, this.c.b);
      const skins = SKIN_TONES[u.sp], hairs = HAIR_TONES[u.sp];
      this.c.setHex(skins ? skins[look % skins.length] : 0xffffff); pool.skin.setXYZ(i, this.c.r, this.c.g, this.c.b);
      this.c.setHex(hairs ? hairs[(look >> 3) % hairs.length] : 0xffffff);
      if (hairs && u.age > def.lifespan[0] * 0.75) this.c.lerp(new THREE.Color(0xdddddd), 0.7);
      pool.hair.setXYZ(i, this.c.r, this.c.g, this.c.b);
      let anim: number = u.anim;
      if (ph || u.id === this.heldId) anim = Anim.Fly;
      else if (u.task?.k === 'idle' && anim === Anim.Walk) anim = Anim.Idle;
      if (anim === Anim.Walk && u.px === u.x && u.pz === u.z) anim = Anim.Idle;
      const item = child || !isCiv(u.sp) ? 0 : u.item;
      pool.misc.setXYZW(i, anim, (look % 1000) * 0.0137, item, u.hitT > 0 ? u.hitT / 6 : 0);
      if (u.flags & UF.King) {
        const hh = (u.sp === Sp.Dwarf ? 0.55 : 0.72) * sc;
        this.tmpP.set(x, y + hh, z);
        this.tmpS.setScalar(sc);
        this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
        if (crowns < this.crowns.count + 64) this.crowns.setMatrixAt(crowns++, this.tmpM);
      }
    }
    let total = 0;
    for (let sp = 0; sp < SPECIES_COUNT; sp++) {
      const p = this.pools[sp];
      if (!p) continue;
      p.mesh.count = show3D ? counts[sp] : 0;
      total += p.mesh.count;
      p.mesh.instanceMatrix.needsUpdate = true;
      p.cloth.needsUpdate = p.skin.needsUpdate = p.hair.needsUpdate = p.misc.needsUpdate = true;
    }
    this.visibleCount = total;
    this.crowns.count = Math.min(crowns, 64);
    this.crowns.instanceMatrix.needsUpdate = true;
    const g = this.markers.geometry;
    g.setDrawRange(0, mk);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    this.markerMat.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(z01, 0.55, 0.8);
    this.markerMat.uniforms.uScale.value = pixelScale;
    void time;
  }
}
