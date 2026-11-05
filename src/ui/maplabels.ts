import * as THREE from 'three';
import { Game } from '../game';
import { KINGDOM_COLORS } from '../sim/defs';
import { store } from './store';
import { U } from '../render/shared';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/**
 * Map overlay drawn in DOM: village name plates with kingdom flags and population,
 * plus pulsing battle markers where fighting is happening. Only visible in map view.
 */
export class MapLabels {
  private root: HTMLDivElement;
  private plates = new Map<number, { el: HTMLDivElement; name: HTMLSpanElement; pop: HTMLSpanElement; flag: HTMLSpanElement }>();
  private battles = new Map<number, { el: HTMLDivElement; heat: number; x: number; z: number }>();
  private v = new THREE.Vector3();
  private acc = 0;

  constructor(private game: Game, parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'maplabels';
    parent.appendChild(this.root);
  }

  update(dt: number) {
    const g = this.game, sim = g.sim, rig = g.gr.rig;
    const show = store.s.screen === 'play' && rig.z01 > 0.5 && rig.orbit < 0.05;
    const op = Math.min(1, (rig.z01 - 0.5) / 0.12);
    this.root.style.opacity = show ? String(op) : '0';
    // battle heat from this frame's hits
    for (const e of g.events) {
      if (e.t !== 'hit' && e.t !== 'bhit' && e.t !== 'arrow') continue;
      // only wars between peoples count as battles (not hunting / wolves)
      const atk = sim.unitMap.get(e.t === 'hit' ? -1 : e.u ?? -1);
      if (e.t === 'hit') { const tgt = sim.unitMap.get(e.u ?? -1); if (!tgt || tgt.sp > 3 || (e.a ?? 9) > 3) continue; }
      else if (!atk || atk.sp > 3) continue;
      const key = Math.floor(e.x / 10) * 1000 + Math.floor(e.z / 10);
      let b = this.battles.get(key);
      if (!b) {
        const el = document.createElement('div'); el.className = 'battle';
        el.innerHTML = `<img src="${store.s.icons['war'] ?? ''}">`;
        this.root.appendChild(el);
        b = { el, heat: 0, x: e.x, z: e.z };
        this.battles.set(key, b);
      }
      b.heat = Math.min(8, b.heat + 0.6);
      b.x = b.x * 0.9 + e.x * 0.1; b.z = b.z * 0.9 + e.z * 0.1;
    }
    if (!show) return;
    const cam = rig.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const hs = U.uHeightScale.value;
    for (const [k, b] of this.battles) {
      b.heat -= dt * 0.6;
      if (b.heat <= 0) { b.el.remove(); this.battles.delete(k); continue; }
      this.v.set(b.x, Math.max(0, sim.world.heightAt(b.x, b.z)) * hs + 1, b.z).project(cam);
      b.el.style.transform = `translate(${(this.v.x + 1) / 2 * W}px, ${(1 - this.v.y) / 2 * H}px) translate(-50%, -50%) scale(${0.7 + Math.min(1, b.heat / 4) * 0.5})`;
      b.el.style.opacity = String(Math.max(0, Math.min(1, (b.heat - 1.2) / 1.5)));
    }
    this.acc += dt;
    const full = this.acc > 0.25;
    if (full) this.acc = 0;
    const seen = new Set<number>();
    // most important towns claim their spot first; a plate that would overlap one already placed is hidden
    const order = [...sim.villages.values()].filter((v) => v.alive).sort((a, b) => {
      const ka = sim.kingdoms.get(a.kingdom), kb = sim.kingdoms.get(b.kingdom);
      const pa = (ka?.capital === a.id ? 1000 : 0) + a.level * 100 + a.residents.length;
      const pb = (kb?.capital === b.id ? 1000 : 0) + b.level * 100 + b.residents.length;
      return pb - pa;
    });
    const placed: [number, number, number, number][] = [];
    for (const vil of order) {
      seen.add(vil.id);
      let p = this.plates.get(vil.id);
      if (!p) {
        const el = document.createElement('div'); el.className = 'plate';
        const flag = document.createElement('span'); flag.className = 'pflag';
        const name = document.createElement('span'); name.className = 'pname';
        const pop = document.createElement('span'); pop.className = 'ppop';
        el.append(flag, name, pop);
        el.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); store.set({ sel: { kind: 'village', id: vil.id } }); });
        this.root.appendChild(el);
        p = { el, name, pop, flag };
        this.plates.set(vil.id, p);
      }
      this.v.set(vil.cx + 0.5, Math.max(0, sim.world.heightAt(vil.cx + 0.5, vil.cz + 0.5)) * hs + 2, vil.cz + 0.5).project(cam);
      const off = this.v.z > 1 || this.v.x < -1.2 || this.v.x > 1.2 || this.v.y < -1.2 || this.v.y > 1.2;
      const big = vil.level >= 2;
      const sx = (this.v.x + 1) / 2 * W, sy = (1 - this.v.y) / 2 * H - 18;
      // approximate plate box (anchored bottom-centre)
      const bw = (vil.name.length * 7.5 + 58) * (big ? 1 : 0.85), bh = 26 * (big ? 1 : 0.85);
      const box: [number, number, number, number] = [sx - bw / 2, sy - bh, sx + bw / 2, sy];
      const hit = placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1]);
      const hide = off || hit;
      p.el.style.display = hide ? 'none' : '';
      if (hide) continue;
      placed.push(box);
      p.el.classList.toggle('mini', vil.level === 0 && rig.z01 > 0.9);
      p.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%) scale(${big ? 1 : 0.85})`;
      if (full || !p.name.textContent) {
        const k = sim.kingdoms.get(vil.kingdom);
        const col = k ? hex(KINGDOM_COLORS[k.color][0]) : '#aaa';
        p.flag.style.background = col;
        const cap = k && k.capital === vil.id;
        p.el.classList.toggle('cap', !!cap);
        p.el.classList.toggle('war', !!k && k.wars.length > 0);
        if (p.name.textContent !== vil.name) p.name.textContent = vil.name;
        const n = String(vil.residents.length);
        if (p.pop.textContent !== n) p.pop.textContent = n;
      }
    }
    for (const [id, p] of this.plates) if (!seen.has(id)) { p.el.remove(); this.plates.delete(id); }
  }

  clear() { this.root.innerHTML = ''; this.plates.clear(); this.battles.clear(); }
}
