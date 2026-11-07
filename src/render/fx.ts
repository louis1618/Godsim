import * as THREE from 'three';
import { Sim, FxEvent } from '../sim/sim';
import { UF } from '../sim/entities';
import { KINGDOM_COLORS, SPECIES, Feat } from '../sim/defs';
import { heightCubic } from '../sim/world';
import { makeParticleAtlas, makeEmoteAtlas, PARTICLE_CELLS, EMOTE_CELLS, PF } from './atlas';
import { U } from './shared';
import { fireTiles } from '../sim/nature';
import { Physics } from '../physics/physics';
import { CameraRig } from './cameraRig';
import { ModelBuilder, T, geo } from './models/kit';

const MAXP = 7000;

/** Camera-facing instanced quads with per-particle size/rotation/colour/atlas cell. */
class Particles {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(MAXP * 3);
  private vel = new Float32Array(MAXP * 3);
  private col = new Float32Array(MAXP * 4);
  private data = new Float32Array(MAXP * 3); // size, rot, frame
  private life = new Float32Array(MAXP);
  private max = new Float32Array(MAXP);
  private s0 = new Float32Array(MAXP);
  private s1 = new Float32Array(MAXP);
  private grav = new Float32Array(MAXP);
  private drag = new Float32Array(MAXP);
  private vrot = new Float32Array(MAXP);
  private a0 = new Float32Array(MAXP);
  n = 0;
  private iPos: THREE.InstancedBufferAttribute;
  private iCol: THREE.InstancedBufferAttribute;
  private iData: THREE.InstancedBufferAttribute;

  constructor(tex: THREE.Texture, cells: number, additive: boolean) {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iCol = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iData = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos); g.setAttribute('iCol', this.iCol); g.setAttribute('iData', this.iData);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: null }, uCells: { value: cells } }]),
      vertexShader: `
        #include <common>
        #include <fog_pars_vertex>
        attribute vec3 iPos; attribute vec4 iCol; attribute vec3 iData;
        uniform float uHeightScale; uniform float uCells;
        varying vec2 vUv; varying vec4 vCol;
        void main() {
          vec3 p = iPos; p.y *= uHeightScale;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float c = cos(iData.y), s = sin(iData.y);
          vec2 q = position.xy;
          q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
          mvPosition.xy += q * iData.x;
          gl_Position = projectionMatrix * mvPosition;
          vUv = vec2((uv.x + iData.z) / uCells, uv.y);
          vCol = iCol;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D uTex;
        varying vec2 vUv; varying vec4 vCol;
        void main() {
          vec4 t = texture2D(uTex, vUv);
          gl_FragColor = vec4(t.rgb * vCol.rgb, t.a * vCol.a);
          if (gl_FragColor.a < 0.01) discard;
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    mat.uniforms.uTex.value = tex;
    mat.uniforms.uHeightScale = U.uHeightScale;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 11;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, o: { life: number; size: number; size1?: number; color: number | THREE.Color; alpha?: number; frame: number; grav?: number; drag?: number; rot?: number; vrot?: number }) {
    if (this.n >= MAXP) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    const c = o.color instanceof THREE.Color ? o.color : _c.setHex(o.color);
    this.col[i * 4] = c.r; this.col[i * 4 + 1] = c.g; this.col[i * 4 + 2] = c.b; this.col[i * 4 + 3] = o.alpha ?? 1;
    this.a0[i] = o.alpha ?? 1;
    this.life[i] = this.max[i] = o.life;
    this.s0[i] = o.size; this.s1[i] = o.size1 ?? o.size;
    this.data[i * 3 + 1] = o.rot ?? Math.random() * 6.28; this.data[i * 3 + 2] = o.frame;
    this.grav[i] = o.grav ?? 0; this.drag[i] = o.drag ?? 0; this.vrot[i] = o.vrot ?? 0;
  }

  update(dt: number) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); continue; }
      const k = 1 - this.life[i] / this.max[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.data[i * 3] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      this.data[i * 3 + 1] += this.vrot[i] * dt;
      this.col[i * 4 + 3] = this.a0[i] * (k < 0.15 ? k / 0.15 : 1 - Math.pow((k - 0.15) / 0.85, 2));
      i++;
    }
    (this.iPos.array as Float32Array).set(this.pos.subarray(0, this.n * 3));
    (this.iCol.array as Float32Array).set(this.col.subarray(0, this.n * 4));
    (this.iData.array as Float32Array).set(this.data.subarray(0, this.n * 3));
    this.iPos.needsUpdate = this.iCol.needsUpdate = this.iData.needsUpdate = true;
    this.iPos.addUpdateRange(0, this.n * 3); this.iCol.addUpdateRange(0, this.n * 4); this.iData.addUpdateRange(0, this.n * 3);
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = this.n;
  }

  private kill(i: number) {
    const j = --this.n;
    if (i === j) return;
    for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; this.data[i * 3 + k] = this.data[j * 3 + k]; }
    for (let k = 0; k < 4; k++) this.col[i * 4 + k] = this.col[j * 4 + k];
    this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; this.vrot[i] = this.vrot[j]; this.a0[i] = this.a0[j];
  }
}
const _c = new THREE.Color();

interface Bolt { mesh: THREE.Mesh; life: number; }
interface Arrow { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; t: number; dur: number; arc?: number; }

/** Every transient visual: particles, emotes, bolts, arrows, meteors, tornadoes, debris, rain, clouds. */
export class FxRenderer {
  readonly group = new THREE.Group();
  readonly alpha: Particles;
  readonly add: Particles;
  private emotes: THREE.Mesh;
  private emoteAttr: { pos: THREE.InstancedBufferAttribute; data: THREE.InstancedBufferAttribute };
  private bolts: Bolt[] = [];
  private arrows: Arrow[] = [];
  private arrowMesh: THREE.InstancedMesh;
  private shells: Arrow[] = [];
  /** fireballs in flight: a glowing head with a trail of flame */
  private spells: Arrow[] = [];
  private shellMesh: THREE.InstancedMesh;
  private nukeMesh: THREE.InstancedMesh;
  private bombMesh: THREE.InstancedMesh;
  private reticles: THREE.InstancedMesh;
  private meteorMesh: THREE.InstancedMesh;
  private tornadoMesh: THREE.InstancedMesh;
  private debrisMesh: THREE.InstancedMesh;
  private flash: THREE.PointLight;
  private flashT = 0;
  private rings: { mesh: THREE.Mesh; t: number; max: number; r: number }[] = [];
  private clouds: THREE.InstancedMesh;
  private cloudData: { x: number; z: number; y: number; s: number; v: number; r: number; k: number }[] = [];
  private rainClouds: THREE.InstancedMesh;
  screenFlash = 0;
  private fireAcc = 0;

  constructor(private physics: Physics, private rig: CameraRig) {
    const atlas = makeParticleAtlas();
    this.alpha = new Particles(atlas, PARTICLE_CELLS, false);
    this.add = new Particles(atlas, PARTICLE_CELLS, true);
    this.group.add(this.alpha.mesh, this.add.mesh);
    // emote billboards
    const emTex = makeEmoteAtlas();
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
    const ep = new THREE.InstancedBufferAttribute(new Float32Array(2048 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const ed = new THREE.InstancedBufferAttribute(new Float32Array(2048 * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', ep); g.setAttribute('iData', ed);
    this.emoteAttr = { pos: ep, data: ed };
    const emat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTex: { value: emTex }, uHeightScale: U.uHeightScale, uSize: { value: 0.3 } },
      vertexShader: `
        attribute vec3 iPos; attribute vec2 iData; uniform float uHeightScale; uniform float uSize;
        varying vec2 vUv; varying float vA;
        void main() {
          vec3 p = iPos; p.y *= uHeightScale;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float s = uSize * (0.6 + 0.4 * min(1.0, iData.y * 4.0));
          mv.xy += position.xy * s;
          gl_Position = projectionMatrix * mv;
          vUv = vec2((uv.x + iData.x) / ${EMOTE_CELLS}.0, uv.y);
          vA = min(1.0, iData.y * 6.0);
        }`,
      fragmentShader: `
        uniform sampler2D uTex; varying vec2 vUv; varying float vA;
        void main() {
          vec4 t = texture2D(uTex, vUv); gl_FragColor = vec4(t.rgb, t.a * vA); if (gl_FragColor.a < 0.02) discard;
          #include <colorspace_fragment>
        }`,
    });
    this.emotes = new THREE.Mesh(g, emat);
    this.emotes.frustumCulled = false; this.emotes.renderOrder = 30;
    this.group.add(this.emotes);
    // arrows
    const ab = new ModelBuilder(3);
    ab.add(geo.cyl(0.008, 0.008, 0.32, 4), { color: 0x8a5a33 }, T(0, 0, 0, Math.PI / 2));
    ab.add(geo.cone(0.02, 0.06, 4), { color: 0xb9c0c8 }, T(0, 0, 0.18, Math.PI / 2));
    ab.add(geo.box(0.04, 0.002, 0.06), { color: 0xf2efe8 }, T(0, 0, -0.14));
    const std = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    this.arrowMesh = new THREE.InstancedMesh(ab.build(), std, 256);
    this.arrowMesh.frustumCulled = false; this.arrowMesh.count = 0;
    this.group.add(this.arrowMesh);
    // shells & bombs
    const sb = new ModelBuilder(5);
    sb.add(geo.capsule(0.06, 0.1, 3, 8), { color: 0x2f3236 }, T(0, 0, 0, Math.PI / 2));
    sb.add(geo.cone(0.06, 0.08, 8), { color: 0x4a4e54 }, T(0, 0, 0.1, Math.PI / 2));
    this.shellMesh = new THREE.InstancedMesh(sb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5 }), 128);
    this.shellMesh.frustumCulled = false; this.shellMesh.count = 0;
    this.group.add(this.shellMesh);
    // ordnance falling from the sky: a striped warhead and a finned bomb, plus a red target ring
    const nb = new ModelBuilder(6);
    nb.add(geo.cyl(0.32, 0.32, 1.9, 16), { color: (p) => (Math.floor((p.y + 0.95) * 3.2) % 2 ? new THREE.Color(0xf2c230) : new THREE.Color(0x2a2a30)) }, T(0, 0, 0));
    nb.add(geo.cone(0.32, 0.8, 16), { color: 0xd8d4cc }, T(0, 1.35, 0));
    nb.add(geo.sphere(0.06, 8, 6), { color: 0xff3a2a }, T(0, 1.76, 0));
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; nb.add(geo.box(0.04, 0.6, 0.42), { color: 0x6a6e74 }, new THREE.Matrix4().makeRotationY(a).multiply(T(0, -0.85, 0.36))); }
    nb.add(geo.cyl(0.22, 0.28, 0.2, 12), { color: 0x3a3c40 }, T(0, -1.05, 0));
    this.nukeMesh = new THREE.InstancedMesh(nb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 }), 8);
    this.nukeMesh.frustumCulled = false; this.nukeMesh.count = 0;
    this.group.add(this.nukeMesh);
    const bb = new ModelBuilder(7);
    bb.add(geo.capsule(0.16, 0.5, 4, 12), { color: 0x3a4030 }, T(0, 0, 0));
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; bb.add(geo.box(0.02, 0.24, 0.2), { color: 0x2a2c30 }, new THREE.Matrix4().makeRotationY(a).multiply(T(0, -0.42, 0.14))); }
    bb.add(geo.torus(0.16, 0.02, 4, 12), { color: 0xd8c84a }, T(0, 0.12, 0, Math.PI / 2));
    this.bombMesh = new THREE.InstancedMesh(bb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }), 32);
    this.bombMesh.frustumCulled = false; this.bombMesh.count = 0;
    this.group.add(this.bombMesh);
    const rg = new THREE.RingGeometry(0.86, 1, 64); rg.rotateX(-Math.PI / 2);
    this.reticles = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.75, depthWrite: false, depthTest: false }), 48);
    this.reticles.frustumCulled = false; this.reticles.count = 0; this.reticles.renderOrder = 45;
    this.group.add(this.reticles);
    // meteors
    const mb = new ModelBuilder(4);
    mb.add(geo.ico(0.8, 1), { color: 0x4a3a32, jitter: 0.15, flat: true }, T());
    this.meteorMesh = new THREE.InstancedMesh(mb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xff4a10, emissiveIntensity: 0.28, roughness: 0.9 }), 16);
    this.meteorMesh.frustumCulled = false; this.meteorMesh.count = 0;
    this.group.add(this.meteorMesh);
    // tornado funnel
    const pts: [number, number][] = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([0.35 + Math.pow(t, 1.8) * 2.4, t * 7]); }
    const tg = geo.lathe(pts, 18);
    const tmat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: U.uTime },
      vertexShader: `varying vec2 vUv; varying float vY; uniform float uTime; void main(){ vUv = uv; vY = position.y; vec3 p = position; p.x += sin(p.y * 0.8 + uTime * 3.0) * 0.25 * p.y / 7.0; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0); }`,
      fragmentShader: `varying vec2 vUv; varying float vY; uniform float uTime;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        void main(){ float s = sin((vUv.x * 6.2831 * 3.0) + vY * 1.5 - uTime * 9.0) * 0.5 + 0.5; float a = (0.25 + 0.5 * s) * smoothstep(0.0, 0.6, vY) * (1.0 - smoothstep(5.5, 7.0, vY)); gl_FragColor = vec4(mix(vec3(0.55, 0.52, 0.5), vec3(0.85, 0.83, 0.8), s), a * 0.8); }`,
    });
    this.tornadoMesh = new THREE.InstancedMesh(tg, tmat, 8);
    this.tornadoMesh.frustumCulled = false; this.tornadoMesh.count = 0;
    this.group.add(this.tornadoMesh);
    // debris
    const dm = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    this.debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), dm, 256);
    this.debrisMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(256 * 3), 3);
    this.debrisMesh.castShadow = true; this.debrisMesh.frustumCulled = false; this.debrisMesh.count = 0;
    this.group.add(this.debrisMesh);
    // flash light
    this.flash = new THREE.PointLight(0xffd0a0, 0, 30, 1.5);
    this.group.add(this.flash);
    // clouds
    const cb = new ModelBuilder(9);
    for (const [x, y, z, r] of [[0, 0, 0, 1.6], [1.5, -0.3, 0.2, 1.2], [-1.5, -0.35, -0.1, 1.15], [0.6, 0.5, -0.5, 1.1], [-0.5, 0.35, 0.7, 1.0], [2.6, -0.6, 0, 0.8], [-2.6, -0.6, 0.3, 0.75],
      [0.9, 0.85, 0.3, 0.75], [-0.9, 0.7, -0.4, 0.7], [0.2, 1.1, 0.0, 0.6], [1.9, 0.1, -0.6, 0.7], [-1.9, 0.0, 0.6, 0.65], [0.3, -0.45, 1.0, 0.8], [-0.4, -0.45, -1.0, 0.8]] as const)
      cb.add(geo.ico(r, 2), { color: (p, n) => new THREE.Color(0xffffff).multiplyScalar(0.74 + 0.2 * Math.min(1, Math.max(0, (p.y + 1) / 2)) + 0.08 * Math.max(0, n.y)).lerp(new THREE.Color(0xc8d4ec), Math.max(0, -n.y) * 0.35) }, T(x, y, z, 0, 0, 0, 1, 0.72, 1));
    const cloudGeo = cb.build();
    const cmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, transparent: true, opacity: 0.9, depthWrite: false });
    this.clouds = new THREE.InstancedMesh(cloudGeo, cmat, 40);
    this.clouds.castShadow = true; this.clouds.frustumCulled = false; this.clouds.renderOrder = 40;
    this.group.add(this.clouds);
    const rmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, transparent: true, opacity: 0.92, color: 0x8a8f99, depthWrite: false });
    this.rainClouds = new THREE.InstancedMesh(cloudGeo, rmat, 32);
    this.rainClouds.castShadow = true; this.rainClouds.frustumCulled = false; this.rainClouds.count = 0; this.rainClouds.renderOrder = 41;
    this.group.add(this.rainClouds);
  }

  initClouds(W: number, H: number) {
    this.cloudData = [];
    const n = Math.round(9 * (W * H) / (192 * 192));
    for (let i = 0; i < Math.min(40, n); i++) this.cloudData.push({ x: Math.random() * W * 1.4 - W * 0.2, z: Math.random() * H * 1.4 - H * 0.2, y: 38 + Math.random() * 14, s: 2 + Math.random() * 2.4, v: 0.6 + Math.random() * 0.6, r: Math.random() * Math.PI * 2, k: 0.75 + Math.random() * 0.6 });
  }

  // ---------------------------------------------------------------- event handling
  private near(x: number, z: number, r = 1.6) {
    const f = this.rig.focus;
    const d2 = (x - f.x) ** 2 + (z - f.z) ** 2;
    const R = this.rig.V * r + 10;
    return d2 < R * R;
  }

  burst(x: number, y: number, z: number, n: number, o: { color: number; frame: number; speed: number; up?: number; life: number; size: number; size1?: number; grav?: number; drag?: number; add?: boolean; spread?: number; alpha?: number }) {
    const ps = o.add ? this.add : this.alpha;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = o.speed * (0.4 + Math.random() * 0.6);
      const sp = o.spread ?? 0;
      ps.spawn(x + (Math.random() - 0.5) * sp, y + (Math.random() - 0.5) * sp * 0.5, z + (Math.random() - 0.5) * sp, Math.cos(a) * s, (o.up ?? 0) * (0.6 + Math.random() * 0.8), Math.sin(a) * s,
        { life: o.life * (0.7 + Math.random() * 0.6), size: o.size * (0.7 + Math.random() * 0.6), size1: o.size1, color: o.color, frame: o.frame, grav: o.grav, drag: o.drag, vrot: (Math.random() - 0.5) * 4, alpha: o.alpha });
    }
  }

  private gy(sim: Sim, x: number, z: number) { const w = sim.world; return Math.max(heightCubic(w.height, w.W, w.H, x, z), w.water[w.tileAt(x, z)] ?? 0); }

  handle(sim: Sim, e: FxEvent) {
    const close = this.near(e.x, e.z);
    const y = (e.y ?? this.gy(sim, e.x, e.z));
    switch (e.t) {
      case 'hit':
        if (!close) return;
        this.burst(e.x, y + 0.3, e.z, 4, { color: 0xfff2c0, frame: PF.Spark, speed: 1.6, up: 1.5, life: 0.3, size: 0.12, size1: 0.02, add: true });
        this.burst(e.x, y + 0.05, e.z, 2, { color: 0xd8c8a8, frame: PF.Smoke, speed: 0.6, up: 0.3, life: 0.5, size: 0.15, size1: 0.3, alpha: 0.6 });
        break;
      case 'bhit':
        if (!close) return;
        this.burst(e.tx ?? e.x, y + 0.4, e.tz ?? e.z, 3, { color: 0xb08a5a, frame: PF.Chip, speed: 1.5, up: 2, life: 0.6, size: 0.06, grav: -8 });
        break;
      case 'fireball': {
        const y0 = (e.y ?? 0) + this.gy(sim, e.x, e.z) + 0.5;
        this.spells.push({ x0: e.x, z0: e.z, x1: e.tx!, z1: e.tz!, y0, y1: this.gy(sim, e.tx!, e.tz!) + 0.25, t: 0, dur: Math.max(0.3, (e.a ?? 4) * 0.1), arc: 0.18 });
        if (close) this.burst(e.x, y0, e.z, 6, { color: 0xffc04a, frame: PF.Spark, speed: 0.8, up: 0.8, life: 0.4, size: 0.08, add: true });
        break;
      }
      case 'fireburst':
        this.burst(e.x, y + 0.3, e.z, 16, { color: 0xff8a2a, frame: PF.Flame, speed: 2, up: 1.6, life: 0.55, size: 0.45, size1: 0.1, add: true, drag: 3 });
        this.burst(e.x, y + 0.3, e.z, 10, { color: 0xfff0b0, frame: PF.Spark, speed: 2.6, up: 2.2, life: 0.5, size: 0.1, add: true, grav: -6 });
        this.burst(e.x, y + 0.4, e.z, 6, { color: 0x4a403a, frame: PF.Smoke, speed: 0.8, up: 0.8, life: 1.4, size: 0.35, size1: 0.8, alpha: 0.7, drag: 1.5 });
        this.flashAt(e.x, y + 0.8, e.z, 10, 5);
        break;
      case 'laser': {
        if (!close) return;
        // instant beam: a line of bright dots from the gun (or the saucer's belly) to the target
        const y0 = (e.y ?? 0) + this.gy(sim, e.x, e.z) + (e.a === 1 ? 0.35 : 0.1);
        const y1 = this.gy(sim, e.tx!, e.tz!) + 0.3;
        const col = e.a === 1 ? 0x7affb0 : 0xff4a6a;
        for (let i = 0; i <= 14; i++) { const k = i / 14; this.add.spawn(e.x + (e.tx! - e.x) * k, y0 + (y1 - y0) * k, e.z + (e.tz! - e.z) * k, 0, 0, 0, { life: 0.12 + k * 0.08, size: 0.14, size1: 0.04, color: col, frame: PF.Dot }); }
        this.burst(e.tx!, y1, e.tz!, 5, { color: col, frame: PF.Spark, speed: 1.5, up: 1.2, life: 0.35, size: 0.08, add: true });
        this.flashAt(e.tx!, y1 + 0.3, e.tz!, 6, 3);
        break;
      }
      case 'beam': {
        if (!close) return;
        // tractor beam: a column of pale light rising from the ground to the saucer
        const top = (e.y ?? 2.6) + this.gy(sim, e.x, e.z);
        for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 0.45; this.add.spawn(e.x + Math.cos(a) * r, this.gy(sim, e.x, e.z) + Math.random() * top * 0.4, e.z + Math.sin(a) * r, 0, 2.2, 0, { life: 0.6, size: 0.12, size1: 0.02, color: 0xbfffe0, frame: PF.Dot, alpha: 0.8 }); }
        this.add.spawn(e.x, this.gy(sim, e.x, e.z) + 0.05, e.z, 0, 0, 0, { life: 0.25, size: 1.0, size1: 1.2, color: 0x9affd0, frame: PF.Ring, alpha: 0.5 });
        break;
      }
      case 'abduct':
        this.burst(e.x, y + 2.4, e.z, 12, { color: 0xbfffe0, frame: PF.Spark, speed: 1.2, up: 0.5, life: 0.6, size: 0.12, add: true });
        this.flashAt(e.x, y + 2.5, e.z, 10, 4);
        break;
      case 'blink':
        this.burst(e.x, y + 0.4, e.z, 14, { color: 0xb07aff, frame: PF.Spark, speed: 1.6, up: 1.4, life: 0.6, size: 0.12, add: true, drag: 2 });
        this.burst(e.x, y + 0.3, e.z, 6, { color: 0x6a3ab0, frame: PF.Smoke, speed: 0.6, up: 0.6, life: 1, size: 0.3, size1: 0.6, alpha: 0.7 });
        break;
      case 'freeze': {
        const r = e.a ?? 2;
        this.burst(e.x, y + 0.2, e.z, 10 + Math.round(r * 4), { color: 0xd8f6ff, frame: PF.Chip, speed: r * 0.9, up: 1.4, life: 0.9, size: 0.09, grav: -5, spread: r * 0.5 });
        this.burst(e.x, y + 0.1, e.z, 6, { color: 0xeaf8ff, frame: PF.Smoke, speed: r * 0.6, up: 0.2, life: 1.4, size: 0.4, size1: 0.9, alpha: 0.6, drag: 2 });
        break;
      }
      case 'portal':
        this.burst(e.x, y + 0.2, e.z, 20, { color: 0xff4a1a, frame: PF.Flame, speed: 1.8, up: 2.4, life: 0.8, size: 0.4, size1: 0.1, add: true });
        this.burst(e.x, y + 0.3, e.z, 10, { color: 0x2a1a1a, frame: PF.Smoke, speed: 1, up: 1.5, life: 1.8, size: 0.4, size1: 1, alpha: 0.75 });
        this.ring(e.x, y + 0.08, e.z, 2.2, 0.5);
        break;
      case 'napalm':
        this.burst(e.x, y + 0.3, e.z, 40, { color: 0xff7a1a, frame: PF.Flame, speed: 4.5, up: 1.4, life: 0.9, size: 0.6, size1: 0.2, add: true, drag: 2.5 });
        this.burst(e.x, y + 0.6, e.z, 20, { color: 0x2a2420, frame: PF.Smoke, speed: 2, up: 1.6, life: 3, size: 0.6, size1: 1.8, alpha: 0.8, drag: 1 });
        this.flashAt(e.x, y + 1.5, e.z, 24, 12);
        break;
      case 'acid':
        this.burst(e.x, y + 4, e.z, 16, { color: 0x9acc3a, frame: PF.Smoke, speed: (e.a ?? 6) * 0.4, up: 0.2, life: 2.5, size: 1.2, size1: 2.4, alpha: 0.5, drag: 1 });
        break;
      case 'steam':
        if (!close) return;
        this.burst(e.x, y + 0.3, e.z, 5, { color: 0xf2f4f6, frame: PF.Smoke, speed: 0.5, up: 1.2, life: 1.2, size: 0.2, size1: 0.6, alpha: 0.7, drag: 1.5 });
        break;
      case 'land': {
        if (!close) return;
        // a body hitting the ground: a ring of dust scaled by the impact
        const k = Math.min(2, (e.a ?? 4) / 6);
        this.burst(e.x, y + 0.05, e.z, 4 + Math.round(k * 6), { color: 0xc8b896, frame: PF.Smoke, speed: 0.8 + k, up: 0.25, life: 0.8, size: 0.18, size1: 0.45, drag: 3, alpha: 0.65 });
        if (k > 1) this.rig.shake = Math.max(this.rig.shake, 0.08 * k);
        break;
      }
      case 'gasp':
        if (!close) return;
        // air escaping: bubbles and a little splash where a creature struggles
        this.burst(e.x, y + 0.05, e.z, 4, { color: 0xdff6ff, frame: PF.Dot, speed: 0.25, up: 1.1, life: 0.9, size: 0.06, size1: 0.1, drag: 1.5, alpha: 0.85 });
        this.burst(e.x, y + 0.1, e.z, 3, { color: 0xffffff, frame: PF.Drop, speed: 1.2, up: 1.8, life: 0.5, size: 0.07, grav: -8 });
        break;
      case 'unstuck':
        if (!close) return;
        this.burst(e.x, y + 0.1, e.z, 6, { color: 0xe8dcc4, frame: PF.Smoke, speed: 0.9, up: 0.3, life: 0.6, size: 0.18, size1: 0.35, drag: 3, alpha: 0.6 });
        break;
      case 'death': {
        if (!close) return;
        const fire = e.b === 1, plague = e.b === 2;
        if (e.b === 3) {
          // drowned: a last stream of bubbles, no dust
          this.burst(e.x, y, e.z, 10, { color: 0xdff6ff, frame: PF.Dot, speed: 0.3, up: 1.4, life: 1.6, size: 0.07, size1: 0.12, drag: 1.2, alpha: 0.85, spread: 0.3 });
          this.burst(e.x, y + 0.05, e.z, 2, { color: 0xffffff, frame: PF.Ring, speed: 0, up: 0, life: 1.2, size: 0.2, size1: 0.9, alpha: 0.6 });
          if (e.a !== undefined && SPECIES[e.a].civ) this.alpha.spawn(e.x, y + 0.5, e.z, 0, 0.55, 0, { life: 2.4, size: 0.3, size1: 0.22, color: 0xffffff, frame: PF.Soul, alpha: 0.9, rot: 0 });
          break;
        }
        this.burst(e.x, y + 0.2, e.z, 6, { color: fire ? 0x3a3330 : plague ? 0x9ad65a : 0xece8e0, frame: PF.Smoke, speed: 0.8, up: 0.4, life: 0.8, size: 0.2, size1: 0.45, drag: 2, alpha: 0.8 });
        if (e.a !== undefined && SPECIES[e.a].civ) this.alpha.spawn(e.x, y + 0.5, e.z, 0, 0.55, 0, { life: 2.4, size: 0.3, size1: 0.22, color: 0xffffff, frame: PF.Soul, alpha: 0.9, rot: 0 });
        break;
      }
      case 'birth':
        if (!close) return;
        this.burst(e.x, y + 0.4, e.z, 3, { color: 0xff6a8a, frame: PF.Heart, speed: 0.3, up: 0.8, life: 1.2, size: 0.12, drag: 1 });
        this.burst(e.x, y + 0.2, e.z, 5, { color: 0xfff2a0, frame: PF.Spark, speed: 0.6, up: 0.8, life: 0.6, size: 0.08, add: true });
        break;
      case 'levelup':
        this.burst(e.x, y + 0.3, e.z, 14, { color: 0xffd53a, frame: PF.Spark, speed: 1, up: 2.2, life: 0.9, size: 0.12, add: true, drag: 1.5 });
        break;
      case 'chop': case 'mine': case 'pick': case 'harvest':
        if (!close) return;
        this.burst(e.x, y + 0.3, e.z, 3, { color: e.t === 'chop' ? 0xc89a5a : e.t === 'mine' ? 0x9a948c : e.t === 'pick' ? 0xd8304a : 0xe8c45a, frame: e.t === 'pick' ? PF.Dot : PF.Chip, speed: 1.2, up: 2.2, life: 0.6, size: 0.06, grav: -9 });
        break;
      case 'hammer':
        if (!close || Math.random() < 0.5) return;
        this.burst(e.tx ?? e.x, y + 0.3, e.tz ?? e.z, 2, { color: 0xd8c8a8, frame: PF.Smoke, speed: 0.4, up: 0.4, life: 0.5, size: 0.12, size1: 0.25, alpha: 0.6 });
        this.burst(e.x, y + 0.35, e.z, 2, { color: 0xffe9a0, frame: PF.Spark, speed: 1, up: 1.4, life: 0.25, size: 0.06, add: true });
        break;
      case 'placed':
        this.burst(e.x, y + 0.1, e.z, 8, { color: 0xd8c8a8, frame: PF.Smoke, speed: 1.2, up: 0.2, life: 0.8, size: 0.3, size1: 0.6, drag: 3, alpha: 0.7, spread: (e.b ?? 2) });
        break;
      case 'built': {
        this.burst(e.x, y + 0.6, e.z, 16, { color: 0xffe9a0, frame: PF.Spark, speed: 1.5, up: 2.2, life: 0.9, size: 0.12, add: true, drag: 1.5, spread: (e.b ?? 2) * 0.8 });
        this.burst(e.x, y + 0.05, e.z, 10, { color: 0xe0d4bc, frame: PF.Smoke, speed: 1.6, up: 0.2, life: 0.9, size: 0.35, size1: 0.7, drag: 3, alpha: 0.6, spread: e.b ?? 2 });
        break;
      }
      case 'collapse': {
        const s = e.b ?? 2;
        this.burst(e.x, y + 0.3, e.z, 18, { color: 0x8d8070, frame: PF.Smoke, speed: 1.8, up: 0.8, life: 1.6, size: 0.5, size1: 1.2, drag: 2, alpha: 0.85, spread: s });
        for (let i = 0; i < 6 + s * 2; i++) this.physics.spawnDebris(new THREE.Vector3(e.x + (Math.random() - 0.5) * s, y + 0.5 + Math.random(), e.z + (Math.random() - 0.5) * s), new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4), Math.random() < 0.5 ? 0x8a6a42 : 0x9a948c, 0.18, 4);
        this.rig.shake = Math.max(this.rig.shake, close ? 0.3 : 0);
        break;
      }
      case 'treefall':
        if (!close) return;
        this.burst(e.x, y + 0.9, e.z, 10, { color: 0x6aa84a, frame: PF.Leaf, speed: 1.2, up: 0.8, life: 1.5, size: 0.1, grav: -1.2, drag: 1.5 });
        for (let i = 0; i < 2; i++) this.physics.spawnDebris(new THREE.Vector3(e.x, y + 0.4 + i * 0.3, e.z), new THREE.Vector3(Math.sin(e.b ?? 0) * 1.5, 1, Math.cos(e.b ?? 0) * 1.5), 0x7a5235, 0.14, 2.5);
        break;
      case 'uproot':
        this.burst(e.x, y + 0.9, e.z, 6, { color: 0x6aa84a, frame: PF.Leaf, speed: 2, up: 3, life: 1.5, size: 0.12, grav: -2 });
        this.physics.spawnDebris(new THREE.Vector3(e.x, y + 0.6, e.z), new THREE.Vector3((Math.random() - 0.5) * 6, 6 + Math.random() * 4, (Math.random() - 0.5) * 6), e.a === Feat.Boulder ? 0x8d8780 : 0x5aa34a, 0.3, 4);
        break;
      case 'rockbreak':
        this.burst(e.x, y + 0.2, e.z, 8, { color: 0x9a948c, frame: PF.Chip, speed: 1.5, up: 2.5, life: 0.8, size: 0.08, grav: -9 });
        break;
      case 'sprout':
        if (!close || this.rig.z01 > 0.6) return;
        // a little burst of life: leaves, sparkle and a puff of soil
        this.burst(e.x, y + 0.3, e.z, 4, { color: 0x8fd055, frame: PF.Leaf, speed: 1.1, up: 2.6, life: 0.9, size: 0.09, grav: -5, drag: 1.2 });
        this.burst(e.x, y + 0.2, e.z, 3, { color: 0xeaffb0, frame: PF.Spark, speed: 0.6, up: 1.4, life: 0.5, size: 0.08, add: true });
        if (Math.random() < 0.5) this.burst(e.x, y + 0.05, e.z, 2, { color: 0x9a7a5a, frame: PF.Smoke, speed: 0.6, up: 0.2, life: 0.6, size: 0.12, size1: 0.3, drag: 3, alpha: 0.6 });
        break;
      case 'arrow':
        if (!close) return;
        this.arrows.push({ x0: e.x, z0: e.z, x1: e.tx!, z1: e.tz!, y0: y + 0.35, y1: this.gy(sim, e.tx!, e.tz!) + 0.3, t: 0, dur: Math.max(0.15, Math.hypot(e.tx! - e.x, e.tz! - e.z) * 0.1) });
        break;
      case 'explosion': {
        const r = e.a ?? 3;
        this.burst(e.x, y + 0.3, e.z, 30, { color: 0xffa040, frame: PF.Flame, speed: r * 1.6, up: r * 1.2, life: 0.7, size: r * 0.4, size1: r * 0.15, add: true, drag: 3 });
        this.burst(e.x, y + 0.3, e.z, 20, { color: 0xfff0b0, frame: PF.Spark, speed: r * 3, up: r * 2, life: 0.6, size: 0.2, add: true, grav: -6 });
        this.burst(e.x, y + 0.5, e.z, 24, { color: 0x5a524c, frame: PF.Smoke, speed: r * 1.2, up: r * 0.8, life: 2.4, size: r * 0.4, size1: r * 0.9, drag: 1.6, alpha: 0.85 });
        this.burst(e.x, y + 0.2, e.z, 14, { color: 0x6a5a48, frame: PF.Chip, speed: r * 2, up: r * 3, life: 1.4, size: 0.14, grav: -12 });
        for (let i = 0; i < Math.min(14, r * 2); i++) this.physics.spawnDebris(new THREE.Vector3(e.x, y + 0.5, e.z), new THREE.Vector3((Math.random() - 0.5) * r * 3, 4 + Math.random() * r * 2, (Math.random() - 0.5) * r * 3), Math.random() < 0.5 ? 0x5a4a3a : 0x8d8780, 0.22, 4);
        this.ring(e.x, y + 0.1, e.z, r * 2.6, 0.6);
        this.flashAt(e.x, y + 2, e.z, 30 * Math.min(2, r / 3), r * 6);
        this.rig.shake = Math.max(this.rig.shake, Math.min(1.2, r * 0.18) * (close ? 1 : 0.4));
        break;
      }
      case 'lightning': this.bolt(sim, e.x, e.z); break;
      case 'ignite':
        this.burst(e.x, y + 0.3, e.z, 8, { color: 0xffa040, frame: PF.Flame, speed: 0.8, up: 1.2, life: 0.6, size: 0.35, size1: 0.1, add: true });
        break;
      case 'quake':
        this.rig.shake = Math.max(this.rig.shake, 1.0);
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2, d = Math.random() * (e.a ?? 8);
          const x = e.x + Math.cos(a) * d, z = e.z + Math.sin(a) * d;
          this.alpha.spawn(x, this.gy(sim, x, z) + 0.1, z, 0, 0.5, 0, { life: 1.4, size: 0.5, size1: 1.0, color: 0xa89a84, frame: PF.Smoke, alpha: 0.7, drag: 1 });
        }
        break;
      case 'plague':
        this.burst(e.x, y + 0.5, e.z, 26, { color: 0x8fd14f, frame: PF.Smoke, speed: 1.5, up: 0.5, life: 2.5, size: 0.6, size1: 1.4, drag: 1.2, alpha: 0.55, spread: e.a ?? 3 });
        break;
      case 'heal':
        this.burst(e.x, y + 0.3, e.z, 8, { color: 0x8fff9a, frame: PF.Spark, speed: 0.5, up: 1.5, life: 0.8, size: 0.1, add: true });
        break;
      case 'found': case 'capture': case 'upgrade': {
        const k = sim.kingdoms.get(e.a ?? -1);
        const col = k ? KINGDOM_COLORS[k.color][0] : 0xffe9a0;
        this.burst(e.x, y + 0.5, e.z, 26, { color: col, frame: PF.Chip, speed: 2.2, up: 4, life: 1.8, size: 0.09, grav: -5, drag: 1 });
        this.burst(e.x, y + 0.5, e.z, 16, { color: 0xffe9a0, frame: PF.Spark, speed: 1.4, up: 3, life: 1.2, size: 0.16, add: true, drag: 1.5 });
        if (e.t === 'found') for (let i = 0; i < 20; i++) this.add.spawn(e.x, y + i * 0.4, e.z, 0, 2, 0, { life: 1.2, size: 0.9, size1: 0.3, color: 0xfff2c0, frame: PF.Dot, alpha: 0.35 });
        break;
      }
      case 'quakelet':
        if (!close) return;
        this.burst(e.x, y + 0.1, e.z, 6, { color: 0xa89a84, frame: PF.Smoke, speed: 1.4, up: 0.3, life: 0.8, size: 0.3, size1: 0.7, drag: 2, alpha: 0.7 });
        this.rig.shake = Math.max(this.rig.shake, 0.15);
        break;
      case 'rise':
        this.burst(e.x, y + 0.3, e.z, 12, { color: 0x3a2e48, frame: PF.Smoke, speed: 0.8, up: 0.8, life: 1.5, size: 0.4, size1: 0.8, alpha: 0.8 });
        break;
      case 'shell': case 'bombdrop': {
        const gy1 = this.gy(sim, e.tx!, e.tz!);
        const y0 = (e.y ?? 0.5) + this.gy(sim, e.x, e.z);
        const dur = Math.max(0.2, (e.a ?? 5) * 0.1);
        if (e.t === 'shell') {
          const big = e.b === 1;
          this.shells.push({ x0: e.x, z0: e.z, x1: e.tx!, z1: e.tz!, y0, y1: gy1 + 0.1, t: 0, dur, arc: big ? 0.28 : 0.12 });
          if (close) {
            this.burst(e.x, y0, e.z, big ? 10 : 6, { color: 0xffd27a, frame: PF.Flame, speed: 1.4, up: 0.6, life: 0.25, size: big ? 0.5 : 0.3, size1: 0.05, add: true, drag: 4 });
            this.burst(e.x, y0, e.z, big ? 12 : 6, { color: 0xd8d0c4, frame: PF.Smoke, speed: 1.2, up: 0.5, life: 1.4, size: 0.3, size1: big ? 1.1 : 0.7, drag: 2, alpha: 0.75 });
            this.flashAt(e.x, y0 + 0.5, e.z, big ? 14 : 8, big ? 9 : 6);
            this.rig.shake = Math.max(this.rig.shake, big ? 0.16 : 0.09);
          }
        } else this.shells.push({ x0: e.x, z0: e.z, x1: e.tx!, z1: e.tz!, y0, y1: gy1, t: 0, dur, arc: 0 });
        break;
      }
      case 'shot': {
        if (!close) return;
        const ty = this.gy(sim, e.tx!, e.tz!) + 0.3 + (e.y ?? 0);
        this.burst(e.x, y + 0.42, e.z, 3, { color: 0xffe08a, frame: PF.Flame, speed: 0.8, up: 0.2, life: 0.12, size: 0.18, size1: 0.02, add: true });
        this.burst(e.x, y + 0.42, e.z, 3, { color: 0xe8e2d8, frame: PF.Smoke, speed: 0.4, up: 0.3, life: 0.9, size: 0.12, size1: 0.35, drag: 2, alpha: 0.6 });
        for (let i = 1; i <= 6; i++) { const k = i / 7; this.add.spawn(e.x + (e.tx! - e.x) * k, y + 0.42 + (ty - y - 0.42) * k, e.z + (e.tz! - e.z) * k, 0, 0, 0, { life: 0.06 + k * 0.05, size: 0.06, color: 0xfff2b0, frame: PF.Dot }); }
        break;
      }
      case 'study':
        if (!close || this.rig.z01 > 0.45) return;
        this.burst(e.x, y + 0.65, e.z, 2, { color: 0x9fd8ff, frame: PF.Spark, speed: 0.2, up: 0.7, life: 0.9, size: 0.08, add: true, drag: 1 });
        break;
      case 'fish':
        if (!close) return;
        this.burst(e.x, y + 0.05, e.z, 6, { color: 0xd8f0ff, frame: PF.Drop, speed: 0.8, up: 2.2, life: 0.6, size: 0.08, grav: -9 });
        this.burst(e.x, y + 0.3, e.z, 1, { color: 0x9ac8e8, frame: PF.Chip, speed: 0.3, up: 2.5, life: 0.7, size: 0.1, grav: -8 });
        break;
      case 'splash':
        this.burst(e.x, y + 0.05, e.z, 8, { color: 0xd8f0ff, frame: PF.Drop, speed: 1, up: 2, life: 0.6, size: 0.08, grav: -9 });
        break;
      case 'arrest': case 'jail':
        this.burst(e.x, y + 0.6, e.z, 8, { color: 0x6aa0ff, frame: PF.Spark, speed: 0.9, up: 1.2, life: 0.6, size: 0.1, add: true, drag: 2 });
        break;
      case 'freed':
        this.burst(e.x, y + 0.5, e.z, 8, { color: 0xfff2a0, frame: PF.Spark, speed: 0.8, up: 1.6, life: 0.7, size: 0.1, add: true, drag: 2 });
        break;
      case 'riot': case 'crime':
        if (!close) return;
        this.burst(e.x, y + 0.7, e.z, 4, { color: 0xff5a4a, frame: PF.Spark, speed: 0.6, up: 1.2, life: 0.5, size: 0.1, add: true });
        break;
      case 'trade': case 'loot':
        this.burst(e.x, y + 0.6, e.z, e.t === 'loot' ? 12 : 8, { color: 0xffd34a, frame: PF.Chip, speed: 1.2, up: 2.4, life: 0.9, size: 0.07, grav: -7 });
        this.burst(e.x, y + 0.6, e.z, 4, { color: 0xfff2a0, frame: PF.Spark, speed: 0.6, up: 1.2, life: 0.5, size: 0.1, add: true });
        break;
      case 'machine':
        this.burst(e.x, y + 0.3, e.z, 10, { color: 0xd8d0c4, frame: PF.Smoke, speed: 1.2, up: 0.4, life: 1.0, size: 0.3, size1: 0.7, drag: 2.5, alpha: 0.7 });
        this.burst(e.x, y + 0.6, e.z, 10, { color: 0xffe9a0, frame: PF.Spark, speed: 1.2, up: 2, life: 0.7, size: 0.1, add: true, drag: 1.5 });
        break;
      case 'wreck':
        for (let i = 0; i < 6; i++) this.physics.spawnDebris(new THREE.Vector3(e.x, y + 0.4, e.z), new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 3, (Math.random() - 0.5) * 5), 0x4a4e54, 0.16, 4);
        this.burst(e.x, y + 0.5, e.z, 14, { color: 0x2f2c2a, frame: PF.Smoke, speed: 0.8, up: 1.2, life: 3, size: 0.5, size1: 1.4, drag: 0.8, alpha: 0.8 });
        break;
      case 'landfall': case 'settlers':
        if (!close) return;
        this.burst(e.x, y + 0.5, e.z, 8, { color: 0xffe9a0, frame: PF.Spark, speed: 0.8, up: 1.4, life: 0.8, size: 0.1, add: true, drag: 1.5 });
        break;
      case 'breath': {
        const sy = (e.y ?? 2) + this.gy(sim, e.x, e.z) + 0.4;
        const dx = (e.tx! - e.x) / 5, dz = (e.tz! - e.z) / 5;
        for (let i = 0; i < 26; i++) {
          const k = Math.random();
          const sp = 5 + Math.random() * 3;
          this.add.spawn(e.x + dx * 0.6, sy, e.z + dz * 0.6, dx * sp * (0.7 + k * 0.5) + (Math.random() - 0.5) * 1.5, -sy * 0.55 + (Math.random() - 0.5), dz * sp * (0.7 + k * 0.5) + (Math.random() - 0.5) * 1.5, { life: 0.55, size: 0.25, size1: 0.9, color: Math.random() < 0.4 ? 0xffe08a : 0xff6a1a, frame: PF.Flame, drag: 1.2 });
        }
        this.flashAt(e.x + dx * 2, sy - 1, e.z + dz * 2, 14, 10);
        break;
      }
      case 'ash':
        for (let i = 0; i < 6; i++) this.alpha.spawn(e.x + (Math.random() - 0.5) * 1.5, y + 0.5, e.z + (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 0.8, 3 + Math.random() * 2, (Math.random() - 0.5) * 0.8, { life: 5, size: 1.2, size1: 3.5, color: Math.random() < 0.3 ? 0x8a3a1a : 0x3a3432, frame: PF.Smoke, alpha: 0.8, drag: 0.35 });
        if (Math.random() < 0.5) this.burst(e.x, y + 0.6, e.z, 6, { color: 0xffa040, frame: PF.Flame, speed: 1.2, up: 4, life: 0.8, size: 0.5, size1: 0.1, add: true, grav: -3 });
        break;
      case 'drought':
        this.ring(e.x, y + 0.2, e.z, (e.a ?? 18) * 1.1, 1.6);
        this.burst(e.x, y + 0.3, e.z, 30, { color: 0xd8b87a, frame: PF.Smoke, speed: (e.a ?? 18) * 0.5, up: 0.4, life: 2.4, size: 0.8, size1: 2, drag: 1.4, alpha: 0.55, spread: 4 });
        break;
      case 'flood':
        this.ring(e.x, y + 0.2, e.z, (e.a ?? 11) * 1.3, 1.2);
        this.burst(e.x, y + 0.3, e.z, 40, { color: 0xd8f0ff, frame: PF.Drop, speed: (e.a ?? 11) * 0.4, up: 3, life: 1.2, size: 0.14, grav: -8, spread: 6 });
        this.rig.shake = Math.max(this.rig.shake, 0.4);
        break;
      case 'launch': {
        // a flash high in the sky where the ordnance appears
        const big = e.a === 1;
        const sy = big ? 70 : 34;
        this.burst(e.x, sy, e.z, big ? 18 : 8, { color: 0xfff2c0, frame: PF.Spark, speed: big ? 4 : 2, up: 0, life: 0.6, size: big ? 0.6 : 0.3, add: true, drag: 2 });
        this.burst(e.x, sy, e.z, big ? 12 : 5, { color: 0xd8d4cc, frame: PF.Smoke, speed: 1.5, up: 0.3, life: 2.5, size: 1.2, size1: 3, drag: 1, alpha: 0.6 });
        if (big) this.flashAt(e.x, sy, e.z, 60, 120);
        break;
      }
      case 'nuke': {
        const r = e.a ?? 12;
        this.screenFlash = 1;
        this.flashAt(e.x, y + 20, e.z, 400, 160);
        this.rig.shake = Math.max(this.rig.shake, 1.6);
        // stem and cap of the mushroom cloud
        for (let i = 0; i < 46; i++) this.alpha.spawn(e.x + (Math.random() - 0.5) * 2, y + 0.5 + i * 0.35, e.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4, { life: 7, size: 1.6, size1: 4, color: 0x7a6a5e, frame: PF.Smoke, alpha: 0.85, drag: 0.5 });
        for (let i = 0; i < 70; i++) { const a = Math.random() * Math.PI * 2, rr = Math.random() * 5; this.alpha.spawn(e.x + Math.cos(a) * rr, y + 15 + Math.random() * 3, e.z + Math.sin(a) * rr, Math.cos(a) * 1.6, 0.6, Math.sin(a) * 1.6, { life: 9, size: 3, size1: 7, color: Math.random() < 0.4 ? 0xb8846a : 0x8a7a6e, frame: PF.Smoke, alpha: 0.8, drag: 0.4 }); }
        for (let i = 0; i < 50; i++) this.add.spawn(e.x + (Math.random() - 0.5) * 6, y + 1 + Math.random() * 14, e.z + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3, { life: 2.5, size: 3, size1: 0.5, color: Math.random() < 0.5 ? 0xffb050 : 0xffe8a0, frame: PF.Flame, drag: 0.8 });
        this.ring(e.x, y + 0.2, e.z, r * 4, 1.6);
        this.ring(e.x, y + 0.4, e.z, r * 2.5, 1.0);
        break;
      }
      case 'era': {
        const k = sim.kingdoms.get(e.a ?? -1);
        const col = k ? KINGDOM_COLORS[k.color][0] : 0xffe9a0;
        for (let j = 0; j < 5; j++) {
          const ox = (Math.random() - 0.5) * 6, oz = (Math.random() - 0.5) * 6, oy = 4 + Math.random() * 3;
          this.burst(e.x + ox, y + oy, e.z + oz, 22, { color: j % 2 ? col : 0xfff2a0, frame: PF.Spark, speed: 2.6, up: 0.6, life: 1.4, size: 0.14, add: true, grav: -2, drag: 1.2 });
        }
        this.ring(e.x, y + 0.2, e.z, 14, 1.2);
        break;
      }
      case 'fling': break; // physics already launched it inside the simulation tick
      case 'deliver':
        if (!close || this.rig.z01 > 0.45) return;
        this.burst(e.x, y + 0.4, e.z, 2, { color: 0xffe9a0, frame: PF.Spark, speed: 0.3, up: 0.8, life: 0.4, size: 0.06, add: true });
        break;
    }
  }

  private ring(x: number, y: number, z: number, r: number, life: number) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y * U.uHeightScale.value, z);
    this.group.add(m);
    this.rings.push({ mesh: m, t: 0, max: life, r });
  }

  flashAt(x: number, y: number, z: number, intensity: number, dist: number) {
    this.flash.position.set(x, y * U.uHeightScale.value, z);
    this.flash.intensity = intensity; this.flash.distance = dist;
    this.flashT = 0.35;
  }

  bolt(sim: Sim, x: number, z: number) {
    const gy = this.gy(sim, x, z);
    const pts: THREE.Vector3[] = [];
    let px = x + (Math.random() - 0.5) * 6, pz = z + (Math.random() - 0.5) * 6, py = gy + 45;
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const tx = x + (px - x) * (1 - t), tz = z + (pz - z) * (1 - t);
      pts.push(new THREE.Vector3(tx + (i === n ? 0 : (Math.random() - 0.5) * 1.6), py + (gy - py) * t, tz + (i === n ? 0 : (Math.random() - 0.5) * 1.6)));
    }
    const geom = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), 60, 0.12, 4, false);
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: 0xf2f6ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.scale.y = U.uHeightScale.value;
    this.group.add(mesh);
    this.bolts.push({ mesh, life: 0.35 });
    this.burst(x, gy + 0.2, z, 22, { color: 0xc8e0ff, frame: PF.Spark, speed: 3, up: 3, life: 0.5, size: 0.2, add: true, grav: -8 });
    this.burst(x, gy + 0.2, z, 10, { color: 0x4a4a52, frame: PF.Smoke, speed: 1, up: 0.8, life: 1.5, size: 0.4, size1: 0.9, alpha: 0.7 });
    this.flashAt(x, gy + 6, z, 80, 40);
    this.screenFlash = Math.max(this.screenFlash, 0.5);
    this.rig.shake = Math.max(this.rig.shake, 0.4);
  }

  // ---------------------------------------------------------------- per-frame
  update(sim: Sim, dt: number, alpha: number, unitPos: (id: number, out: THREE.Vector3) => THREE.Vector3 | null) {
    const hs = U.uHeightScale.value;
    const w = sim.world;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    // fire on tiles near the camera
    this.fireAcc += dt;
    if (this.fireAcc > 0.06 && fireTiles.size) {
      this.fireAcc = 0;
      let spawned = 0;
      for (const t of fireTiles) {
        const x = (t % w.W) + 0.5, z = ((t / w.W) | 0) + 0.5;
        if (!this.near(x, z, 1.2)) continue;
        if (Math.random() > 0.55) continue;
        const f = w.fire[t] / 255;
        const tree = w.feat[t] >= 1 && w.feat[t] <= 8;
        const y = heightCubic(w.height, w.W, w.H, x, z) + (tree ? 0.5 : 0.05);
        const fx0 = x + (Math.random() - 0.5) * 0.7, fz0 = z + (Math.random() - 0.5) * 0.7, sz = (tree ? 0.55 : 0.35) * (0.5 + f);
        // layered flame: red-orange body, a hot yellow-white core, sparks drifting up, then smoke
        this.add.spawn(fx0, y, fz0, (Math.random() - 0.5) * 0.2, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.2, { life: 0.65, size: sz, size1: 0.05, color: Math.random() < 0.4 ? 0xff5a1a : 0xff8a2a, frame: PF.Flame, rot: (Math.random() - 0.5) * 0.4 });
        this.add.spawn(fx0, y + 0.05, fz0, 0, 0.9 + Math.random() * 0.4, 0, { life: 0.4, size: sz * 0.55, size1: 0.02, color: 0xfff0b0, frame: PF.Flame, rot: (Math.random() - 0.5) * 0.3 });
        if (Math.random() < 0.25) this.add.spawn(fx0, y + 0.3, fz0, (Math.random() - 0.5) * 0.6, 1.4 + Math.random(), (Math.random() - 0.5) * 0.6, { life: 1.4, size: 0.05, color: 0xffb04a, frame: PF.Spark, drag: 0.5, vrot: 3 });
        if (Math.random() < 0.3) this.alpha.spawn(x, y + 0.6, z, 0.15, 0.7, 0.05, { life: 2.6, size: 0.45, size1: 1.4, color: Math.random() < 0.5 ? 0x3a3532 : 0x5a524c, frame: PF.Smoke, alpha: 0.55, drag: 0.4 });
        if (++spawned > 160) break;
      }
    }
    // burning buildings; factory chimneys
    for (const b of sim.buildings.values()) {
      if (b.kind === 13 && b.progress >= 1 && Math.random() < dt * 6) {
        const cx = b.x + b.size / 2, cz = b.z + b.size / 2;
        if (this.near(cx, cz, 1.2)) {
          const [lx, lz, h] = Math.random() < 0.5 ? [-0.85, -0.95, 1.74] : [-0.35, -0.95, 2.04];
          const a = (b.rot * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
          const x = cx + lx * ca + lz * sa, z = cz - lx * sa + lz * ca;
          const y = heightCubic(w.height, w.W, w.H, cx, cz) + h + 0.1;
          this.alpha.spawn(x, y, z, 0.25, 0.7, 0.1, { life: 3.2, size: 0.25, size1: 1.1, color: 0x5a5652, frame: PF.Smoke, alpha: 0.55, drag: 0.3 });
        }
      }
      if (b.fire <= 0 || Math.random() > 0.5) continue;
      const cx = b.x + b.size / 2, cz = b.z + b.size / 2;
      if (!this.near(cx, cz)) continue;
      const y = heightCubic(w.height, w.W, w.H, cx, cz) + 0.5 + Math.random() * b.size * 0.4;
      const bx = cx + (Math.random() - 0.5) * b.size * 0.8, bz = cz + (Math.random() - 0.5) * b.size * 0.8;
      this.add.spawn(bx, y, bz, 0, 1, 0, { life: 0.75, size: 0.65, size1: 0.1, color: Math.random() < 0.5 ? 0xff6a1a : 0xff8a2a, frame: PF.Flame });
      this.add.spawn(bx, y + 0.1, bz, 0, 1.1, 0, { life: 0.45, size: 0.32, size1: 0.04, color: 0xfff0b0, frame: PF.Flame });
      if (Math.random() < 0.35) this.add.spawn(bx, y + 0.5, bz, (Math.random() - 0.5) * 0.8, 1.6 + Math.random(), (Math.random() - 0.5) * 0.8, { life: 1.6, size: 0.06, color: 0xffb04a, frame: PF.Spark, drag: 0.4, vrot: 3 });
      if (Math.random() < 0.4) this.alpha.spawn(cx, y + 0.8, cz, 0.2, 0.9, 0.1, { life: 3, size: 0.6, size1: 1.8, color: 0x3a3632, frame: PF.Smoke, alpha: 0.6, drag: 0.3 });
    }
    // running feet kick up dust (close up only)
    if (this.rig.z01 < 0.45) for (const u of sim.units) {
      if ((u.anim !== 4 && !(u.anim === 1 && u.task?.k === 'march')) || Math.random() > dt * 3 || u.y > 0.3) continue;
      if (!this.near(u.x, u.z, 0.6)) continue;
      const t = w.tileAt(u.x, u.z);
      if (t < 0 || w.isWater(t)) continue;
      const m = w.mat[t];
      const col = m === 4 || m === 0 ? 0xe6d3a0 : m === 5 ? 0xf2f6fa : m === 6 ? 0xa8a29a : 0xb8a07a;
      this.alpha.spawn(u.x - Math.sin(u.dir) * 0.15, this.gy(sim, u.x, u.z) + 0.05, u.z - Math.cos(u.dir) * 0.15, (Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4, { life: 0.7, size: 0.12, size1: 0.3, color: col, frame: PF.Smoke, alpha: 0.55, drag: 2 });
    }
    // burning creatures
    for (const u of sim.units) {
      if (!(u.flags & UF.Burning) || Math.random() > 0.4) continue;
      const pp = unitPos(u.id, p);
      if (pp) this.add.spawn(pp.x, pp.y + 0.3, pp.z, 0, 1, 0, { life: 0.4, size: 0.3, size1: 0.05, color: 0xff8a2a, frame: PF.Flame });
    }
    this.alpha.update(dt);
    this.add.update(dt);

    // emotes
    let ne = 0;
    if (this.rig.z01 < 0.5) {
      const pa = this.emoteAttr.pos.array as Float32Array, da = this.emoteAttr.data.array as Float32Array;
      for (const u of sim.units) {
        if (!u.emote || u.flags & UF.Dead || ne >= 2048) continue;
        if (!this.near(u.x, u.z, 0.9)) continue;
        const pp = unitPos(u.id, p);
        if (!pp) continue;
        const def = SPECIES[u.sp];
        pa[ne * 3] = pp.x; pa[ne * 3 + 1] = pp.y + 0.62 * def.size * 1.4 + 0.35; pa[ne * 3 + 2] = pp.z;
        da[ne * 2] = u.emote; da[ne * 2 + 1] = Math.min(u.emoteT, 25 - Math.min(25, u.emoteT)) / 25 + 0.2;
        ne++;
      }
      this.emoteAttr.pos.needsUpdate = true; this.emoteAttr.data.needsUpdate = true;
    }
    (this.emotes.geometry as THREE.InstancedBufferGeometry).instanceCount = ne;
    (this.emotes.material as THREE.ShaderMaterial).uniforms.uSize.value = 0.42;

    // arrows
    let na = 0;
    for (const a of this.arrows) {
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const x = a.x0 + (a.x1 - a.x0) * k, z = a.z0 + (a.z1 - a.z0) * k;
      const arc = Math.sin(k * Math.PI) * Math.hypot(a.x1 - a.x0, a.z1 - a.z0) * 0.18;
      const y = a.y0 + (a.y1 - a.y0) * k + arc;
      const dy = (a.y1 - a.y0) / a.dur + Math.cos(k * Math.PI) * Math.PI * Math.hypot(a.x1 - a.x0, a.z1 - a.z0) * 0.18 / a.dur;
      const hdist = Math.hypot(a.x1 - a.x0, a.z1 - a.z0) / a.dur;
      q.setFromEuler(new THREE.Euler(-Math.atan2(dy, hdist), Math.atan2(a.x1 - a.x0, a.z1 - a.z0), 0, 'YXZ'));
      p.set(x, y * hs, z); s.setScalar(1);
      m.compose(p, q, s);
      if (na < 256) this.arrowMesh.setMatrixAt(na++, m);
    }
    this.arrows = this.arrows.filter((a) => a.t < a.dur);
    this.arrowMesh.count = na; this.arrowMesh.instanceMatrix.needsUpdate = true;

    // shells (arc) and bombs (fall); a smoke trail marks their flight
    let ns = 0;
    for (const a of this.shells) {
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const L = Math.hypot(a.x1 - a.x0, a.z1 - a.z0);
      const x = a.x0 + (a.x1 - a.x0) * k, z = a.z0 + (a.z1 - a.z0) * k;
      const bomb = a.arc === 0;
      const y = bomb ? a.y0 + (a.y1 - a.y0) * k * k : a.y0 + (a.y1 - a.y0) * k + Math.sin(k * Math.PI) * L * (a.arc ?? 0.12);
      const yaw = Math.atan2(a.x1 - a.x0, a.z1 - a.z0);
      const pitch = bomb ? Math.PI / 2 : -Math.atan2(Math.cos(k * Math.PI) * Math.PI * L * (a.arc ?? 0.12) + (a.y1 - a.y0), Math.max(0.01, L));
      q.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
      p.set(x, y * hs, z); s.setScalar(bomb ? 1.6 : 1);
      m.compose(p, q, s);
      if (ns < 128) this.shellMesh.setMatrixAt(ns++, m);
      if (Math.random() < 0.7) this.alpha.spawn(x, y, z, 0, 0.2, 0, { life: 0.7, size: 0.1, size1: 0.3, color: 0xcfc8bc, frame: PF.Smoke, alpha: 0.5, drag: 1 });
    }
    this.shells = this.shells.filter((a) => a.t < a.dur);
    for (const a of this.spells) {
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const x = a.x0 + (a.x1 - a.x0) * k, z = a.z0 + (a.z1 - a.z0) * k;
      const y = a.y0 + (a.y1 - a.y0) * k + Math.sin(k * Math.PI) * (a.arc ?? 0) * Math.hypot(a.x1 - a.x0, a.z1 - a.z0);
      this.add.spawn(x, y, z, 0, 0, 0, { life: 0.08, size: 0.32, size1: 0.2, color: 0xffd27a, frame: PF.Flame });
      this.add.spawn(x, y, z, (Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4, { life: 0.35, size: 0.2, size1: 0.02, color: 0xff7a2a, frame: PF.Flame });
    }
    this.spells = this.spells.filter((a) => a.t < a.dur);
    // acid rain: sickly green streaks under a jaundiced cloud
    for (const a of sim.acidRains) {
      if (!this.near(a.x, a.z, 2)) continue;
      for (let i = 0; i < 6; i++) {
        const ang = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * a.r;
        const x = a.x + Math.cos(ang) * d, z = a.z + Math.sin(ang) * d;
        this.add.spawn(x, this.gy(sim, x, z) + 5, z, 0, -9, 0, { life: 0.55, size: 0.07, size1: 0.05, color: 0xb8f04a, frame: PF.Drop });
      }
      if (Math.random() < dt * 4) {
        const ang = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * a.r * 0.8;
        this.alpha.spawn(a.x + Math.cos(ang) * d, this.gy(sim, a.x, a.z) + 5.5, a.z + Math.sin(ang) * d, 0.1, 0, 0.05, { life: 4, size: 2.2, size1: 3, color: 0x8aa83a, frame: PF.Smoke, alpha: 0.4, drag: 0.2 });
        const x = a.x + Math.cos(ang) * d, z = a.z + Math.sin(ang) * d;
        this.alpha.spawn(x, this.gy(sim, x, z) + 0.05, z, 0, 0.3, 0, { life: 0.9, size: 0.2, size1: 0.45, color: 0xd8ff8a, frame: PF.Smoke, alpha: 0.5 });
      }
    }
    this.shellMesh.count = ns; this.shellMesh.instanceMatrix.needsUpdate = true;

    // ordnance in flight + target rings on the ground
    let nn = 0, nb = 0, nrt = 0;
    const down = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    for (const ms of sim.missiles) {
      const big = ms.kind === 'nuke';
      const arming = ms.arm > 0;
      const wob = arming ? Math.sin(U.uTime.value * 6 + ms.id) * 0.08 : 0;
      q.copy(down).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(wob, U.uTime.value * (arming ? 1.5 : 4), wob)));
      p.set(ms.x, ms.y * hs, ms.z); s.setScalar(big ? 1.6 : 1.4);
      m.compose(p, q, s);
      if (big) this.nukeMesh.setMatrixAt(nn++, m); else this.bombMesh.setMatrixAt(nb++, m);
      // smoke trail (and a rocket glow while diving)
      if (!arming) {
        this.alpha.spawn(ms.x + (Math.random() - 0.5) * 0.2, ms.y + (big ? 2 : 0.8), ms.z + (Math.random() - 0.5) * 0.2, 0, 0.5, 0, { life: big ? 3 : 1.6, size: big ? 0.8 : 0.35, size1: big ? 2.8 : 1, color: 0xd8d4cc, frame: PF.Smoke, alpha: 0.7, drag: 0.6 });
        if (big) this.add.spawn(ms.x, ms.y + 2.1, ms.z, 0, 2, 0, { life: 0.25, size: 1.2, size1: 0.3, color: 0xffb050, frame: PF.Flame });
      }
      // target ring pulses faster as impact nears
      const gy = this.gy(sim, ms.x, ms.z);
      const R = big ? 11 : 2.6;
      const k = Math.min(1, Math.max(0, (ms.y - gy) / (big ? 70 : 34)));
      for (const f of [1, 0.55]) {
        const pulse = 1 + Math.sin(U.uTime.value * (10 - k * 6)) * 0.06;
        p.set(ms.x, gy * hs + 0.15, ms.z); q.identity(); s.set(R * f * pulse, 1, R * f * pulse);
        m.compose(p, q, s);
        if (nrt < 48) this.reticles.setMatrixAt(nrt++, m);
      }
    }
    this.nukeMesh.count = nn; this.nukeMesh.instanceMatrix.needsUpdate = true;
    this.bombMesh.count = nb; this.bombMesh.instanceMatrix.needsUpdate = true;
    this.reticles.count = nrt; this.reticles.instanceMatrix.needsUpdate = true;
    (this.reticles.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(U.uTime.value * 12) * 0.25;

    // meteors
    let nm = 0;
    for (const me of sim.meteors) {
      const y = me.y;
      p.set(me.x, y * hs, me.z); q.setFromEuler(new THREE.Euler(U.uTime.value * 2, U.uTime.value * 1.3, 0)); s.setScalar(me.size);
      m.compose(p, q, s);
      this.meteorMesh.setMatrixAt(nm++, m);
      for (let i = 0; i < 3; i++) this.add.spawn(me.x + (Math.random() - 0.5) * 0.6, y + 0.5, me.z + (Math.random() - 0.5) * 0.6, 0, 4, 0, { life: 0.5, size: 1.2 * me.size, size1: 0.2, color: 0xff8a2a, frame: PF.Flame });
      this.alpha.spawn(me.x, y + 1, me.z, 0, 2, 0, { life: 1.8, size: 0.8 * me.size, size1: 2.2 * me.size, color: 0x4a4440, frame: PF.Smoke, alpha: 0.6 });
    }
    this.meteorMesh.count = nm; this.meteorMesh.instanceMatrix.needsUpdate = true;

    // tornadoes
    let nt = 0;
    for (const tn of sim.tornadoes) {
      const gy = this.gy(sim, tn.x, tn.z);
      p.set(tn.x, gy * hs, tn.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), U.uTime.value * 4); s.set(1, Math.min(1, (500 - tn.life) / 30) * Math.min(1, tn.life / 40), 1);
      m.compose(p, q, s);
      this.tornadoMesh.setMatrixAt(nt++, m);
      if (Math.random() < 0.8) {
        const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 1.5;
        this.alpha.spawn(tn.x + Math.cos(a) * r, gy + Math.random() * 2, tn.z + Math.sin(a) * r, -Math.sin(a) * 4, 2.5, Math.cos(a) * 4, { life: 1.2, size: 0.5, size1: 1.2, color: 0x9a9084, frame: PF.Smoke, alpha: 0.5 });
      }
    }
    this.tornadoMesh.count = nt; this.tornadoMesh.instanceMatrix.needsUpdate = true;

    // debris
    let nd = 0;
    const col = this.debrisMesh.instanceColor!.array as Float32Array;
    for (const d of this.physics.debris) {
      if (nd >= 256) break;
      const t = d.body.translation(), r = d.body.rotation();
      p.set(t.x, t.y * hs, t.z); q.set(r.x, r.y, r.z, r.w);
      const fade = Math.min(1, d.life / 0.6);
      s.copy(d.size).multiplyScalar(fade);
      m.compose(p, q, s);
      this.debrisMesh.setMatrixAt(nd, m);
      col[nd * 3] = d.color.r; col[nd * 3 + 1] = d.color.g; col[nd * 3 + 2] = d.color.b;
      nd++;
    }
    this.debrisMesh.count = nd; this.debrisMesh.instanceMatrix.needsUpdate = true; this.debrisMesh.instanceColor!.needsUpdate = true;

    // bolts / rings / flash
    for (const b of this.bolts) { b.life -= dt; (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, b.life / 0.35) * (0.6 + Math.random() * 0.4); }
    for (const b of this.bolts.filter((b) => b.life <= 0)) { this.group.remove(b.mesh); b.mesh.geometry.dispose(); }
    this.bolts = this.bolts.filter((b) => b.life > 0);
    for (const r of this.rings) {
      r.t += dt; const k = r.t / r.max;
      r.mesh.scale.setScalar(0.3 + k * r.r);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    }
    for (const r of this.rings.filter((r) => r.t >= r.max)) { this.group.remove(r.mesh); r.mesh.geometry.dispose(); }
    this.rings = this.rings.filter((r) => r.t < r.max);
    if (this.flashT > 0) { this.flashT -= dt; this.flash.intensity *= Math.exp(-dt * 10); if (this.flashT <= 0) this.flash.intensity = 0; }
    this.screenFlash = Math.max(0, this.screenFlash - dt * 2.5);

    // clouds: drift, fade out as the camera descends through them
    const camY = this.rig.camera.position.y;
    let nc = 0;
    const W = w.W, H = w.H;
    for (const c of this.cloudData) {
      c.x += c.v * dt; c.z += c.v * 0.3 * dt;
      if (c.x > W * 1.25) c.x = -W * 0.25;
      if (c.z > H * 1.25) c.z = -H * 0.25;
      p.set(c.x, c.y, c.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.r); s.set(c.s * c.k, c.s * 0.8, c.s / c.k);
      m.compose(p, q, s);
      this.clouds.setMatrixAt(nc++, m);
    }
    this.clouds.count = nc; this.clouds.instanceMatrix.needsUpdate = true;
    const cOp = THREE.MathUtils.smoothstep(camY, 60, 120);
    (this.clouds.material as THREE.MeshStandardMaterial).opacity = (0.85 - 0.35 * this.rig.mapMode * (1 - this.rig.orbit)) * cOp;
    this.clouds.visible = cOp > 0.01;
    this.clouds.castShadow = cOp > 0.3;
    // rain clouds + rain
    let nr = 0;
    let rainHere = 0;
    const f = this.rig.focus;
    for (const rc of sim.rainClouds) {
      if (nr >= 32) break;
      const life = Math.min(1, rc.life / 60);
      p.set(rc.x, 22, rc.z); q.identity(); s.set(rc.r * 0.55 * life, rc.r * 0.35 * life, rc.r * 0.55 * life);
      m.compose(p, q, s);
      this.rainClouds.setMatrixAt(nr++, m);
      const d = Math.hypot(rc.x - f.x, rc.z - f.z);
      if (d < rc.r + this.rig.V) rainHere = Math.max(rainHere, 1 - Math.max(0, d - rc.r) / (this.rig.V + 1));
      // rain streaks under the cloud (only when reasonably close)
      if (this.near(rc.x, rc.z, 1.4)) {
        const n = Math.round(rc.r * 4 * dt * 60 / 4);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * rc.r;
          const x = rc.x + Math.cos(a) * rr, z = rc.z + Math.sin(a) * rr;
          this.alpha.spawn(x, 18 + Math.random() * 4, z, 0.6, -28, 0, { life: 0.7, size: 0.35, color: 0xbcd4f0, frame: PF.Drop, alpha: 0.55, rot: 0.03 });
        }
      }
    }
    this.rainClouds.count = nr; this.rainClouds.instanceMatrix.needsUpdate = true;
    (this.rainClouds.material as THREE.MeshStandardMaterial).opacity = 0.9 * THREE.MathUtils.smoothstep(camY, 26, 50);
    U.uRain.value += (rainHere * 0.6 - U.uRain.value) * Math.min(1, dt);
    void alpha;
  }
}
