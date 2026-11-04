import * as THREE from 'three';

/** Uniforms shared across every world material so camera/zoom state drives them all at once. */
export const U = {
  uTime: { value: 0 },
  uHeightScale: { value: 1 },        // vertical "pop-up" factor: ~0.3 in map view, 1 when close
  uMapMode: { value: 0 },            // 0 = natural 3D look, 1 = crisp 2D map look
  uTerritory: { value: 0.5 },        // territory overlay strength
  uMapSize: { value: new THREE.Vector2(192, 192) },
  uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
  uSeason: { value: 0 },             // 0..4 continuous (spring, summer, autumn, winter)
  uWind: { value: 1 },
  uRain: { value: 0 },
  uFoliage: { value: new THREE.Color(1, 1, 1) },
  uAutumn: { value: 0 },
  uSnow: { value: 0 },
  uGenesis: { value: 1 },            // 0..1 world-rising animation
};

/** GLSL helpers available to all patched shaders. */
export const GLSL_NOISE = /* glsl */ `
float gsHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float gsNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = gsHash(i), b = gsHash(i + vec2(1.0, 0.0)), c = gsHash(i + vec2(0.0, 1.0)), d = gsHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float gsFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * gsNoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

/**
 * Patch an instanced MeshStandard/Lambert material so the instance's vertical translation
 * follows the shared height-scale, and (optionally) foliage sways in the wind.
 */
export function patchInstanced(mat: THREE.Material, opts: { wind?: number; seasonal?: boolean; flattenSelf?: boolean } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev?.call(mat, shader, r);
    Object.assign(shader.uniforms, { uTime: U.uTime, uHeightScale: U.uHeightScale, uWind: U.uWind, uAutumn: U.uAutumn, uSnow: U.uSnow, uGenesis: U.uGenesis, uMapSize: U.uMapSize });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uHeightScale; uniform float uWind; uniform float uAutumn; uniform float uSnow; uniform float uGenesis; uniform vec2 uMapSize;
${opts.seasonal ? 'attribute float aLeaf; varying float vLeaf; varying float vSnowTop;' : ''}
${GLSL_NOISE}
float gsGenesis(vec2 p) {
  float gd = clamp(length(p / uMapSize - 0.5) * 1.25 + gsNoise(p * 0.05) * 0.35, 0.0, 1.0);
  return smoothstep(gd, gd + 0.3, uGenesis * 1.4);
}
`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
if (uGenesis < 1.0) { float gk = gsGenesis(vec2(instanceMatrix[3][0], instanceMatrix[3][2])); transformed *= max(gk * 1.12 - 0.12 * gk * gk, 0.0); }
#endif
${opts.flattenSelf ? 'transformed.y *= mix(0.55, 1.0, uHeightScale);' : ''}
${opts.wind ? `
#ifdef USE_INSTANCING
{
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float sway = sin(uTime * 1.7 + ip.x * 0.37 + ip.z * 0.53) * 0.6 + sin(uTime * 3.1 + ip.x * 1.3) * 0.25;
  float hgt = max(position.y, 0.0);
  transformed.x += sway * ${opts.wind.toFixed(3)} * uWind * hgt * hgt;
  transformed.z += sway * ${(opts.wind * 0.6).toFixed(3)} * uWind * hgt * hgt;
}
#endif` : ''}
${opts.seasonal ? 'vLeaf = aLeaf; vSnowTop = smoothstep(0.2, 0.9, normal.y);' : ''}
`)
      .replace('#include <project_vertex>', `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mat4 gsIM = instanceMatrix;
  gsIM[3][1] *= uHeightScale;
  mvPosition = gsIM * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`)
      .replace('#include <worldpos_vertex>', `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  vec4 worldPosition = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    worldPosition = gsIM * worldPosition;
  #endif
  worldPosition = modelMatrix * worldPosition;
#endif
`);
    if (opts.seasonal) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uAutumn; uniform float uSnow; varying float vLeaf; varying float vSnowTop;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 autumnCol = mix(vec3(0.93, 0.48, 0.16), vec3(0.85, 0.27, 0.12), fract(vColor.g * 13.0));
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb = mix(diffuseColor.rgb, autumnCol * (0.6 + lum * 1.2), uAutumn * vLeaf * 0.85);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.96, 1.0), uSnow * vSnowTop * 0.85);
}`);
    }
  };
  // make shader cache key unique per option set
  const key = `inst-${opts.wind ?? 0}-${opts.seasonal ? 1 : 0}-${opts.flattenSelf ? 1 : 0}`;
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + key;
  return mat;
}

/** Depth material for shadows that applies the same instance flattening + wind. */
export function makeInstancedDepthMaterial(opts: { wind?: number } = {}) {
  const m = new THREE.MeshDepthMaterial();
  patchInstanced(m, { wind: opts.wind });
  return m;
}
