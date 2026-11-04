import * as THREE from 'three';
import { U } from './shared';

/** Gradient sky dome with a soft sun disc; colours follow weather. */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uTop: { value: new THREE.Color(0x5aa6e8) },
    uHorizon: { value: new THREE.Color(0xcfe6f2) },
    uBottom: { value: new THREE.Color(0x9cc6d8) },
    uSunDir: U.uSunDir,
    uRain: U.uRain,
  };
  constructor() {
    const geo = new THREE.SphereGeometry(1, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: this.uniforms,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uTop, uHorizon, uBottom, uSunDir; uniform float uRain;
        varying vec3 vDir;
        void main(){
          float y = vDir.y;
          vec3 c = y > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.7, y), 0.7)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.25, y));
          float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          c += vec3(1.0, 0.9, 0.7) * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25) * (1.0 - uRain);
          c = mix(c, vec3(dot(c, vec3(0.33))) * 0.8, uRain * 0.6);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    this.mesh.scale.setScalar(5000);
  }
}
