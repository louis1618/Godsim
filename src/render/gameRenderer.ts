import * as THREE from 'three';
import { World } from '../sim/world';
import { CameraRig } from './cameraRig';
import { TerrainRenderer } from './terrain';
import { WaterRenderer } from './water';
import { Sky } from './sky';
import { FloraRenderer } from './flora';
import { GrassRenderer } from './grass';
import { U } from './shared';
import { lerp } from '../core/math';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect, HueSaturationEffect, BrightnessContrastEffect, TiltShiftEffect, SMAAEffect, KernelSize, SSAOEffect, NormalPass, BlendFunction } from 'postprocessing';

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky = new Sky();
  terrain!: TerrainRenderer;
  water!: WaterRenderer;
  flora!: FloraRenderer;
  grass!: GrassRenderer;
  world!: World;
  private worldGroup = new THREE.Group();
  private clock = new THREE.Clock();
  readonly fog: THREE.FogExp2;
  onFrame: ((dt: number) => void)[] = [];
  composer: EffectComposer | null = null;
  private ao: SSAOEffect | null = null;
  private aoPass: EffectPass | null = null;
  private normalPass: NormalPass | null = null;
  private tilt: TiltShiftEffect | null = null;
  private aoRadius = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);

    this.fog = new THREE.FogExp2(0xcfe6f2, 0.004);
    this.scene.fog = this.fog;
    this.scene.add(this.sky.mesh);

    this.hemi = new THREE.HemisphereLight(0xdcefff, 0x6b5a3c, 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    U.uSunDir.value.set(-0.48, 0.82, -0.42).normalize();
    this.scene.add(this.worldGroup);
    window.addEventListener('resize', () => this.resize());
  }

  setWorld(world: World) {
    this.world = world;
    this.worldGroup.clear();
    this.terrain = new TerrainRenderer(world);
    this.water = new WaterRenderer(world, this.terrain.heightTex);
    this.flora = new FloraRenderer(world);
    this.grass = new GrassRenderer(world);
    this.worldGroup.add(this.terrain.group, this.water.group, this.flora.group, this.grass.mesh);
    this.rig.setMap(world.W, world.H);
    this.rig.ground = (x, z) => this.terrain.groundAt(x, z);
  }

  private buildComposer() {
    const r = this.renderer;
    const w = window.innerWidth, h = window.innerHeight;
    const comp = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType });
    comp.addPass(new RenderPass(this.scene, this.rig.camera));
    const normal = new NormalPass(this.scene, this.rig.camera, { resolutionScale: 0.5 });
    comp.addPass(normal);
    const ssao = new SSAOEffect(this.rig.camera, normal.texture, {
      blendFunction: BlendFunction.MULTIPLY, samples: 11, rings: 4, radius: 0.08, intensity: 2.2, bias: 0.035, fade: 0.02,
      luminanceInfluence: 0.55, color: new THREE.Color(0x2c1c3c), resolutionScale: 0.5, worldDistanceThreshold: 60, worldDistanceFalloff: 12,
      worldProximityThreshold: 1.2, worldProximityFalloff: 0.8,
    });
    this.aoPass = new EffectPass(this.rig.camera, ssao);
    this.normalPass = normal;
    comp.addPass(this.aoPass);
    this.ao = ssao;
    void w; void h;
    this.tilt = new TiltShiftEffect({ focusArea: 1, feather: 0.45, kernelSize: KernelSize.MEDIUM, resolutionScale: 0.5 });
    comp.addPass(new EffectPass(this.rig.camera, this.tilt));
    const bloom = new BloomEffect({ luminanceThreshold: 0.86, luminanceSmoothing: 0.18, intensity: 0.75, mipmapBlur: true });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    const hsat = new HueSaturationEffect({ saturation: 0.1 });
    const bc = new BrightnessContrastEffect({ contrast: 0.06, brightness: 0.0 });
    const vig = new VignetteEffect({ darkness: 0.32, offset: 0.32 });
    comp.addPass(new EffectPass(this.rig.camera, bloom, tone, hsat, bc, vig));
    comp.addPass(new EffectPass(this.rig.camera, new SMAAEffect()));
    this.composer = comp;
  }

  setQuality(q: 'high' | 'low') {
    if (q === 'high' && !this.composer) this.buildComposer();
    if (q === 'low' && this.composer) { this.composer.dispose(); this.composer = null; this.ao = null; this.tilt = null; }
    this.renderer.toneMapping = this.composer ? THREE.NoToneMapping : THREE.NeutralToneMapping;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
    this.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); (this.sun.shadow as any).map = null; }
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
  }

  private waterT = 0;

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    U.uTime.value += dt;
    const rig = this.rig;
    rig.update(dt);
    U.uHeightScale.value = rig.heightScale;
    U.uMapMode.value = rig.mapMode;
    U.uTerritory.value = rig.territory;
    for (const f of this.onFrame) f(dt);
    if (this.terrain) {
      const terrainChanged = !this.world.dirtyTerrain.empty;
      this.terrain.sync();
      if (terrainChanged) { this.waterT = 0.15; this.grass.markDirty(); }
      if (this.waterT > 0) { this.waterT -= dt; if (this.waterT <= 0) this.water.rebuild(); }
    }
    if (this.flora) this.flora.update(rig.camera, rig.heightScale, rig.z01, U.uTime.value);
    if (this.grass) this.grass.update(rig.focus, rig.z01, dt);
    // fog: thick near the ground for depth, nearly none from orbit
    this.fog.density = lerp(0.0075, 0.0004, Math.pow(rig.z01, 0.6));
    // sun shadow frustum follows the view
    const f = rig.focus;
    const sd = U.uSunDir.value;
    const span = Math.min(rig.V * 1.25, 260);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span;
    sc.near = 1; sc.far = 400;
    sc.updateProjectionMatrix();
    // snap to texel grid to avoid shimmering
    const texel = (2 * span) / this.sun.shadow.mapSize.x;
    const fx = Math.round(f.x / texel) * texel, fz = Math.round(f.z / texel) * texel;
    this.sun.target.position.set(fx, f.y, fz);
    this.sun.position.set(fx + sd.x * 150, f.y + sd.y * 150, fz + sd.z * 150);
    this.sky.mesh.position.copy(rig.camera.position);
    if (this.composer) {
      // AO scales with the view; it fades out in map view where it would only muddy the map
      if (this.aoPass && this.normalPass) {
        const on = rig.z01 < 0.4 && rig.orbit < 0.05;
        this.aoPass.enabled = on; this.normalPass.enabled = on;
        void this.aoRadius;
      }
      // miniature tilt-shift in the middle of the zoom range
      if (this.tilt) {
        const k = Math.max(0, 1 - Math.abs(rig.z01 - 0.42) / 0.22) * (1 - rig.orbit * 0.6);
        this.tilt.focusArea = lerp(1.3, 0.62, k);
      }
      this.composer.render(dt);
    } else this.renderer.render(this.scene, rig.camera);
  }
}
