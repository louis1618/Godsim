import * as THREE from 'three';
import { Sim } from './sim/sim';
import { World } from './sim/world';
import { TICK_DT, KINGDOM_COLORS, SEASON_TICKS } from './sim/defs';
import { GameRenderer } from './render/gameRenderer';
import { UnitRenderer } from './render/units';
import { BuildingRenderer } from './render/buildings';
import { U } from './render/shared';
import { damp } from './core/math';
import { Physics } from './physics/physics';
import { FxRenderer } from './render/fx';
import { lightning } from './sim/disasters';

/** Owns the simulation and drives it at a fixed rate, feeding renderers each frame. */
export class Game {
  sim!: Sim;
  units = new UnitRenderer();
  buildings = new BuildingRenderer();
  speed = 1;
  paused = false;
  private acc = 0;
  alpha = 0;
  frameMs = 0;
  simMs = 0;
  listeners: ((g: Game) => void)[] = [];
  physics = new Physics();
  fx: FxRenderer;
  private tmpV = new THREE.Vector3();
  /** fx events produced this frame (for UI / audio listeners) */
  events: import('./sim/sim').FxEvent[] = [];

  constructor(readonly gr: GameRenderer) {
    this.fx = new FxRenderer(this.physics, gr.rig);
    gr.scene.add(this.units.group, this.buildings.group, this.fx.group);
    gr.onFrame.push((dt) => this.frame(dt));
  }

  async init() { await this.physics.init(); }

  setSim(world: World, sim: Sim) {
    this.sim = sim;
    this.gr.setWorld(world);
    this.gr.terrain.ownerColor = (vid) => {
      const v = sim.villages.get(vid);
      const k = v ? sim.kingdoms.get(v.kingdom) : undefined;
      return k ? KINGDOM_COLORS[k.color][0] : 0xffffff;
    };
    world.ownerDirty = true;
    if (this.physics.ready) this.physics.setTerrain(world);
    this.fx.initClouds(world.W, world.H);
  }

  private frame(dt: number) {
    const sim = this.sim;
    if (!sim) return;
    const t0 = performance.now();
    if (!this.paused) {
      this.acc += dt * this.speed;
      let steps = 0;
      const maxSteps = Math.max(4, Math.ceil(this.speed * 3));
      while (this.acc >= TICK_DT && steps < maxSteps) { sim.step(); this.acc -= TICK_DT; steps++; }
      if (steps >= maxSteps) this.acc = 0;
      // ownership colours change when villages are captured etc.
      if (sim.tick % 20 === 0) sim.world.ownerDirty = true;
    }
    this.alpha = this.acc / TICK_DT;
    // creature animation follows game time: frozen when paused, brisker when fast-forwarded
    if (!this.paused) U.uAnimTime.value += dt * Math.min(this.speed, 3);
    this.simMs = performance.now() - t0;
    // seasons drive foliage tint + snow
    const sf = sim.laws.seasons ? (sim.tick % (SEASON_TICKS * 4)) / SEASON_TICKS : 1;
    const autumn = Math.max(0, 1 - Math.abs(sf - 2.4) / 0.9);
    const snow = Math.max(0, Math.min(1, (sf - 3.05) * 4)) * Math.max(0, Math.min(1, (4 - sf) * 3));
    U.uAutumn.value = damp(U.uAutumn.value, autumn, 2, dt);
    U.uSnow.value = damp(U.uSnow.value, snow, 2, dt);
    const rig = this.gr.rig;
    const pxScale = this.gr.renderer.getPixelRatio();
    // physics: ragdolls + debris
    if (!sim.world.dirtyTerrain.empty) this.physics.markGroundDirty();
    this.physics.step(sim, this.paused ? 0 : dt, this.speed, this.units.physics);
    this.units.orbit = rig.orbit;
    this.units.update(sim, this.alpha, rig.camera.position, rig.focus, rig.V, rig.z01, pxScale, dt);
    this.buildings.update(sim);
    // fx hand-off
    // storms ask for lightning; resolve those first so their effects land this frame
    for (let i = 0; i < sim.fx.length; i++) if (sim.fx[i].t === 'lightningReq') lightning(sim, sim.fx[i].x, sim.fx[i].z);
    this.events = sim.fx.splice(0);
    for (const e of this.events) {
      if (e.t === 'sprout' && e.u !== undefined) this.gr.flora.markGrow(e.u, U.uTime.value);
      this.fx.handle(sim, e);
    }
    this.fx.update(sim, dt, this.alpha, (id, out) => this.units.unitPos(sim, id, this.alpha, out));
    for (const l of this.listeners) l(this);
    this.frameMs = performance.now() - t0;
  }
}

void THREE;
