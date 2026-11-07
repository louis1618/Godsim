import * as THREE from 'three';
import { Sim } from '../sim/sim';
import { KINGDOM_COLORS, isCiv, isVehicle } from '../sim/defs';
import { UF } from '../sim/entities';
import { CameraRig } from './cameraRig';
import { U } from './shared';

/**
 * War map overlay:
 *  - a curved arrow for every campaign, in the attacker's colour, from where its army actually is
 *    (the centre of the soldiers marching on the target; the capital before they set out) to the
 *    target town; chevrons stream along it toward the target
 *  - a pulsing ring on every town under attack
 *  - front lines: the shared border of two kingdoms at war glows red
 * Drawn on top of the terrain; strongest in map view, faint up close.
 */
const MAX_ARROWS = 24, SEG = 28;

export class WarOverlay {
  readonly group = new THREE.Group();
  private arrowMesh: THREE.Mesh;
  private arrowGeo = new THREE.BufferGeometry();
  private ringMesh: THREE.InstancedMesh;
  private front: THREE.LineSegments;
  private frontGeo = new THREE.BufferGeometry();
  private arrowMat: THREE.ShaderMaterial;
  private frontMat: THREE.ShaderMaterial;
  private acc = 1;
  /** campaigns found at the last refresh (also used by the UI) */
  campaigns: { from: number; to: number; ax: number; az: number; tx: number; tz: number; soldiers: number; color: number }[] = [];
  frontTiles = 0;

  constructor() {
    this.arrowMat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: U.uTime, uOpacity: { value: 1 }, uHeightScale: U.uHeightScale },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute vec2 aUv;
        uniform float uHeightScale;
        varying vec3 vC; varying vec2 vUv;
        void main() { vC = aColor; vUv = aUv; vec3 p = position; p.y *= uHeightScale; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uOpacity;
        varying vec3 vC; varying vec2 vUv;
        void main() {
          // vUv.x: 0 tail .. 1 head (arrowhead beyond 0.86); vUv.y: -1..1 across
          float head = smoothstep(0.86, 0.87, vUv.x);
          float w = mix(1.0, 1.0 - (vUv.x - 0.86) / 0.14, head);
          if (abs(vUv.y) > w) discard;
          float edge = smoothstep(w - 0.28, w - 0.12, abs(vUv.y));
          // chevrons streaming toward the target
          float chev = fract(vUv.x * 9.0 - abs(vUv.y) * 0.35 - uTime * 0.9);
          float band = smoothstep(0.0, 0.08, chev) * (1.0 - smoothstep(0.42, 0.5, chev));
          vec3 col = mix(vC, vec3(1.0), band * 0.35 * (1.0 - head));
          col = mix(col, vec3(0.1, 0.07, 0.12), edge);
          float a = uOpacity * (0.25 + 0.75 * smoothstep(0.0, 0.25, vUv.x));
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.arrowMesh = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    this.arrowMesh.frustumCulled = false; this.arrowMesh.renderOrder = 30;
    const ringGeo = new THREE.RingGeometry(0.82, 1, 48); ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
    this.ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, 32);
    this.ringMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(32 * 3), 3);
    this.ringMesh.frustumCulled = false; this.ringMesh.renderOrder = 29; this.ringMesh.count = 0;
    this.frontMat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uTime: U.uTime, uOpacity: { value: 1 }, uHeightScale: U.uHeightScale },
      vertexShader: /* glsl */ `
        uniform float uHeightScale; varying float vD;
        void main() { vD = position.x + position.z; vec3 p = position; p.y *= uHeightScale; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uOpacity; varying float vD;
        void main() {
          float pulse = 0.65 + 0.35 * sin(uTime * 5.0 + vD * 0.6);
          gl_FragColor = vec4(mix(vec3(1.0, 0.25, 0.15), vec3(1.0, 0.85, 0.3), 0.5 + 0.5 * sin(vD * 1.7 - uTime * 3.0)), uOpacity * pulse);
          #include <colorspace_fragment>
        }`,
    });
    this.front = new THREE.LineSegments(this.frontGeo, this.frontMat);
    this.front.frustumCulled = false; this.front.renderOrder = 28;
    this.group.add(this.arrowMesh, this.ringMesh, this.front);
  }

  update(sim: Sim, rig: CameraRig, dt: number) {
    // visible from mid zoom upward; a faint hint close by
    const vis = THREE.MathUtils.smoothstep(rig.z01, 0.3, 0.6) * (1 - rig.orbit);
    this.group.visible = vis > 0.01;
    this.arrowMat.uniforms.uOpacity.value = 0.25 + 0.7 * vis;
    this.frontMat.uniforms.uOpacity.value = 0.9 * vis;
    if (!this.group.visible) return;
    this.acc += dt;
    if (this.acc > 0.5) { this.acc = 0; this.refresh(sim); this.buildArrows(sim, rig); }
    else this.scaleArrows(rig);
    // pulse the target rings
    const t = U.uTime.value;
    const m = new THREE.Matrix4(), c = new THREE.Color();
    let n = 0;
    const width = Math.max(1, rig.V / 40);
    for (const cp of this.campaigns) {
      if (n >= 32) break;
      const r = (2.4 + Math.sin(t * 4 + cp.to) * 0.4) * Math.max(1, width * 0.8);
      m.makeScale(r, 1, r).setPosition(cp.tx, this.gy(sim, cp.tx, cp.tz) + 0.4, cp.tz);
      this.ringMesh.setMatrixAt(n, m);
      c.setHex(cp.color); this.ringMesh.setColorAt(n, c);
      n++;
    }
    this.ringMesh.count = n;
    this.ringMesh.instanceMatrix.needsUpdate = true;
    if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
  }

  private gy(sim: Sim, x: number, z: number) { return Math.max(0, sim.world.heightAt(x, z)); }

  /** Which kingdoms march on which towns, and where their armies are. */
  private refresh(sim: Sim) {
    const camps = new Map<string, { from: number; to: number; sx: number; sz: number; n: number }>();
    for (const u of sim.units) {
      if (u.flags & UF.Dead || u.task?.k !== 'march' || !(isCiv(u.sp) || isVehicle(u.sp))) continue;
      const key = `${u.kingdom}:${u.task.v}`;
      let c = camps.get(key);
      if (!c) { c = { from: u.kingdom, to: u.task.v, sx: 0, sz: 0, n: 0 }; camps.set(key, c); }
      c.sx += u.x; c.sz += u.z; c.n++;
    }
    // a kingdom at war with a chosen target but no army on the road yet: draw from its capital
    for (const k of sim.kingdoms.values()) {
      if (!k.alive || !k.wars.length || k.target < 0) continue;
      const tv = sim.villages.get(k.target);
      if (!tv || !tv.alive || !k.wars.includes(tv.kingdom)) continue;
      const key = `${k.id}:${tv.id}`;
      if (camps.has(key)) continue;
      const cap = sim.villages.get(k.capital);
      if (!cap || !cap.alive) continue;
      camps.set(key, { from: k.id, to: tv.id, sx: cap.cx + 0.5, sz: cap.cz + 0.5, n: 0 });
    }
    this.campaigns = [];
    for (const c of camps.values()) {
      const tv = sim.villages.get(c.to), k = sim.kingdoms.get(c.from);
      if (!tv || !tv.alive || !k) continue;
      const ax = c.n ? c.sx / c.n : c.sx, az = c.n ? c.sz / c.n : c.sz;
      if (Math.hypot(tv.cx - ax, tv.cz - az) < 3) continue;
      this.campaigns.push({ from: c.from, to: c.to, ax, az, tx: tv.cx + 0.5, tz: tv.cz + 0.5, soldiers: c.n, color: KINGDOM_COLORS[k.color][0] });
      if (this.campaigns.length >= MAX_ARROWS) break;
    }
    this.buildFront(sim);
  }

  /** Border edges between territories of kingdoms at war. */
  private buildFront(sim: Sim) {
    const w = sim.world, W = w.W, H = w.H;
    const kOf = new Map<number, number>();
    for (const v of sim.villages.values()) kOf.set(v.id, v.kingdom);
    const atWar = (a: number, b: number) => { const ka = sim.kingdoms.get(a); return !!ka && ka.wars.includes(b); };
    const pos: number[] = [];
    let tiles = 0;
    const lift = 0.35;
    for (let z = 0; z < H - 1; z++) for (let x = 0; x < W - 1; x++) {
      const t = z * W + x, o = w.owner[t];
      if (o < 0) continue;
      const ka = kOf.get(o);
      if (ka === undefined) continue;
      for (const [n, ex] of [[t + 1, true], [t + W, false]] as [number, boolean][]) {
        const on = w.owner[n];
        if (on < 0 || on === o) continue;
        const kb = kOf.get(on);
        if (kb === undefined || kb === ka || !atWar(ka, kb)) continue;
        tiles++;
        if (ex) { const y0 = this.gy(sim, x + 1, z) + lift, y1 = this.gy(sim, x + 1, z + 1) + lift; pos.push(x + 1, y0, z, x + 1, y1, z + 1); }
        else { const y0 = this.gy(sim, x, z + 1) + lift, y1 = this.gy(sim, x + 1, z + 1) + lift; pos.push(x, y0, z + 1, x + 1, y1, z + 1); }
      }
    }
    this.frontTiles = tiles;
    this.frontGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.frontGeo.setDrawRange(0, pos.length / 3);
  }

  private lastWidth = 0;
  private scaleArrows(rig: CameraRig) {
    const width = Math.max(0.6, rig.V / 45);
    if (Math.abs(width - this.lastWidth) / width > 0.15) this.lastBuild?.();
  }
  private lastBuild: (() => void) | null = null;

  /** Ribbon arrows: a curve from the army to the target, as wide as the view needs to read. */
  private buildArrows(sim: Sim, rig: CameraRig) {
    const build = () => {
      const width = Math.max(0.6, rig.V / 45);
      this.lastWidth = width;
      const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
      const c = new THREE.Color();
      for (const cp of this.campaigns) {
        const dx = cp.tx - cp.ax, dz = cp.tz - cp.az, L = Math.hypot(dx, dz);
        const nx = -dz / L, nz = dx / L;
        // bow the arrow sideways a little (two arrows between the same towns do not overlap)
        const bow = L * 0.18 * (cp.from % 2 ? 1 : -1);
        // stop short of the target so the head sits on the ring
        const endK = Math.max(0.5, 1 - 2.6 / L);
        c.setHex(cp.color);
        const base = pos.length / 3;
        for (let i = 0; i <= SEG; i++) {
          const k = (i / SEG) * endK;
          const px = cp.ax + dx * k + nx * Math.sin(k * Math.PI) * bow, pz = cp.az + dz * k + nz * Math.sin(k * Math.PI) * bow;
          // tangent for the ribbon's sideways direction
          const k2 = Math.min(endK, k + 0.01);
          const qx = cp.ax + dx * k2 + nx * Math.sin(k2 * Math.PI) * bow - px, qz = cp.az + dz * k2 + nz * Math.sin(k2 * Math.PI) * bow - pz;
          const ql = Math.hypot(qx, qz) || 1;
          const sx = -qz / ql, sz = qx / ql;
          const head = i / SEG > 0.86;
          const half = width * (head ? 1.9 : 0.75) * (0.6 + 0.4 * (i / SEG));
          const y = Math.max(0, sim.world.heightAt(px, pz)) + 1.2;
          pos.push(px + sx * half, y, pz + sz * half, px - sx * half, y, pz - sz * half);
          col.push(c.r, c.g, c.b, c.r, c.g, c.b);
          uv.push(i / SEG, 1, i / SEG, -1);
          if (i < SEG) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        }
      }
      this.arrowGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.arrowGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
      this.arrowGeo.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
      this.arrowGeo.setIndex(idx);
      this.arrowGeo.computeBoundingSphere();
    };
    this.lastBuild = build;
    build();
  }
}
