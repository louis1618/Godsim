import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { World } from '../sim/world';
import { Sim } from '../sim/sim';
import { Unit, UF, Anim, Emote } from '../sim/entities';
import { SPECIES } from '../sim/defs';
import { hurt } from '../sim/ai';
import { resolveInside } from '../sim/nav';

const GRAVITY = -16;

interface Ragdoll { body: RAPIER.RigidBody; unit: number; t: number; still: number; lastVy: number; offset: number; prev: THREE.Vector3; prevQ: THREE.Quaternion; cur: THREE.Vector3; curQ: THREE.Quaternion; }
export interface Debris { body: RAPIER.RigidBody; color: THREE.Color; size: THREE.Vector3; life: number; max: number; }

/**
 * Rapier-backed physics for the comedic bits: creatures flung by explosions, tornadoes and the
 * god hand tumble, bounce and get up dizzy; collapsing buildings and meteors scatter debris.
 */
export class Physics {
  ready = false;
  private world!: RAPIER.World;
  private ground: RAPIER.Collider | null = null;
  private terrain!: World;
  ragdolls = new Map<number, Ragdoll>();
  debris: Debris[] = [];
  private groundDirty = false;
  private terrainSeen = -1;
  onLand: ((u: Unit, speed: number) => void) | null = null;

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.ready = true;
  }

  setTerrain(w: World) {
    this.terrain = w;
    for (const r of this.ragdolls.values()) this.world.removeRigidBody(r.body);
    this.ragdolls.clear();
    for (const d of this.debris) this.world.removeRigidBody(d.body);
    this.debris = [];
    this.rebuildGround();
  }

  markGroundDirty() { this.groundDirty = true; }

  private rebuildGround() {
    const w = this.terrain;
    if (this.ground) { this.world.removeCollider(this.ground, false); this.ground = null; }
    const nrows = w.H - 1, ncols = w.W - 1;
    const heights = new Float32Array(w.W * w.H);
    // column-major: (row = z, col = x)
    for (let x = 0; x < w.W; x++) for (let z = 0; z < w.H; z++) heights[z + x * w.H] = w.height[z * w.W + x];
    const desc = RAPIER.ColliderDesc.heightfield(nrows, ncols, heights, { x: w.W - 1, y: 1, z: w.H - 1 })
      .setTranslation(w.W / 2, 0, w.H / 2).setFriction(0.8).setRestitution(0.35);
    this.ground = this.world.createCollider(desc);
    this.groundDirty = false;
  }

  /** Launch a creature into the air. */
  fling(sim: Sim, u: Unit, vx: number, vy: number, vz: number, spin = 6) {
    if (!this.ready || u.flags & UF.Dead && !this.ragdolls.has(u.id)) { if (u.flags & UF.Dead) this.flingCorpse(u, vx, vy, vz); return; }
    let r = this.ragdolls.get(u.id);
    const size = SPECIES[u.sp].size;
    const off = 0.28 * size;
    if (!r) {
      const y = Math.max(this.terrain.heightAt(u.x, u.z), this.terrain.water[this.terrain.tileAt(u.x, u.z)] ?? 0);
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(u.x, y + off + 0.05, u.z).setLinearDamping(0.15).setAngularDamping(0.6).setCcdEnabled(true));
      this.world.createCollider(RAPIER.ColliderDesc.capsule(0.14 * size, 0.12 * size).setDensity(1).setFriction(0.9).setRestitution(0.45), body);
      r = { body, unit: u.id, t: 0, still: 0, lastVy: 0, offset: off, prev: new THREE.Vector3(u.x, y, u.z), prevQ: new THREE.Quaternion(), cur: new THREE.Vector3(u.x, y, u.z), curQ: new THREE.Quaternion() };
      this.ragdolls.set(u.id, r);
    }
    r.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    const rr = sim.rng;
    r.body.setAngvel({ x: (rr.next() - 0.5) * spin * 2, y: (rr.next() - 0.5) * spin, z: (rr.next() - 0.5) * spin * 2 }, true);
    r.t = 0; r.still = 0;
    u.flags |= UF.Ragdoll;
    u.anim = Anim.Fly;
    u.task = null;
    u.path = null;
  }

  private flingCorpse(u: Unit, vx: number, vy: number, vz: number) {
    // dead units just become a tumbling chunk of debris in their team colour
    this.spawnDebris(new THREE.Vector3(u.x, this.terrain.heightAt(u.x, u.z) + 0.3, u.z), new THREE.Vector3(vx, vy, vz), 0xb08060, 0.12, 2.5);
  }

  /** Pick a creature up out of the world. */
  hold(u: Unit) {
    const r = this.ragdolls.get(u.id);
    if (r) { this.world.removeRigidBody(r.body); this.ragdolls.delete(u.id); }
    u.flags |= UF.Held;
    u.flags &= ~UF.Ragdoll;
    u.task = null; u.path = null;
  }

  /** Drop / throw a held creature. */
  release(sim: Sim, u: Unit, pos: THREE.Vector3, vel: THREE.Vector3) {
    u.flags &= ~UF.Held;
    u.x = pos.x; u.z = pos.z; u.px = pos.x; u.pz = pos.z;
    const ground = this.terrain.heightAt(pos.x, pos.z);
    const size = SPECIES[u.sp].size;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, Math.max(pos.y, ground + 0.4), pos.z).setLinearDamping(0.1).setAngularDamping(0.5).setCcdEnabled(true));
    this.world.createCollider(RAPIER.ColliderDesc.capsule(0.14 * size, 0.12 * size).setDensity(1).setFriction(0.9).setRestitution(0.45), body);
    body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    body.setAngvel({ x: (sim.rng.next() - 0.5) * 8, y: (sim.rng.next() - 0.5) * 4, z: (sim.rng.next() - 0.5) * 8 }, true);
    const p0 = new THREE.Vector3(pos.x, Math.max(pos.y, ground + 0.4), pos.z);
    this.ragdolls.set(u.id, { body, unit: u.id, t: 0, still: 0, lastVy: vel.y, offset: 0.28 * size, prev: p0.clone(), prevQ: new THREE.Quaternion(), cur: p0.clone(), curQ: new THREE.Quaternion() });
    u.flags |= UF.Ragdoll;
    void sim;
  }

  spawnDebris(pos: THREE.Vector3, vel: THREE.Vector3, color: number, size = 0.15, life = 4) {
    if (!this.ready || this.debris.length > 220) return;
    // purely cosmetic: render-side randomness is fine here
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(0.2).setAngularDamping(0.3));
    const sx = size * (0.6 + Math.random() * 0.8), sy = size * (0.5 + Math.random() * 0.8), sz = size * (0.6 + Math.random() * 0.8);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setDensity(2).setRestitution(0.3).setFriction(0.8), body);
    body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    body.setAngvel({ x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 10 }, true);
    this.debris.push({ body, color: new THREE.Color(color), size: new THREE.Vector3(sx, sy, sz), life, max: life });
  }

  /** Advance one simulation tick (0.1 s) in six fixed substeps: physics lives in sim time. */
  tick(sim: Sim) {
    if (!this.ready) return;
    if (sim.world.terrainVersion !== this.terrainSeen && sim.tick % 5 === 0) { this.terrainSeen = sim.world.terrainVersion; this.rebuildGround(); }
    const up = new THREE.Vector3(0, 1, 0);
    for (const r of this.ragdolls.values()) { r.prev.copy(r.cur); r.prevQ.copy(r.curQ); }
    for (let n = 0; n < 6; n++) {
      // water drag / buoyancy
      for (const r of this.ragdolls.values()) {
        const p = r.body.translation();
        const t = this.terrain.tileAt(p.x, p.z);
        if (t >= 0 && this.terrain.water[t] > this.terrain.height[t] && p.y < this.terrain.water[t]) {
          const v = r.body.linvel();
          r.body.setLinvel({ x: v.x * 0.92, y: v.y * 0.85 + 0.6, z: v.z * 0.92 }, true);
        }
      }
      this.world.step();
    }
    const dt = 0.1;
    for (const [id, r] of this.ragdolls) {
      const u = sim.unitMap.get(id);
      const p = r.body.translation();
      if (!u) { this.world.removeRigidBody(r.body); this.ragdolls.delete(id); continue; }
      r.t += dt;
      const v = r.body.linvel();
      const speedNow = Math.hypot(v.x, v.y, v.z);
      if (r.lastVy < -7 && v.y > r.lastVy * 0.4) {
        const impact = -r.lastVy;
        if (!(u.flags & UF.Dead)) hurt(sim, u, Math.max(0, impact - 7) * 9, undefined, 'fall');
        sim.fx.push({ t: 'land', x: p.x, z: p.z, a: impact });
        this.onLand?.(u, impact);
      }
      r.lastVy = v.y;
      const q = r.body.rotation();
      r.curQ.set(q.x, q.y, q.z, q.w);
      const off = up.clone().multiplyScalar(r.offset).applyQuaternion(r.curQ);
      r.cur.set(p.x - off.x, p.y - off.y, p.z - off.z);
      if (u.flags & UF.Dead) {
        if (r.t > 1.2) { this.world.removeRigidBody(r.body); this.ragdolls.delete(id); }
        continue;
      }
      u.x = u.px = Math.max(0.5, Math.min(this.terrain.W - 0.5, p.x));
      u.z = u.pz = Math.max(0.5, Math.min(this.terrain.H - 0.5, p.z));
      if (p.y < -30) { sim.killUnit(u, 'fall'); this.world.removeRigidBody(r.body); this.ragdolls.delete(id); continue; }
      if (speedNow < 0.5 && r.t > 0.5) r.still += dt; else r.still = 0;
      const tw = this.terrain.tileAt(p.x, p.z);
      const inWater = tw >= 0 && this.terrain.water[tw] > this.terrain.height[tw] && p.y < this.terrain.water[tw] + 0.2;
      if (r.still > 0.3 || r.t > 7 || (inWater && r.t > 1.2 && v.y > -2)) {
        this.world.removeRigidBody(r.body);
        this.ragdolls.delete(id);
        u.flags &= ~UF.Ragdoll;
        resolveInside(sim, u);
        u.anim = Anim.Idle;
        u.think = 8;
        u.task = { k: 'idle', t: 12 };
        sim.emote(u, Emote.Star, 25);
      }
    }
    for (const d of this.debris) d.life -= dt;
    const dead = this.debris.filter((d) => d.life <= 0);
    for (const d of dead) this.world.removeRigidBody(d.body);
    if (dead.length) this.debris = this.debris.filter((d) => d.life > 0);
  }

  /** Render-time interpolation between the last two ticks (no simulation happens here). */
  interpolate(alpha: number, out: Map<number, { pos: THREE.Vector3; quat: THREE.Quaternion }>, keep: number) {
    for (const id of [...out.keys()]) if (id !== keep && !this.ragdolls.has(id)) out.delete(id);
    const a = Math.max(0, Math.min(1, alpha));
    for (const [id, r] of this.ragdolls) {
      const e = out.get(id) ?? { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
      e.pos.copy(r.prev).lerp(r.cur, a);
      e.quat.copy(r.prevQ).slerp(r.curQ, a);
      out.set(id, e);
    }
  }
}
