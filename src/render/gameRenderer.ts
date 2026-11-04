import * as THREE from 'three';
import { World } from '../sim/world';
import { CameraRig } from './cameraRig';
import { TerrainRenderer } from './terrain';
import { WaterRenderer } from './water';
import { Sky } from './sky';
import { FloraRenderer } from './flora';
import { U } from './shared';
import { lerp } from '../core/math';

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
  world!: World;
  private worldGroup = new THREE.Group();
  private clock = new THREE.Clock();
  readonly fog: THREE.FogExp2;
  onFrame: ((dt: number) => void)[] = [];

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
    this.worldGroup.add(this.terrain.group, this.water.group, this.flora.group);
    this.rig.setMap(world.W, world.H);
    this.rig.ground = (x, z) => this.terrain.groundAt(x, z);
  }

  setQuality(q: 'high' | 'low') {
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
    this.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); (this.sun.shadow as any).map = null; }
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
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
      if (terrainChanged) this.waterT = 0.15;
      if (this.waterT > 0) { this.waterT -= dt; if (this.waterT <= 0) this.water.rebuild(); }
    }
    if (this.flora) this.flora.update(rig.camera, rig.heightScale, rig.z01, U.uTime.value);
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
    this.renderer.render(this.scene, rig.camera);
  }
}
