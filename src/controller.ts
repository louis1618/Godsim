import * as THREE from 'three';
import { Game } from './game';
import { store } from './ui/store';
import { POWER_MAP, POWERS, applyPower, applyUnitPower, applyPairPower, incite, enlighten, kingdomAt, MAX_COUNT, brushDist } from './sim/powers';
import { heightCubic } from './sim/world';
import { UF } from './sim/entities';
import { SPECIES, isCiv } from './sim/defs';
import { U } from './render/shared';
import { audio } from './audio/audio';

const EXPANDERS = new Set(['land', 'raise', 'mountain', 'grass', 'sand', 'desert', 'snow', 'swamp', 'lava']);
const ACCENT: Record<string, number> = { world: 0x6cc04a, life: 0xff7a8a, civ: 0xffc53d, nature: 0x33c2a6, disaster: 0xff6a3a, observe: 0x8f7cf2, settings: 0x9aa7bd };

/** Turns mouse + keyboard into camera motion and god powers. */
export class Controller {
  enabled = false;
  private mouse = new THREE.Vector2(-9, -9);
  private ndc = new THREE.Vector2();
  ground: THREE.Vector3 | null = null;
  private keys = new Set<string>();
  private btn = -1;
  private downAt = { x: 0, y: 0, t: 0 };
  private moved = false;
  private applyAcc = 0;
  ring: THREE.LineLoop;
  private ringFill: THREE.Mesh;
  private held: { id: number; pos: THREE.Vector3; vel: THREE.Vector3; last: THREE.Vector3 } | null = null;
  private lastMove = 0;
  private raycaster = new THREE.Raycaster();
  /** asked when a land-making brush reaches the edge of the world; returns the shift applied */
  expandHook: ((x: number, z: number, r: number) => { dx: number; dz: number } | null) | null = null;

  constructor(private game: Game, private el: HTMLElement) {
    const n = 64;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.ring = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false }));
    this.ring.renderOrder = 50; this.ring.frustumCulled = false;
    const fg = new THREE.CircleGeometry(1, 48); fg.rotateX(-Math.PI / 2);
    this.ringFill = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthTest: false, depthWrite: false }));
    this.ringFill.renderOrder = 49;
    game.gr.scene.add(this.ring, this.ringFill);
    this.bind();
  }

  private bind() {
    const el = this.el, rig = this.game.gr.rig;
    el.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (e.ctrlKey || e.altKey) { this.bumpBrush(e.deltaY < 0 ? 1 : -1); return; }
      const f = Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
      rig.zoomAt(this.ndc.x, this.ndc.y, f);
      rig.follow = null;
    }, { passive: false });
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      el.setPointerCapture(e.pointerId);
      this.updateMouse(e);
      this.btn = e.button;
      this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.moved = false;
      const p = POWER_MAP.get(store.s.power);
      if (e.button === 2 || e.button === 1 || (e.button === 0 && (!p || p.mode === 'inspect' || p.mode === 'panel'))) {
        if (e.button !== 1) rig.beginDrag(this.ndc.x, this.ndc.y);
      }
      if (e.button === 0 && p) this.toolDown(p.id);
    });
    el.addEventListener('pointermove', (e) => {
      const lx = this.mouse.x, ly = this.mouse.y;
      this.updateMouse(e);
      if (!this.enabled) return;
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 5) this.moved = true;
      const dt = Math.max(0.001, (performance.now() - this.lastMove) / 1000);
      this.lastMove = performance.now();
      if (this.btn === 1) {
        rig.tYaw -= (e.clientX - lx) * 0.006;
        rig.tTilt = Math.max(-16, Math.min(46, rig.tTilt + (e.clientY - ly) * 0.15));
      } else if (rig.dragStart) rig.drag(this.ndc.x, this.ndc.y, dt);
    });
    el.addEventListener('pointerup', (e) => {
      if (!this.enabled) return;
      const p = POWER_MAP.get(store.s.power);
      if (rig.dragStart) rig.endDrag();
      if (e.button === 0) {
        if (!this.moved && (!p || p.mode === 'inspect' || p.mode === 'panel')) this.inspectClick();
        if (this.held) this.releaseHeld();
      }
      this.btn = -1;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private updateMouse(e: { clientX: number; clientY: number }) {
    const r = this.el.getBoundingClientRect();
    this.mouse.set(e.clientX, e.clientY);
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private key(e: KeyboardEvent) {
    if (!this.enabled || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    this.keys.add(e.code);
    const g = this.game;
    if (e.code === 'Space') { g.paused = !g.paused; store.set({ tick: store.s.tick + 1 }); audio.ui('click'); e.preventDefault(); return; }
    if (e.code === 'Escape') {
      if (store.s.brushModal) { store.set({ brushModal: false }); return; }
      if (store.s.panel) store.set({ panel: null });
      else if (store.s.sel) store.set({ sel: null });
      else if (store.s.power !== 'none') this.deselect();
      else store.set({ menu: !store.s.menu });
      g.gr.rig.follow = null;
      return;
    }
    if (e.code === 'BracketLeft') { this.bumpBrush(-1); return; }
    if (e.code === 'BracketRight') { this.bumpBrush(1); return; }
    if (e.code === 'Home') { g.gr.rig.resetYaw(); return; }
    if (e.code === 'Comma') { this.setSpeed(-1); return; }
    if (e.code === 'Period') { this.setSpeed(1); return; }
    const p = POWERS.find((p) => p.key === e.code);
    if (p) this.selectPower(p.id);
  }

  setSpeed(dir: number) {
    const steps = [1, 2, 5, 10];
    const i = Math.max(0, steps.indexOf(this.game.speed));
    this.game.speed = steps[Math.max(0, Math.min(steps.length - 1, i + dir))];
    this.game.paused = false;
    store.set({ tick: store.s.tick + 1 });
  }

  bumpBrush(d: number) {
    const p = POWER_MAP.get(store.s.power);
    if (!p?.size) return;
    const b = Math.max(p.size[0], Math.min(p.size[2], store.s.brush + d));
    store.set({ brush: b });
  }

  /** Pressing the selected power again puts the cursor back to free movement. */
  deselect() { store.set({ power: 'none', pairFirst: -1 }); audio.ui('close'); }

  selectPower(id: string) {
    const p = POWER_MAP.get(id);
    if (!p) return;
    if (p.mode === 'panel') { store.set({ panel: id }); audio.ui('open'); return; }
    if (store.s.power === id) { this.deselect(); return; }
    if (p.cat !== 'observe') store.set({ recent: [id, ...store.s.recent.filter((r) => r !== id)].slice(0, 8) });
    store.set({ power: id, cat: store.s.cat === 'home' || (p.cat === 'observe' && store.s.cat !== 'observe') ? store.s.cat : p.cat, brush: p.size ? Math.max(p.size[0], Math.min(p.size[2], store.s.brush || p.size[1])) : store.s.brush, pairFirst: -1 });
    audio.ui('select');
  }

  // ------------------------------------------------------------- picking
  /** Ray-march the (flattened) heightfield to find the ground under the cursor. */
  pickGround(): THREE.Vector3 | null {
    const cam = this.game.gr.rig.camera;
    this.raycaster.setFromCamera(this.ndc, cam);
    const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
    const w = this.game.sim.world;
    const hs = U.uHeightScale.value;
    const surf = (x: number, z: number) => {
      const t = w.tileAt(x, z);
      const h = heightCubic(w.height, w.W, w.H, x, z);
      return Math.max(h, t >= 0 ? w.water[t] : 0) * hs;
    };
    // start where the ray crosses the top of the world
    const top = 16 * hs + 1;
    let tmin = 0;
    if (o.y > top && d.y < 0) tmin = (o.y - top) / -d.y;
    const step = Math.max(0.15, this.game.gr.rig.V / 300);
    let prev = tmin;
    for (let i = 0; i < 1200; i++) {
      const t = tmin + i * step;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < surf(x, z)) {
        let a = prev, b = t;
        for (let k = 0; k < 12; k++) {
          const m = (a + b) / 2;
          const mx = o.x + d.x * m, my = o.y + d.y * m, mz = o.z + d.z * m;
          if (my < surf(mx, mz)) b = m; else a = m;
        }
        return new THREE.Vector3(o.x + d.x * b, (o.y + d.y * b) / hs, o.z + d.z * b);
      }
      prev = t;
      if (y < -20) break;
    }
    return null;
  }

  private pickUnit(g: THREE.Vector3): number {
    const sim = this.game.sim;
    const r = Math.max(0.6, this.game.gr.rig.V / 60);
    let best = -1, bd = r * r;
    sim.near(g.x, g.z, r, (u, d2) => { if (d2 < bd) { bd = d2; best = u.id; } });
    return best;
  }

  private inspectClick() {
    const g = this.pickGround();
    if (!g) return;
    const sim = this.game.sim;
    const uid = this.pickUnit(g);
    if (uid >= 0) { store.set({ sel: { kind: 'unit', id: uid } }); audio.ui('pop'); return; }
    const t = sim.world.tileAt(g.x, g.z);
    if (t >= 0) {
      const b = sim.buildings.get(sim.world.bld[t]);
      const vid = b?.village ?? sim.world.owner[t];
      if (vid >= 0 && sim.villages.get(vid)?.alive) { store.set({ sel: { kind: 'village', id: vid } }); audio.ui('pop'); return; }
    }
    store.set({ sel: null });
  }

  private toolDown(id: string) {
    const p = POWER_MAP.get(id)!;
    const sim = this.game.sim;
    const g = this.pickGround();
    if (!g) return;
    if (p.mode === 'grab') {
      const uid = this.pickUnit(g);
      const u = sim.getUnit(uid);
      if (!u) return;
      this.game.physics.hold(u);
      this.game.units.heldId = u.id;
      this.held = { id: u.id, pos: g.clone().setY(g.y + 1.5), vel: new THREE.Vector3(), last: g.clone() };
      audio.play('grab', g.x, g.z);
      return;
    }
    if (p.mode === 'unit') {
      const u = sim.getUnit(this.pickUnit(g));
      if (!u) { audio.ui('deny'); return; }
      if (id === 'follow') { this.follow(u.id); return; }
      if (applyUnitPower(sim, id, u)) audio.play(id, u.x, u.z); else audio.ui('deny');
      return;
    }
    if (p.mode === 'pair') {
      const k = kingdomAt(sim, g.x, g.z);
      if (k < 0) { audio.ui('deny'); return; }
      if (store.s.pairFirst < 0) { store.set({ pairFirst: k }); audio.ui('select'); return; }
      if (applyPairPower(sim, id, store.s.pairFirst, k)) { audio.play(id, g.x, g.z); store.set({ pairFirst: -1 }); }
      else { audio.ui('deny'); }
      return;
    }
    if (p.mode === 'village') {
      const t = sim.world.tileAt(g.x, g.z);
      const vid = t >= 0 ? sim.world.owner[t] : -1;
      if (id === 'enlighten') { if (vid >= 0 && enlighten(sim, vid)) audio.event('era', g.x, g.z); else audio.ui('deny'); return; }
      if (vid >= 0 && incite(sim, vid)) audio.play('rebel', g.x, g.z); else audio.ui('deny');
      return;
    }
    if (p.mode === 'brush' || p.mode === 'click') {
      this.applyAcc = 1;
      this.applyHeld(0);
    }
  }

  follow(uid: number) {
    this.followId = uid;
    const rig = this.game.gr.rig;
    const tmp = new THREE.Vector3();
    store.set({ sel: { kind: 'unit', id: uid } });
    rig.follow = () => this.game.units.unitPos(this.game.sim, uid, this.game.alpha, tmp);
    const p = this.game.units.unitPos(this.game.sim, uid, this.game.alpha, tmp);
    if (p) rig.flyTo(p.x, p.z, 7, 2.2);
    audio.ui('whoosh');
  }

  private applyHeld(dt: number) {
    const p = POWER_MAP.get(store.s.power);
    if (!p || this.btn !== 0) return;
    if (p.mode !== 'brush' && p.mode !== 'click') return;
    const rate = p.rate ?? 1;
    this.applyAcc += dt * rate;
    if (this.applyAcc < 1) return;
    this.applyAcc = Math.min(this.applyAcc - 1, 1);
    let g = this.ground;
    if (!g) return;
    // painting land past the edge grows the world (infinite canvas)
    if (EXPANDERS.has(p.id) && this.expandHook) {
      const w = this.game.sim.world, r = store.s.brush + 2;
      if (g.x - r < 4 || g.z - r < 4 || g.x + r > w.W - 4 || g.z + r > w.H - 4) {
        const sh = this.expandHook(g.x, g.z, r);
        if (sh) { g = g.clone(); g.x += sh.dx; g.z += sh.dz; this.ground = g; }
      }
    }
    let ok = false;
    if (p.mode === 'click') {
      // summon / strike `count` times scattered over the radius
      const n = Math.max(1, Math.min(store.s.count, MAX_COUNT[p.id] ?? 30));
      const R = n > 1 ? store.s.brush : 0;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * R;
        ok = applyPower(this.game.sim, p.id, g.x + Math.cos(a) * d, g.z + Math.sin(a) * d, { brush: store.s.brush, dt, first: true, shape: store.s.brushShape }) || ok;
      }
    } else ok = applyPower(this.game.sim, p.id, g.x, g.z, { brush: store.s.brush, dt, first: true, shape: store.s.brushShape });
    audio.play(p.id, g.x, g.z, ok);
    if (p.mode === 'click' && rate <= 1.5) this.btn = -1; // single-shot disasters
  }

  private releaseHeld() {
    const h = this.held!;
    this.held = null;
    this.game.units.heldId = -1;
    const u = this.game.sim.unitMap.get(h.id);
    if (u && !(u.flags & UF.Dead)) {
      const v = h.vel.clone().clampLength(0, 22);
      this.game.physics.release(this.game.sim, u, h.pos, v);
      audio.play(v.length() > 6 ? 'throw' : 'drop', h.pos.x, h.pos.z);
    }
  }

  followId = -1;

  update(dt: number) {
    if (!this.enabled) { this.ring.visible = this.ringFill.visible = false; return; }
    const rig = this.game.gr.rig;
    // the star marks whoever the camera is following
    if (!rig.follow) this.followId = -1;
    this.game.units.followId = this.followId;
    // keyboard camera
    const sp = rig.V * 1.1 * dt;
    let dx = 0, dz = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) dz -= sp;
    if (k.has('KeyS') || k.has('ArrowDown')) dz += sp;
    if (k.has('KeyA') || k.has('ArrowLeft')) dx -= sp;
    if (k.has('KeyD') || k.has('ArrowRight')) dx += sp;
    if (dx || dz) rig.panBy(dx, dz);
    if (k.has('KeyQ')) rig.tYaw += dt * 1.6;
    if (k.has('KeyE')) rig.tYaw -= dt * 1.6;
    if (k.has('KeyR') || k.has('PageUp')) rig.zoomAt(0, 0, Math.exp(-dt * 1.6));
    if (k.has('KeyF') && false) rig.zoomAt(0, 0, Math.exp(dt * 1.6));
    this.ground = this.mouse.x >= 0 ? this.pickGround() : null;
    this.applyHeld(dt);
    // held creature follows the cursor, hovering
    if (this.held && this.ground) {
      const target = this.ground.clone();
      target.y = Math.max(target.y, 0) + 1.6 + Math.sin(performance.now() * 0.006) * 0.08;
      const prev = this.held.pos.clone();
      this.held.pos.lerp(target, Math.min(1, dt * 14));
      const v = this.held.pos.clone().sub(prev).divideScalar(Math.max(dt, 0.001));
      this.held.vel.lerp(v, 0.35);
      this.game.units.physics.set(this.held.id, { pos: this.held.pos.clone(), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(performance.now() * 0.01) * 0.3, 0, Math.cos(performance.now() * 0.013) * 0.3)) });
      const u = this.game.sim.unitMap.get(this.held.id);
      if (u) { u.x = u.px = this.held.pos.x; u.z = u.pz = this.held.pos.z; }
    }
    // brush ring
    const p = POWER_MAP.get(store.s.power);
    const showRing = !!p && !!this.ground && (p.mode === 'brush' || p.mode === 'click' || p.mode === 'unit' || p.mode === 'pair' || p.mode === 'grab' || p.mode === 'village');
    this.ring.visible = this.ringFill.visible = showRing;
    if (showRing && this.ground) {
      const area = p!.mode === 'brush' || (p!.mode === 'click' && store.s.count > 1);
      const r = area ? store.s.brush + 0.5 : Math.max(0.5, rig.V / 70);
      const sh = p!.mode === 'brush' ? store.s.brushShape : 'circle';
      const w = this.game.sim.world;
      const hs = U.uHeightScale.value;
      const pos = this.ring.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const a = (i / pos.count) * Math.PI * 2;
        // walk the outline of the brush shape: scale the unit direction until it reaches distance r
        const cx = Math.cos(a), cz = Math.sin(a);
        const k = r / Math.max(1e-6, brushDist(sh, cx, cz));
        const x = this.ground.x + cx * k, z = this.ground.z + cz * k;
        const t = w.tileAt(x, z);
        const y = Math.max(heightCubic(w.height, w.W, w.H, x, z), t >= 0 ? w.water[t] : 0) * hs + 0.06;
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
      const col = ACCENT[p!.cat] ?? 0xffffff;
      (this.ring.material as THREE.LineBasicMaterial).color.setHex(col);
      (this.ringFill.material as THREE.MeshBasicMaterial).color.setHex(col);
      const pulse = this.btn === 0 ? 0.28 : 0.13;
      (this.ringFill.material as THREE.MeshBasicMaterial).opacity = pulse;
      this.ringFill.position.set(this.ground.x, Math.max(this.ground.y, 0) * hs + 0.05, this.ground.z);
      this.ringFill.scale.setScalar(r);
      this.ringFill.visible = sh === 'circle' || sh === 'spray';
    }
  }
}

void SPECIES; void isCiv;
