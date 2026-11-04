import * as THREE from 'three';
import { World, CHUNK, heightCubic } from '../sim/world';
import { MAT_COUNT } from '../sim/defs';
import { U, GLSL_NOISE } from './shared';
import { matPaletteUniform } from './palette';

const R = 2; // vertices per tile edge

/**
 * Chunked heightfield terrain. Colours come from per-tile data textures so painting is cheap,
 * and the shader morphs between a crisp tile "map" look and a soft natural look.
 */
export class TerrainRenderer {
  readonly group = new THREE.Group();
  readonly matTex: THREE.DataTexture;
  readonly ownerTex: THREE.DataTexture;
  readonly heightTex: THREE.DataTexture;
  readonly material: THREE.MeshStandardMaterial;
  private vh: Float32Array;
  private VW: number;
  private VH: number;
  private chunks: THREE.Mesh[] = [];
  private matData: Uint8Array;
  private ownerData: Uint8Array;
  private heightData: Uint16Array;
  ownerColor: (villageId: number) => number = () => 0xffffff;
  ownerKingdom: (villageId: number) => number = () => -1;

  constructor(private world: World) {
    const { W, H } = world;
    this.VW = W * R + 1; this.VH = H * R + 1;
    this.vh = new Float32Array(this.VW * this.VH);
    this.matData = new Uint8Array(W * H * 4);
    this.ownerData = new Uint8Array(W * H * 4);
    this.heightData = new Uint16Array(W * H);
    this.matTex = new THREE.DataTexture(this.matData, W, H, THREE.RGBAFormat);
    this.matTex.magFilter = this.matTex.minFilter = THREE.NearestFilter;
    this.ownerTex = new THREE.DataTexture(this.ownerData, W, H, THREE.RGBAFormat);
    this.ownerTex.magFilter = this.ownerTex.minFilter = THREE.NearestFilter;
    this.heightTex = new THREE.DataTexture(this.heightData, W, H, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    U.uMapSize.value.set(W, H);

    this.material = this.makeMaterial();
    for (let cz = 0; cz < world.CH; cz++) {
      for (let cx = 0; cx < world.CW; cx++) {
        const geo = new THREE.BufferGeometry();
        const cw = Math.min(CHUNK, W - cx * CHUNK) * R, ch = Math.min(CHUNK, H - cz * CHUNK) * R;
        const nv = (cw + 1) * (ch + 1);
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
        const idx: number[] = [];
        for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
          const a = j * (cw + 1) + i, b = a + 1, c = a + cw + 1, d = c + 1;
          // alternate diagonal for less directional artefacts
          if ((i + j) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
        }
        geo.setIndex(idx);
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.receiveShadow = true; mesh.castShadow = true;
        mesh.userData = { cx, cz, cw, ch };
        this.chunks.push(mesh);
        this.group.add(mesh);
      }
    }
    this.rebuildHeights(0, 0, W - 1, H - 1);
    this.updateMat(0, 0, W - 1, H - 1);
  }

  private makeMaterial() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 });
    const pal = matPaletteUniform();
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uMatTex: { value: this.matTex }, uOwnerTex: { value: this.ownerTex }, uPal: { value: pal },
        uMapSize: U.uMapSize, uMapMode: U.uMapMode, uTerritory: U.uTerritory, uTime: U.uTime,
        uHeightScale: U.uHeightScale, uSnow: U.uSnow,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uHeightScale;
varying vec3 vWPos; varying vec3 vWNormal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vWPos = transformed; vWNormal = normal;
transformed.y *= uHeightScale;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uMatTex; uniform sampler2D uOwnerTex;
uniform vec3 uPal[${MAT_COUNT * 2}];
uniform vec2 uMapSize; uniform float uMapMode; uniform float uTerritory; uniform float uTime; uniform float uSnow;
varying vec3 vWPos; varying vec3 vWNormal;
${GLSL_NOISE}
ivec2 gsClampT(ivec2 t) { return clamp(t, ivec2(0), ivec2(uMapSize) - 1); }
vec3 gsMatCol(ivec2 t, vec2 p, out float fire) {
  vec4 d = texelFetch(uMatTex, gsClampT(t), 0);
  int m = int(d.r * 255.0 + 0.5);
  float v = gsNoise(p * 0.55) * 0.55 + gsNoise(p * 2.3) * 0.45;
  v = clamp(v + (d.g - 0.5) * 0.6, 0.0, 1.0);
  fire = d.b;
  vec3 c = mix(uPal[m], uPal[m + ${MAT_COUNT}], v);
  return c;
}
float gsGrass(ivec2 t) { return texelFetch(uMatTex, gsClampT(t), 0).a; }
bool gsSameK(vec4 a, vec4 b) { return b.a > 0.0 && distance(a.rgb, b.rgb) < 0.01; }
`)
        .replace('#include <color_fragment>', `#include <color_fragment>
vec2 gp = vWPos.xz;
float fire0, f1, f2, f3, f4;
// --- natural (smoothly blended, noise-warped) ---
vec2 q = gp - 0.5 + (vec2(gsNoise(gp * 1.7), gsNoise(gp * 1.7 + 31.0)) - 0.5) * 0.85;
ivec2 i0 = ivec2(floor(q)); vec2 fq = smoothstep(0.18, 0.82, fract(q));
vec3 cA = gsMatCol(i0, gp, f1), cB = gsMatCol(i0 + ivec2(1, 0), gp, f2), cC = gsMatCol(i0 + ivec2(0, 1), gp, f3), cD = gsMatCol(i0 + ivec2(1, 1), gp, f4);
vec3 natural = mix(mix(cA, cB, fq.x), mix(cC, cD, fq.x), fq.y);
float fireN = mix(mix(f1, f2, fq.x), mix(f3, f4, fq.x), fq.y);
// grass-detail mottling up close
natural *= 0.9 + 0.2 * gsNoise(gp * 5.0) * (0.6 + 0.4 * gsNoise(gp * 0.7));
// --- map (crisp tiles) ---
ivec2 ti = ivec2(floor(gp));
vec3 tileCol = gsMatCol(ti, vec2(ti) + 0.5, fire0);
tileCol *= 0.955 + gsHash(vec2(ti)) * 0.09;
vec3 col = mix(natural, tileCol, uMapMode);
float fireAmt = mix(fireN, fire0, uMapMode);
// cliffs
float slope = 1.0 - normalize(vWNormal).y;
float rockAmt = smoothstep(0.3, 0.5, slope + (gsNoise(gp * 2.0) - 0.5) * 0.15) * (1.0 - uMapMode * 0.6);
vec3 rockCol = mix(vec3(0.42, 0.39, 0.36), vec3(0.6, 0.57, 0.52), gsNoise(gp * vec2(1.5, 6.0) + vWPos.y));
col = mix(col, rockCol, rockAmt);
// shoreline wetness & seabed
float h = vWPos.y;
col *= mix(1.0, 0.78, smoothstep(0.45, 0.05, h) * smoothstep(-0.6, 0.0, h));
col = mix(col, col * vec3(0.55, 0.72, 0.78), smoothstep(-0.2, -3.5, h));
// winter snow blanket (latitude + altitude)
float lat = abs(gp.y / uMapSize.y - 0.5) * 2.0;
float snowAmt = uSnow * smoothstep(0.5, 0.75, lat * 0.85 + max(h, 0.0) * 0.045 + (gsNoise(gp * 0.8) - 0.5) * 0.3) * step(0.15, h) * (1.0 - rockAmt * 0.7);
col = mix(col, vec3(0.93, 0.95, 0.99), snowAmt);
// territory
vec4 own = texelFetch(uOwnerTex, gsClampT(ti), 0);
if (own.a > 0.0) {
  vec2 fp = fract(gp);
  float bw = mix(0.1, 0.24, uMapMode);
  float b = 0.0;
  if (!gsSameK(own, texelFetch(uOwnerTex, gsClampT(ti + ivec2(-1, 0)), 0))) b = max(b, 1.0 - smoothstep(0.0, bw, fp.x));
  if (!gsSameK(own, texelFetch(uOwnerTex, gsClampT(ti + ivec2(1, 0)), 0))) b = max(b, smoothstep(1.0 - bw, 1.0, fp.x));
  if (!gsSameK(own, texelFetch(uOwnerTex, gsClampT(ti + ivec2(0, -1)), 0))) b = max(b, 1.0 - smoothstep(0.0, bw, fp.y));
  if (!gsSameK(own, texelFetch(uOwnerTex, gsClampT(ti + ivec2(0, 1)), 0))) b = max(b, smoothstep(1.0 - bw, 1.0, fp.y));
  float wtr = step(0.0, h);
  col = mix(col, own.rgb, uTerritory * 0.32 * wtr);
  col = mix(col, own.rgb * 1.05, b * clamp(uTerritory * 1.6, 0.0, 1.0) * wtr);
}
diffuseColor.rgb = col;
`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float ember = fireAmt * (0.6 + 0.4 * sin(uTime * 7.0 + gp.x * 3.1 + gp.y * 2.3));
  totalEmissiveRadiance += vec3(1.0, 0.35, 0.08) * ember * 1.6;
  vec4 dd = texelFetch(uMatTex, gsClampT(ti), 0);
  if (int(dd.r * 255.0 + 0.5) == 10) totalEmissiveRadiance += vec3(1.0, 0.32, 0.05) * (0.8 + 0.4 * gsNoise(gp * 3.0 + uTime * 0.6));
}`);
    };
    mat.customProgramCacheKey = () => 'gs-terrain';
    return mat;
  }

  /** Recompute vertex heights for tiles in [x0,x1]x[z0,z1] and rebuild touched chunks. */
  rebuildHeights(x0: number, z0: number, x1: number, z1: number) {
    const { W, H, height } = this.world;
    const VW = this.VW;
    const vx0 = Math.max(0, (x0 - 3) * R), vz0 = Math.max(0, (z0 - 3) * R);
    const vx1 = Math.min(this.VW - 1, (x1 + 4) * R), vz1 = Math.min(this.VH - 1, (z1 + 4) * R);
    for (let vz = vz0; vz <= vz1; vz++) for (let vx = vx0; vx <= vx1; vx++) {
      this.vh[vz * VW + vx] = heightCubic(height, W, H, vx / R, vz / R);
    }
    // height texture for water depth
    for (let z = Math.max(0, z0 - 3); z <= Math.min(H - 1, z1 + 3); z++) for (let x = Math.max(0, x0 - 3); x <= Math.min(W - 1, x1 + 3); x++) {
      const i = z * W + x;
      this.heightData[i] = THREE.DataUtils.toHalfFloat(height[i]);
    }
    this.heightTex.needsUpdate = true;
    for (const mesh of this.chunks) {
      const { cx, cz, cw, ch } = mesh.userData as { cx: number; cz: number; cw: number; ch: number };
      const bx0 = cx * CHUNK * R, bz0 = cz * CHUNK * R;
      if (bx0 + cw < vx0 - 1 || bx0 > vx1 + 1 || bz0 + ch < vz0 - 1 || bz0 > vz1 + 1) continue;
      this.fillChunk(mesh, bx0, bz0, cw, ch);
    }
  }

  private fillChunk(mesh: THREE.Mesh, bx0: number, bz0: number, cw: number, ch: number) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nor = geo.attributes.normal as THREE.BufferAttribute;
    const P = pos.array as Float32Array, Nn = nor.array as Float32Array;
    const VW = this.VW, VH = this.VH, vh = this.vh;
    const inv = 1 / R;
    let k = 0;
    for (let j = 0; j <= ch; j++) {
      const vz = bz0 + j;
      for (let i = 0; i <= cw; i++) {
        const vx = bx0 + i;
        const y = vh[vz * VW + vx];
        P[k * 3] = vx * inv; P[k * 3 + 1] = y; P[k * 3 + 2] = vz * inv;
        const l = vh[vz * VW + Math.max(0, vx - 1)], r = vh[vz * VW + Math.min(VW - 1, vx + 1)];
        const u = vh[Math.max(0, vz - 1) * VW + vx], d = vh[Math.min(VH - 1, vz + 1) * VW + vx];
        let nx = (l - r) * R * 0.5, ny = 1, nz = (u - d) * R * 0.5;
        const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
        Nn[k * 3] = nx; Nn[k * 3 + 1] = ny; Nn[k * 3 + 2] = nz;
        k++;
      }
    }
    pos.needsUpdate = true; nor.needsUpdate = true;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    // expand bounds generously since the vertex shader rescales y
    geo.boundingBox!.min.y = Math.min(geo.boundingBox!.min.y, -2);
    geo.boundingSphere!.radius += 4;
  }

  updateMat(x0: number, z0: number, x1: number, z1: number) {
    const w = this.world;
    const { W } = w;
    const d = this.matData;
    for (let z = Math.max(0, z0); z <= Math.min(w.H - 1, z1); z++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      const i = z * W + x, o = i * 4;
      d[o] = w.mat[i];
      d[o + 1] = w.moist[i];
      d[o + 2] = w.fire[i];
      d[o + 3] = w.grass[i];
    }
    this.matTex.needsUpdate = true;
  }

  updateOwners() {
    const w = this.world;
    const d = this.ownerData;
    const c = new THREE.Color();
    let lastV = -2, r = 0, g = 0, b = 0;
    for (let i = 0; i < w.N; i++) {
      const v = w.owner[i], o = i * 4;
      if (v < 0) { d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0; continue; }
      if (v !== lastV) {
        c.setHex(this.ownerColor(v));
        r = Math.round(c.r * 255); g = Math.round(c.g * 255); b = Math.round(c.b * 255);
        lastV = v;
      }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 1 + (v % 254);
    }
    this.ownerTex.needsUpdate = true;
  }

  /** Smooth render-space ground height (unscaled). */
  groundAt(x: number, z: number) {
    const { W, H, height } = this.world;
    return heightCubic(height, W, H, x, z);
  }

  sync() {
    const w = this.world;
    if (!w.dirtyTerrain.empty) {
      const d = w.dirtyTerrain;
      this.rebuildHeights(d.x0, d.z0, d.x1, d.z1);
      d.clear();
    }
    if (!w.dirtyMat.empty) {
      const d = w.dirtyMat;
      this.updateMat(d.x0 - 1, d.z0 - 1, d.x1 + 1, d.z1 + 1);
      d.clear();
    }
    if (w.ownerDirty) { this.updateOwners(); w.ownerDirty = false; }
  }
}
