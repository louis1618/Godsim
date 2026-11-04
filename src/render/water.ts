import * as THREE from 'three';
import { World } from '../sim/world';
import { U, GLSL_NOISE } from './shared';

/**
 * Water surfaces: a per-tile water mesh (sea + rivers + lakes) plus an endless ocean skirt.
 * Shader: depth tinting, animated normals, sun glints, foamy shorelines that read as crisp
 * coastlines in map view.
 */
export class WaterRenderer {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  private geo: THREE.BufferGeometry;
  private mesh: THREE.Mesh;

  constructor(private world: World, heightTex: THREE.Texture) {
    const { W, H } = world;
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uHeightTex: { value: null }, uDebug: { value: 0 },
      }]),
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        uniform float uHeightScale;
        uniform float uTime;
        varying vec3 vW;
        varying float vLevel;
        void main() {
          vec3 p = position;
          vLevel = p.y;
          vW = p;
          float wave = sin(p.x * 0.7 + uTime * 1.3) * 0.03 + sin(p.z * 0.9 - uTime * 1.1) * 0.03;
          p.y = p.y * uHeightScale + wave * uHeightScale;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D uHeightTex;
        uniform vec2 uMapSize;
        uniform float uTime;
        uniform float uMapMode;
        uniform vec3 uSunDir;
        uniform float uRain;
        uniform float uDebug;
        varying vec3 vW;
        varying float vLevel;
        ${GLSL_NOISE}
        void main() {
          vec2 uv = vW.xz / uMapSize;
          float ground = texture2D(uHeightTex, clamp(uv, 0.0, 1.0)).r;
          vec2 outside = max(-uv, uv - 1.0) * uMapSize;
          float od = max(max(outside.x, outside.y), 0.0);
          ground = mix(ground, -9.0, smoothstep(0.0, 24.0, od));
          float depth = vLevel - ground;
          if (depth < -0.05) discard;
          vec2 p = vW.xz;
          // animated normal from two scrolling noise fields
          float t = uTime;
          vec2 q1 = p * 0.9 + vec2(t * 0.11, t * 0.07);
          vec2 q2 = p * 1.7 - vec2(t * 0.08, -t * 0.13);
          float e = 0.05;
          float n0 = gsNoise(q1) + 0.6 * gsNoise(q2);
          float nx = gsNoise(q1 + vec2(e, 0.0)) + 0.6 * gsNoise(q2 + vec2(e, 0.0)) - n0;
          float nz = gsNoise(q1 + vec2(0.0, e)) + 0.6 * gsNoise(q2 + vec2(0.0, e)) - n0;
          float camD = length(cameraPosition - vW);
          float nStr = 3.0 / (1.0 + camD * 0.02);
          vec3 N = normalize(vec3(-nx * nStr, 1.0, -nz * nStr));
          vec3 V = normalize(cameraPosition - vec3(vW.x, vLevel, vW.z));
          float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
          vec3 shallow = vec3(0.24, 0.80, 0.82);
          vec3 mid = vec3(0.10, 0.52, 0.72);
          vec3 deep = vec3(0.05, 0.22, 0.45);
          float dd = clamp(depth / 7.0, 0.0, 1.0);
          vec3 col = mix(shallow, mid, smoothstep(0.0, 0.35, dd));
          col = mix(col, deep, smoothstep(0.3, 1.0, dd));
          // map view: subtle bathymetry banding
          float band = smoothstep(0.45, 0.5, fract(depth * 0.5)) * 0.04 * uMapMode;
          col *= 1.0 - band;
          vec3 sky = vec3(0.72, 0.86, 0.98);
          col = mix(col, sky, fres * 0.45 * (1.0 - uMapMode * 0.7));
          // sun glint
          vec3 Hh = normalize(uSunDir + V);
          float spec = pow(max(dot(N, Hh), 0.0), 90.0) * 0.9 * (1.0 - uMapMode * 0.85);
          col += vec3(1.0, 0.95, 0.85) * spec * (1.0 - uRain * 0.8);
          // diffuse ripple shading
          col *= 0.92 + 0.12 * (n0 - 0.6);
          // shoreline foam
          float foamEdge = 0.38 + 0.12 * sin(t * 1.6 + gsNoise(p * 0.8) * 6.28);
          float foam = smoothstep(foamEdge, 0.0, depth + (gsNoise(p * 3.0 + t * 0.3) - 0.5) * 0.16);
          float foamRing = smoothstep(0.05, 0.0, abs(depth - foamEdge * 1.6 - 0.1)) * 0.5 * (1.0 - uMapMode);
          col = mix(col, vec3(0.97, 0.99, 1.0), clamp(foam * 0.9 + foamRing, 0.0, 1.0));
          float alpha = mix(0.55, 1.0, smoothstep(0.0, 1.4, depth));
          alpha = max(alpha, foam);
          gl_FragColor = vec4(col, alpha);
          if (uDebug > 0.5) gl_FragColor = vec4(vec3(-ground / 12.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    Object.assign(this.material.uniforms, {
      uHeightTex: { value: heightTex }, uMapSize: U.uMapSize, uTime: U.uTime, uHeightScale: U.uHeightScale,
      uMapMode: U.uMapMode, uSunDir: U.uSunDir, uRain: U.uRain,
    });

    // per-vertex grid at tile corners
    const VW = W + 1, VH = H + 1;
    this.geo = new THREE.BufferGeometry();
    const pos = new Float32Array(VW * VH * 3);
    for (let z = 0; z < VH; z++) for (let x = 0; x < VW; x++) {
      const k = (z * VW + x) * 3; pos[k] = x; pos[k + 2] = z;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const idx: number[] = [];
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const a = z * VW + x, b = a + 1, c = a + VW, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);

    // endless ocean ring around the map
    const ring = new THREE.PlaneGeometry(W * 14, H * 14, 1, 1);
    ring.rotateX(-Math.PI / 2);
    ring.translate(W / 2, -0.02, H / 2);
    const ringMesh = new THREE.Mesh(ring, this.material);
    ringMesh.renderOrder = 1;
    ringMesh.frustumCulled = false;
    this.group.add(ringMesh);
    this.rebuild();
  }

  /** Vertex water level = highest level among adjacent water tiles; hidden below ground otherwise. */
  rebuild() {
    const w = this.world, { W, H } = w;
    const VW = W + 1;
    const pos = this.geo.attributes.position.array as Float32Array;
    for (let z = 0; z <= H; z++) for (let x = 0; x <= W; x++) {
      let lvl = -Infinity, any = false, minG = Infinity;
      // look at a 2-ring so the flat surface extends under the banks; terrain then clips it
      // into a natural shoreline instead of a stair-stepped one
      for (let dz = -2; dz <= 1; dz++) for (let dx = -2; dx <= 1; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= W || zz >= H) { any = true; if (lvl < 0) lvl = 0; continue; }
        const t = zz * W + xx;
        const near = dx >= -1 && dx <= 0 && dz >= -1 && dz <= 0;
        if (near) minG = Math.min(minG, w.height[t]);
        if (w.water[t] > w.height[t]) {
          const l = near ? w.water[t] : w.water[t] - 0.02;
          any = true; if (l > lvl) lvl = l;
        }
      }
      pos[(z * VW + x) * 3 + 1] = any ? lvl : minG - 0.8;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }
}
