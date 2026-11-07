import * as THREE from 'three';
import { Sim } from '../sim/sim';
import { SPECIES, SPECIES_COUNT, Sp, isCiv, isVehicle, isMonster, KINGDOM_COLORS } from '../sim/defs';
import { UF, Anim } from '../sim/entities';
import { buildCreatureModels, SKIN_TONES, HAIR_TONES } from './models/creatures';
import { patchInstanced } from './shared';
import { heightCubic } from '../sim/world';
import { U } from './shared';

const ANIM_GLSL = /* glsl */ `
attribute float aSlot; attribute float aPart; attribute vec3 aPivot; attribute float aItem;
attribute vec3 iCloth; attribute vec3 iSkin; attribute vec3 iHair; attribute vec4 iMisc; // misc.w = mood*99 (int part) + hit flash (fraction)
uniform float uAnimTime;
varying float vFlash;
mat3 gsRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 gsRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 gsRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
// returns rotation (about pivot) and whole-body offset for this vertex
void gsAnim(out mat3 R, out vec3 piv, out vec3 off, out float lean) {
  float A = iMisc.x; float t = uAnimTime + iMisc.y;
  int part = int(aPart + 0.5);
  if ((A >= 10.0 && A < 14.0) || A == 17.0) {
    // machines: rigid; boats bob and roll, tanks rumble, propellers spin
    R = mat3(1.0); piv = aPivot; lean = 0.0;
    off = vec3(0.0, A == 11.0 ? sin(t * 1.7) * 0.02 : A == 10.0 ? sin(t * 40.0) * 0.003 : 0.0, 0.0);
    if (A == 11.0) lean = sin(t * 1.1) * 0.05;
    if (part == 7 && A == 12.0) R = gsRotZ(t * 45.0);
    if (A == 13.0) off.z -= 0.07; // gun recoil
    // saucers: hover bob, a lazy wobble, the light ring spinning
    if (A == 17.0) { off.y = sin(t * 2.2) * 0.05; lean = sin(t * 1.3) * 0.06; if (part == 7) R = gsRotY(t * 2.6); }
    return;
  }
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
  // drowning: head thrown back, arms thrashing above the surface, bobbing under
  if (A == 14.0) { lhZ = -2.4 - sin(t * 13.0) * 0.55; rhZ = 2.4 + sin(t * 11.0) * 0.55; lhA = sin(t * 9.0) * 0.7; rhA = -sin(t * 8.0) * 0.7; headX = -0.5; legA = sin(t * 10.0) * 0.5; bob = -0.34 + sin(t * 6.0) * 0.08; lean = -0.2; }
  // casting: both hands raised forward, a slight sway as the spell builds
  if (A == 15.0) { lhA = -1.7 + sin(t * 8.0) * 0.12; rhA = -2.0 + sin(t * 7.0) * 0.18; lhZ = -0.35; rhZ = 0.35; headX = -0.18; bob = abs(sin(t * 4.0)) * 0.02; lean = -0.06; }
  // dead: limp limbs (the topple itself is the instance transform)
  if (A == 16.0) { lhZ = -1.2; rhZ = 1.2; lhA = -0.4; rhA = 0.3; headX = 0.55; legA = 0.25; tailA = 0.0; }
  // mood colours every pose: gloomy creatures hang their heads, cheerful ones bounce
  float md = floor(iMisc.w) / 99.0;
  if (A >= 14.0) md = 0.5;
  if (md < 0.3 && A != 5.0) { float g = (0.3 - md) / 0.3; headX += 0.45 * g; bob *= 1.0 - 0.5 * g; lhZ *= 0.3; rhZ *= 0.3; lean += 0.1 * g; }
  if (md > 0.75 && (A == 0.0 || walk)) { float j = (md - 0.75) / 0.25; bob += abs(sin(t * (walk ? spd : 5.0))) * 0.035 * j; headY += sin(t * 3.0) * 0.15 * j; }
  if (A == 5.0) { lhZ = -0.4; rhZ = 0.4; headY = 0.0; headX = -0.1 + sin(t * 1.2) * 0.04; legA = 0.0; }
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
    shader.uniforms.uAnimTime = U.uAnimTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${ANIM_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  mat3 R; vec3 piv; vec3 off; float lean;
  gsAnim(R, piv, off, lean);
  transformed = R * (transformed - piv) + piv;
  if (int(aPart + 0.5) == 6 && abs(aItem - iMisc.z) > 0.5) transformed = piv;
  transformed = gsRotX(lean) * transformed + off;
  // asleep: lie on the back, breathing gently
  if (iMisc.x == 5.0) transformed = gsRotX(-1.48) * transformed + vec3(0.0, 0.1 + sin(uAnimTime * 1.5 + iMisc.y) * 0.005, 0.0);
}`);
    if (!depth) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
  mat3 R; vec3 piv; vec3 off; float lean;
  gsAnim(R, piv, off, lean);
  objectNormal = gsRotX(lean) * (R * objectNormal);
  if (iMisc.x == 5.0) objectNormal = gsRotX(-1.48) * objectNormal;
}`)
        .replace('#include <color_vertex>', `#include <color_vertex>
{
  int sl = int(aSlot + 0.5);
  if (sl == 1) vColor.rgb *= iCloth;
  else if (sl == 2) vColor.rgb *= iSkin;
  else if (sl == 3) vColor.rgb *= iHair;
  else if (sl == 4) vColor.rgb *= iCloth * 0.4 + vec3(0.1, 0.08, 0.07);
  else if (sl == 5) vColor.rgb *= mix(iCloth, vec3(1.0), 0.6);
  vFlash = fract(iMisc.w);
}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFlash;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.35, 0.3), vFlash * 0.75);')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.4, 0.3) * vFlash * 0.6;
// soft rim light: rounded silhouettes catch the sky, like plush toys under studio light
{ float rim = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0); totalEmissiveRadiance += diffuseColor.rgb * rim * 0.32 + vec3(0.9, 0.95, 1.0) * rim * 0.08; }`);
    }
  };
  mat.customProgramCacheKey = () => (depth ? 'gs-char-depth' : 'gs-char');
  patchInstanced(mat, {});
  return mat;
}

interface Pool { mesh: THREE.InstancedMesh; cloth: THREE.InstancedBufferAttribute; skin: THREE.InstancedBufferAttribute; hair: THREE.InstancedBufferAttribute; misc: THREE.InstancedBufferAttribute; cap: number; }

/** Characters are drawn a bit larger than their simulation footprint so they read well. */
export const CREATURE_SCALE = 1.4;

const SPECIES_TINT: Record<number, number> = { [Sp.Zombie]: 0x5f6f7a, [Sp.Mage]: 0x5a3ab0, [Sp.UFO]: 0xc8d2dc, [Sp.Alien]: 0xb8c4d0, [Sp.Demon]: 0x5a1612, [Sp.ColdOne]: 0xa8e0f8, [Sp.Sheep]: 0xf4f1ea, [Sp.Wolf]: 0x7d8590, [Sp.Deer]: 0xb27a46, [Sp.Bear]: 0x7a5236, [Sp.Skeleton]: 0xe6e1d2, [Sp.Chicken]: 0xfff6e0, [Sp.Troll]: 0x5f7a78, [Sp.Rabbit]: 0xcab49a, [Sp.Fox]: 0xe0742e, [Sp.Boar]: 0x6a4a36, [Sp.Crocodile]: 0x4f7a3a, [Sp.Fish]: 0x4aa8d8, [Sp.Dragon]: 0xd8322a };

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
  followId = -1;
  star: THREE.Mesh;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();
  private tmpP = new THREE.Vector3();
  private c = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);
  private fallAxis = new THREE.Vector3();
  private qFall = new THREE.Quaternion();
  private counts = new Int32Array(SPECIES_COUNT);
  visibleCount = 0;
  /** breath gauge: a row of bubbles over swimmers' heads */
  private bubbles: THREE.InstancedMesh;
  /** shoreline cache: highest water level within 2 tiles of each tile (-inf when none) */
  private shore: Float32Array | null = null;
  private shoreKey = '';
  /** bodies of the recently dead, shown toppling over (or sinking) before they fade into the ground */
  private corpses: { sp: number; x: number; z: number; y: number; dir: number; look: number; col: number; item: number; scale: number; t0: number; life: number; drown: boolean; burnt: boolean; side: number; age: number; adult: number; mood: number }[] = [];

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
    // a chunky golden star hovers over the creature being followed
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.075 : 0.17; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) sh.lineTo(x, y); else sh.moveTo(x, y); }
    const sg = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.022, bevelSegments: 2 });
    sg.center();
    this.star = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xb07a00, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.35 }));
    this.star.visible = false; this.star.renderOrder = 25;
    const outline = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x2a2238, side: THREE.BackSide }));
    outline.scale.setScalar(1.18);
    this.star.add(outline);
    this.group.add(this.star);
    const bm = new THREE.MeshStandardMaterial({ color: 0xcff4ff, emissive: 0x4aa8d8, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.85 });
    patchInstanced(bm, {});
    this.bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 10, 8), bm, 600);
    this.bubbles.frustumCulled = false; this.bubbles.count = 0; this.bubbles.renderOrder = 24;
    this.group.add(this.bubbles);
  }

  /** Drawn ground height for a land creature: the terrain, or the surface of shallow surf it wades in. */
  private groundY(w: Sim['world'], x: number, z: number): number {
    let y = heightCubic(w.height, w.W, w.H, x, z);
    const t = w.tileAt(x, z);
    if (t < 0) return y;
    if (w.water[t] > w.height[t]) return Math.max(y, w.water[t] - 0.05);
    const sh = this.shore![t];
    // the drawn surf covers the edge of this dry tile: stand in it ankle-deep instead of under it
    if (sh > y) y = Math.max(y, sh - 0.1);
    return y;
  }

  private ensureShore(w: Sim['world']) {
    const key = `${w.W}x${w.H}:${w.terrainVersion}:${w.waterVersion}`;
    if (this.shore && this.shore.length === w.N && key === this.shoreKey) return;
    this.shoreKey = key;
    const { W, H } = w;
    const sh = this.shore && this.shore.length === w.N ? this.shore : new Float32Array(w.N);
    // two separable max passes over the water levels (5x5 window)
    const lv = new Float32Array(w.N).fill(-Infinity);
    for (let t = 0; t < w.N; t++) if (w.water[t] > w.height[t]) lv[t] = w.water[t];
    const tmp = new Float32Array(w.N);
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      let m = -Infinity;
      for (let d = -2; d <= 2; d++) { const xx = x + d; if (xx >= 0 && xx < W) { const v = lv[z * W + xx]; if (v > m) m = v; } }
      tmp[z * W + x] = m;
    }
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      let m = -Infinity;
      for (let d = -2; d <= 2; d++) { const zz = z + d; if (zz >= 0 && zz < H) { const v = tmp[zz * W + x]; if (v > m) m = v; } }
      sh[z * W + x] = m;
    }
    this.shore = sh;
  }

  private makePool(g: THREE.BufferGeometry, cap: number): Pool {
    const mesh = new THREE.InstancedMesh(g, this.mat, cap);
    mesh.customDepthMaterial = this.depthMat;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const mk = (n: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const cloth = mk(3), skin = mk(3), hair = mk(3), misc = mk(4);
    g.setAttribute('iCloth', cloth); g.setAttribute('iSkin', skin); g.setAttribute('iHair', hair); g.setAttribute('iMisc', misc);
    if (g.getAttribute('iMood')) g.deleteAttribute('iMood');
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
    const a = lodAlpha(sim, u, alpha);
    const x = u.px + (u.x - u.px) * a, z = u.pz + (u.z - u.pz) * a;
    const w = sim.world;
    this.ensureShore(w);
    const y = this.groundY(w, x, z);
    return out.set(x, y + u.y, z);
  }

  orbit = 0;
  /** camera heading (set by the game each frame) */
  viewYaw = 0;

  update(sim: Sim, alpha: number, camPos: THREE.Vector3, focus: THREE.Vector3, viewV: number, z01: number, pixelScale: number, dt: number) {
    const show3D = z01 < 0.86 || this.orbit > 0.5;
    const radiusMul = this.orbit > 0.5 ? 4 : 1;
    const counts = this.counts;
    counts.fill(0);
    const w = sim.world;
    this.ensureShore(w);
    const radius = Math.max(30, viewV * 1.4) * radiusMul;
    let mk = 0, crowns = 0, nb = 0;
    this.ensureMarkers(sim.units.length + 8);
    const time = U.uTime.value;
    const markersOn = z01 > 0.5 || this.orbit > 0.05;
    // newly dead bodies (kept only near the view; a few seconds each)
    this.takeCorpses(sim, focus, radius, time);
    // first pass: count per species for capacity
    if (show3D) {
      for (const u of sim.units) if (!(u.flags & UF.Dead)) counts[u.sp]++;
      for (const c of this.corpses) counts[c.sp]++;
      for (let sp = 0; sp < SPECIES_COUNT; sp++) if (this.pools[sp]) this.grow(sp, counts[sp] + 4);
      counts.fill(0);
    }
    // camera-right on the ground plane: breath bubbles line up across the screen
    const rx = Math.cos(this.viewYaw), rz = -Math.sin(this.viewYaw);
    for (const u of sim.units) {
      if (u.flags & UF.Dead) continue;
      const def = SPECIES[u.sp];
      const ph = this.physics.get(u.id);
      let x: number, y: number, z: number;
      if (ph) { x = ph.pos.x; y = ph.pos.y; z = ph.pos.z; }
      else {
        const a = lodAlpha(sim, u, alpha);
        x = u.px + (u.x - u.px) * a; z = u.pz + (u.z - u.pz) * a;
        // far outside the 3D view and no map pins wanted: skip the ground lookup entirely
        if (!markersOn) { const ddx = x - focus.x, ddz = z - focus.z; if (ddx * ddx + ddz * ddz > radius * radius) continue; }
        y = this.groundY(w, x, z) + u.y;
      }
      // team colour
      let col: number;
      if (isCiv(u.sp) || isVehicle(u.sp)) {
        const k = sim.kingdoms.get(u.kingdom);
        col = k ? KINGDOM_COLORS[k.color][0] : isVehicle(u.sp) ? 0x3a3a3a : 0xcdbb94;
      } else col = SPECIES_TINT[u.sp] ?? 0xffffff;
      // markers (map view)
      if (markersOn) {
        const o = mk * 3;
        this.markerPos[o] = x; this.markerPos[o + 1] = y + 0.5; this.markerPos[o + 2] = z;
        this.c.setHex(col);
        this.markerCol[o] = this.c.r; this.markerCol[o + 1] = this.c.g; this.markerCol[o + 2] = this.c.b;
        const base = isCiv(u.sp) ? 8 : isVehicle(u.sp) ? 11 : u.sp === Sp.Skeleton || isMonster(u.sp) ? (u.sp === Sp.UFO ? 13 : 8) : u.sp === Sp.Troll ? 12 : u.sp === Sp.Dragon ? 16 : u.sp === Sp.Fish ? 2.4 : 3.6;
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
      if (!isCiv(u.sp) && u.sp !== Sp.Skeleton && u.sp !== Sp.Troll && !isMonster(u.sp)) sc = CREATURE_SCALE * (child ? 0.55 + 0.45 * Math.min(1, u.age / def.adultAge) : 1);
      if (u.sp === Sp.UFO) sc = CREATURE_SCALE * 1.5;
      if (isVehicle(u.sp)) sc = CREATURE_SCALE * (u.sp === Sp.Boat ? 1.7 : u.sp === Sp.Tank ? 1.6 : 1.8);
      if (u.sp === Sp.Dragon) sc = CREATURE_SCALE * def.size;
      if (u.sp === Sp.Crocodile) sc = CREATURE_SCALE * 1.15 * (child ? 0.6 : 1);
      // a little pop when born
      const age = sim.tick - u.born;
      if (age < 8) sc *= 0.5 + 0.5 * Math.min(1, (age + alpha) / 8) + Math.sin(Math.min(1, (age + alpha) / 8) * Math.PI) * 0.25;
      if (ph) this.tmpQ.copy(ph.quat); else this.tmpQ.setFromAxisAngle(this.up, ry);
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
      if (hairs && u.age > def.lifespan[0] * 0.75) this.c.lerp(GREY, 0.7);
      pool.hair.setXYZ(i, this.c.r, this.c.g, this.c.b);
      // breath gauge over anyone holding their breath under deep water
      if (u.air !== undefined && nb < 590) {
        const n = Math.ceil(u.air / 20), hy = y + ((isCiv(u.sp) ? 1.05 : 0.75) * def.size * CREATURE_SCALE) + 0.28 + Math.sin(time * 4 + u.id) * 0.03;
        for (let b = 0; b < 5; b++) {
          const full = b < n, part = b === n - 1 ? (u.air - b * 20) / 20 : 1;
          const s = full ? 0.6 + 0.4 * part : 0.32;
          if (!full && u.air > 0 && b >= n + 1) continue;
          const o = (b - 2) * 0.15;
          this.tmpP.set(x + rx * o, hy + (full ? 0 : -0.02), z + rz * o);
          this.tmpS.setScalar(full ? s : (u.air <= 0 ? 0.5 + Math.sin(time * 20) * 0.2 : s));
          this.tmpM.compose(this.tmpP, IDQ, this.tmpS);
          this.bubbles.setMatrixAt(nb++, this.tmpM);
        }
      }
      let anim: number = u.anim;
      if (isVehicle(u.sp)) anim = u.sp === Sp.Boat ? Anim.Float : u.sp === Sp.Plane ? Anim.Soar : u.animT > 0 ? 13 : Anim.Drive;
      else if (ph || u.id === this.heldId || u.flags & UF.Beamed) anim = Anim.Fly;
      else if (u.sp === Sp.UFO) anim = Anim.Hover;
      else if (u.task?.k === 'idle' && anim === Anim.Walk) anim = Anim.Idle;
      if ((anim === Anim.Walk || anim === Anim.Panic) && u.px === u.x && u.pz === u.z) anim = Anim.Idle;
      if (u.flags & UF.Aboard) anim = Anim.Idle;
      if (u.anim === Anim.Drown) anim = Anim.Drown;
      const item = u.sp === Sp.Troll ? 8 : u.sp === Sp.Boat ? 20 + u.item : isMonster(u.sp) ? u.item : child || !isCiv(u.sp) ? 0 : u.item;
      const mood = isVehicle(u.sp) ? 60 : (u.mood ?? 60);
      pool.misc.setXYZW(i, anim, (look % 1000) * 0.0137, anim === Anim.Sleep ? 0 : item, Math.round(Math.max(0, Math.min(1, mood / 100)) * 99) + (u.hitT > 0 ? Math.min(0.95, u.hitT / 6) : 0));
      if (u.flags & UF.King) {
        const hh = (u.sp === Sp.Dwarf ? 0.55 : 0.72) * sc;
        this.tmpP.set(x, y + hh, z);
        this.tmpS.setScalar(sc);
        this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
        if (crowns < this.crowns.count + 64) this.crowns.setMatrixAt(crowns++, this.tmpM);
      }
    }
    if (show3D) this.drawCorpses(w, time, counts);
    this.bubbles.count = show3D ? nb : 0;
    this.bubbles.visible = this.bubbles.count > 0;
    if (nb > 0) { this.bubbles.instanceMatrix.clearUpdateRanges(); this.bubbles.instanceMatrix.addUpdateRange(0, nb * 16); this.bubbles.instanceMatrix.needsUpdate = true; }
    let total = 0;
    for (let sp = 0; sp < SPECIES_COUNT; sp++) {
      const p = this.pools[sp];
      if (!p) continue;
      const n = show3D ? counts[sp] : 0;
      p.mesh.count = n;
      p.mesh.visible = n > 0; // empty pools cost a draw call (and a shadow pass) otherwise
      total += n;
      // upload only the live instances, never the whole (doubling) capacity
      if (n > 0) {
        p.mesh.instanceMatrix.clearUpdateRanges(); p.mesh.instanceMatrix.addUpdateRange(0, n * 16); p.mesh.instanceMatrix.needsUpdate = true;
        for (const a of [p.cloth, p.skin, p.hair]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 3); a.needsUpdate = true; }
        p.misc.clearUpdateRanges(); p.misc.addUpdateRange(0, n * 4); p.misc.needsUpdate = true;
      }
    }
    this.visibleCount = total;
    this.crowns.count = Math.min(crowns, 64);
    this.crowns.visible = this.crowns.count > 0;
    // follow star
    const fu = this.followId >= 0 ? sim.getUnit(this.followId) : undefined;
    const fp = fu ? this.unitPos(sim, fu.id, alpha, this.tmpP) : null;
    this.star.visible = !!fp && show3D;
    if (fp) {
      const def = SPECIES[fu!.sp];
      const h = (isCiv(fu!.sp) ? 0.95 : 0.6) * def.size * CREATURE_SCALE + 0.35;
      this.star.position.set(fp.x, (fp.y + h) * U.uHeightScale.value + Math.sin(time * 3) * 0.05, fp.z);
      this.star.rotation.set(0, time * 2.2, 0);
      const s = 1 + Math.max(0, Math.sin(time * 6)) * 0.08;
      this.star.scale.setScalar(s * Math.max(1, Math.min(3, viewV / 14)));
    }
    if (this.crowns.count > 0) this.crowns.instanceMatrix.needsUpdate = true;
    const g = this.markers.geometry;
    g.setDrawRange(0, mk);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    this.markerMat.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(z01, 0.55, 0.8) * (1 - this.orbit);
    this.markerMat.uniforms.uScale.value = pixelScale;
    void time;
  }


  private takeCorpses(sim: Sim, focus: THREE.Vector3, radius: number, time: number) {
    const g = sim.graveyard;
    if (!g.length) return;
    const w = sim.world;
    for (const d of g) {
      const u = d.u;
      if (isVehicle(u.sp) || u.sp === Sp.UFO || !this.pools[u.sp] || sim.tick - d.tick > 30) continue;
      const dx = u.x - focus.x, dz = u.z - focus.z;
      if (dx * dx + dz * dz > radius * radius || this.corpses.length > 150) continue;
      const def = SPECIES[u.sp];
      const child = u.age < def.adultAge;
      let sc = CREATURE_SCALE * def.size * (child ? 0.5 + 0.5 * Math.min(1, u.age / def.adultAge) : 1);
      if (!isCiv(u.sp) && u.sp !== Sp.Skeleton && u.sp !== Sp.Troll && !isMonster(u.sp)) sc = CREATURE_SCALE * (child ? 0.55 + 0.45 * Math.min(1, u.age / def.adultAge) : 1);
      if (u.sp === Sp.Dragon) sc = CREATURE_SCALE * def.size;
      if (u.sp === Sp.Crocodile) sc = CREATURE_SCALE * 1.15 * (child ? 0.6 : 1);
      const k = sim.kingdoms.get(u.kingdom);
      const col = isCiv(u.sp) ? (k ? KINGDOM_COLORS[k.color][0] : 0xcdbb94) : SPECIES_TINT[u.sp] ?? 0xffffff;
      const drown = d.cause === 'drown';
      this.corpses.push({
        sp: u.sp, x: u.x, z: u.z, y: this.groundY(w, u.x, u.z) + Math.max(0, u.y), dir: this.yawCache.get(u.id) ?? u.dir, look: u.look, col,
        item: isMonster(u.sp) ? u.item : child || !isCiv(u.sp) ? 0 : u.item, scale: sc, t0: time, life: drown ? 3.6 : u.sp === Sp.Fish ? 1.2 : 2.6, drown,
        burnt: d.cause === 'fire' || d.cause === 'lightning', side: (u.id & 1) ? 1 : -1, age: u.age, adult: def.adultAge, mood: u.mood ?? 60,
      });
      this.yawCache.delete(u.id);
    }
    g.length = 0;
    // forget facing for anyone gone (keeps the cache from growing over decades)
    if (this.yawCache.size > sim.units.length * 2 + 256) { const alive = new Set(sim.units.map((u) => u.id)); for (const id of this.yawCache.keys()) if (!alive.has(id)) this.yawCache.delete(id); }
  }

  private drawCorpses(w: Sim['world'], time: number, counts: Int32Array) {
    let j = 0;
    for (const c of this.corpses) {
      const k = (time - c.t0) / c.life;
      if (k >= 1) continue;
      this.corpses[j++] = c;
      const pool = this.pools[c.sp];
      if (!pool) continue;
      const i = counts[c.sp]++;
      if (i >= pool.cap) continue;
      // topple: a quick fall with a small bounce, then settle and sink into the ground (or the depths)
      const a = Math.min(1, k * (c.drown ? 1.6 : 4.2));
      const bounce = a < 1 ? 0 : Math.max(0, Math.sin((k * 4.2 - 1) * 9) * 0.08 * Math.max(0, 1 - (k * 4.2 - 1)));
      const fall = (c.drown ? 1.25 : 1.5) * (1 - (1 - a) * (1 - a)) - bounce;
      this.tmpQ.setFromAxisAngle(this.up, c.dir);
      this.fallAxis.set(Math.cos(c.dir), 0, -Math.sin(c.dir)); // the creature's own left-right axis
      if (c.sp >= Sp.Sheep && c.sp !== Sp.Skeleton && c.sp !== Sp.Troll) this.fallAxis.set(Math.sin(c.dir), 0, Math.cos(c.dir)); // beasts roll onto their side
      this.qFall.setFromAxisAngle(this.fallAxis, fall * c.side);
      this.tmpQ.premultiply(this.qFall);
      let y = c.y;
      if (c.drown) y -= k * 1.3;
      else y -= THREE.MathUtils.smoothstep(k, 0.7, 1) * 0.5 * c.scale;
      this.tmpP.set(c.x, y, c.z);
      this.tmpS.setScalar(c.scale);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      pool.mesh.setMatrixAt(i, this.tmpM);
      const burn = c.burnt ? 0.28 : 1;
      this.c.setHex(c.col).multiplyScalar(burn); pool.cloth.setXYZ(i, this.c.r, this.c.g, this.c.b);
      const skins = SKIN_TONES[c.sp], hairs = HAIR_TONES[c.sp];
      this.c.setHex(skins ? skins[c.look % skins.length] : 0xffffff).multiplyScalar(burn); pool.skin.setXYZ(i, this.c.r, this.c.g, this.c.b);
      this.c.setHex(hairs ? hairs[(c.look >> 3) % hairs.length] : 0xffffff).multiplyScalar(burn); pool.hair.setXYZ(i, this.c.r, this.c.g, this.c.b);
      pool.misc.setXYZW(i, Anim.Die, (c.look % 1000) * 0.0137, c.item, 50);
    }
    this.corpses.length = j;
    void w;
  }
}

/** Interpolation factor; half-rate (LOD) creatures move over two ticks per update. */
function lodAlpha(sim: Sim, u: { lod?: number; lodTick?: number }, alpha: number) {
  if (!u.lod || u.lodTick === undefined) return alpha;
  return Math.min(1, ((sim.tick - u.lodTick) + alpha) / 2);
}

const GREY = new THREE.Color(0xdddddd);
const IDQ = new THREE.Quaternion();
