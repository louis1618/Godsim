import * as THREE from 'three';
import { GameRenderer } from './render/gameRenderer';
import { Game } from './game';
import { Controller } from './controller';
import { Sim } from './sim/sim';
import { generateWorld, WorldShape } from './sim/worldgen';
import { seedLife } from './sim/seed';
import { store, WorldOpts } from './ui/store';
import { mountUI } from './ui/App';
import { forgeIcons } from './render/icons';
import { audio } from './audio/audio';
import { t } from './ui/i18n';
import { EV_ICON } from './ui/Panels';
import { U } from './render/shared';
import { KINGDOM_COLORS, YEAR_TICKS, Mat } from './sim/defs';
import { HistoryEntry } from './sim/entities';
import { saveSlot, loadSlot } from './sim/save';
import { fireTiles } from './sim/nature';
import { damp } from './core/math';
import { MapLabels } from './ui/maplabels';

interface FeedItem { key: number; t: number; icon: string; title: string; text: string; colors: string[]; x?: number; z?: number; }
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const NO_AUTO = new URLSearchParams(location.search).has('noauto');
const BIG = new Set(['war', 'rebellion', 'kingdomFell', 'captured', 'peace']);

export class AppCtl {
  gr: GameRenderer;
  game: Game;
  ctl: Controller;
  feed: FeedItem[] = [];
  banner: { t: number; icon: string; title: string; text: string } | null = null;
  popHistory: number[][] = [];
  quality: 'high' | 'low' = (localStorage.getItem('gs-quality') as 'high' | 'low') ?? 'high';
  private feedKey = 0;
  private genTimer = 0;
  private genAnim = 1;
  private previewCache = new Map<string, ImageData>();
  private lastYear = -1;
  private pendingOpts: WorldOpts | null = null;
  labels: MapLabels;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.gr = new GameRenderer(canvas);
    this.game = new Game(this.gr);
    this.ctl = new Controller(this.game, canvas);
    this.setQuality(this.quality);
    this.labels = new MapLabels(this.game, uiRoot.parentElement!);
    mountUI(uiRoot, this);
    this.gr.onFrame.push((dt) => this.frame(dt));
    const unlock = () => { audio.start(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  async boot(progress: (k: number) => void) {
    progress(0.05);
    await this.game.init();
    progress(0.15);
    const icons = await forgeIcons((k) => progress(0.15 + k * 0.6));
    store.set({ icons });
    progress(0.8);
    await new Promise((r) => setTimeout(r, 0));
    this.makeWorld({ size: 192, shape: 'continents', life: 1, seed: Math.floor(Math.random() * 99999) }, true);
    // let the title world live a little so villages already exist
    for (let i = 0; i < 700; i++) this.game.sim.step();
    progress(1);
  }

  // ------------------------------------------------------------- world lifecycle
  makeWorld(o: WorldOpts, genesis: boolean) {
    const world = generateWorld({ size: o.size, shape: o.shape as WorldShape, seed: o.seed });
    const sim = new Sim(world, o.seed);
    if (o.life > 0) seedLife(sim, { tribes: o.life === 2 ? 7 : 4, animals: true });
    fireTiles.clear();
    this.attach(sim);
    if (genesis) { this.genAnim = 0; U.uGenesis.value = 0; }
  }

  private attach(sim: Sim) {
    this.game.setSim(sim.world, sim);
    this.labels?.clear();
    this.feed = [];
    this.popHistory = [];
    this.lastYear = -1;
    sim.onHistory = (h) => this.onHistory(h);
    const rig = this.gr.rig;
    rig.focus.set(sim.world.W / 2, 0, sim.world.H / 2); rig.tFocus.copy(rig.focus);
  }

  toTitle() {
    store.set({ screen: 'title', sel: null, panel: null, menu: false });
    this.ctl.enabled = false;
    this.gr.rig.tOrbit = 1;
    this.game.speed = 1; this.game.paused = false;
    audio.ui('close');
  }

  toCreate() {
    store.set({ screen: 'create', panel: null, menu: false, sel: null });
    this.ctl.enabled = false;
    this.gr.rig.tOrbit = 1;
    audio.ui('open');
    this.previewWorld(store.s.opts);
  }

  previewWorld(o: WorldOpts) {
    this.pendingOpts = o;
    this.genTimer = 0.18;
  }

  startPlay() {
    const o = store.s.opts;
    if (this.pendingOpts) { this.makeWorld(this.pendingOpts, true); this.pendingOpts = null; }
    const rig = this.gr.rig;
    rig.tOrbit = 0;
    rig.V = rig.tV = rig.vMax;
    rig.tYaw = 0; rig.tTilt = 0;
    rig.flyTo(this.game.sim.world.W / 2, this.game.sim.world.H / 2, rig.vMax * 0.8, 1.2);
    this.game.speed = 1; this.game.paused = false;
    this.ctl.enabled = true;
    store.set({ screen: 'play', cat: 'world', power: 'inspect', sel: null });
    audio.ui('create');
    void o;
  }

  async save(slot: number) {
    // thumbnail straight from the GL canvas
    this.gr.frame();
    const src = this.gr.renderer.domElement;
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const g = c.getContext('2d')!;
    const ar = src.width / src.height;
    const sw = ar > 16 / 9 ? src.height * 16 / 9 : src.width, sh = ar > 16 / 9 ? src.height : src.width * 9 / 16;
    g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, 320, 180);
    await saveSlot(slot, this.game.sim, c.toDataURL('image/jpeg', 0.8));
    audio.ui('create');
  }

  async load(slot: number) {
    const sim = await loadSlot(slot);
    if (!sim) return;
    this.attach(sim);
    this.genAnim = 0; U.uGenesis.value = 0;
    store.set({ panel: null, menu: false });
    if (store.s.screen !== 'play') this.startPlay();
    else audio.ui('create');
  }

  setQuality(q: 'high' | 'low') {
    this.quality = q;
    localStorage.setItem('gs-quality', q);
    this.gr.setQuality(q);
  }

  // ------------------------------------------------------------- previews for the creation panel
  drawPreview(cv: HTMLCanvasElement, shape: string) {
    const key = shape + store.s.opts.seed;
    const g = cv.getContext('2d')!;
    let img = this.previewCache.get(key);
    if (!img) {
      const w = generateWorld({ size: 64, shape: shape as WorldShape, seed: store.s.opts.seed });
      img = g.createImageData(64, 64);
      const col: Record<number, number[]> = { [Mat.Sand]: [242, 220, 160], [Mat.Grass]: [143, 208, 82], [Mat.Lush]: [79, 154, 58], [Mat.Savanna]: [191, 195, 94], [Mat.Desert]: [240, 194, 123], [Mat.Snow]: [244, 247, 251], [Mat.Rock]: [154, 148, 140], [Mat.Swamp]: [108, 138, 69] };
      for (let i = 0; i < w.N; i++) {
        const c = w.isWater(i) ? (w.height[i] > -1.5 ? [90, 200, 224] : [42, 127, 196]) : col[w.mat[i]] ?? [140, 200, 80];
        img.data.set([c[0], c[1], c[2], 255], i * 4);
      }
      this.previewCache.set(key, img);
    }
    g.putImageData(img, 0, 0);
  }

  // ------------------------------------------------------------- events
  private onHistory(h: HistoryEntry) {
    const sim = this.game.sim;
    const ka = h.a !== undefined ? sim.kingdoms.get(h.a) : undefined;
    const kb = h.b !== undefined ? sim.kingdoms.get(h.b) : undefined;
    const colors = [ka, kb].filter(Boolean).map((k) => hex(KINGDOM_COLORS[k!.color][0]));
    let x = h.x, z = h.z;
    if (x === undefined && ka) { const c = sim.villages.get(ka.capital); if (c) { x = c.cx; z = c.cz; } }
    const icon = EV_ICON[h.type] ?? 'history';
    const text = h.text.replace('|', ' ⟷ ');
    if (h.type === 'newKing' && sim.tick < 200) return;
    this.feed.push({ key: this.feedKey++, t: performance.now(), icon, title: t('ev-' + h.type), text, colors, x, z });
    if (this.feed.length > 30) this.feed.shift();
    if (BIG.has(h.type) && store.s.screen === 'play') {
      this.banner = { t: performance.now(), icon, title: t('ev-' + h.type), text };
      if (h.type === 'war' || h.type === 'rebellion') audio.play(h.type === 'war' ? 'war' : 'rebel', x ?? 0, z ?? 0);
      if (h.type === 'peace') audio.play('peace', x ?? 0, z ?? 0);
      store.set({ tick: store.s.tick + 1 });
    }
  }

  // ------------------------------------------------------------- per frame
  private perfT = 0; private perfN = 0; private perfSum = 0; private lastNow = performance.now(); private autoDowngraded = false;
  /** If the machine struggles, quietly switch to the lighter renderer. */
  private watchPerf() {
    const now = performance.now();
    const ms = now - this.lastNow; this.lastNow = now;
    if (this.autoDowngraded || this.quality === 'low' || document.hidden || ms > 500) return;
    this.perfSum += ms; this.perfN++; this.perfT += ms;
    if (this.perfT > 4000) {
      const avg = this.perfSum / this.perfN;
      if (avg > 30 && store.s.screen === 'play') { this.autoDowngraded = true; this.setQuality('low'); console.info('[godsim] auto quality: low (avg frame', avg.toFixed(1), 'ms)'); }
      this.perfT = 0; this.perfN = 0; this.perfSum = 0;
    }
  }

  private frame(dt: number) {
    const sim = this.game.sim;
    if (!sim) return;
    if (!NO_AUTO) this.watchPerf();
    if (this.genTimer > 0) {
      this.genTimer -= dt;
      if (this.genTimer <= 0 && this.pendingOpts) { this.makeWorld(this.pendingOpts, true); audio.ui('whoosh'); this.pendingOpts = null; }
    }
    if (this.genAnim < 1) {
      this.genAnim = Math.min(1, this.genAnim + dt / 2.6);
      U.uGenesis.value = this.genAnim;
    }
    this.ctl.update(dt);
    this.labels.update(dt);
    // audio listener + ambience estimate around the view
    const rig = this.gr.rig;
    audio.listener.x = rig.focus.x; audio.listener.z = rig.focus.z; audio.listener.span = rig.V; audio.listener.z01 = rig.z01; audio.listener.yaw = rig.yaw;
    const w = sim.world;
    let water = 0, forest = 0, village = 0, fire = 0, n = 0;
    const R = Math.min(40, rig.V * 0.6);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, d = R * ((i % 3) + 1) / 3;
      const tt = w.tileAt(rig.focus.x + Math.cos(a) * d, rig.focus.z + Math.sin(a) * d);
      if (tt < 0) { water++; n++; continue; }
      n++;
      if (w.isWater(tt)) water++;
      if (w.feat[tt] >= 1 && w.feat[tt] <= 8) forest++;
      if (w.owner[tt] >= 0) village++;
      if (w.fire[tt] > 0) fire++;
    }
    for (const ft of fireTiles) { const fx = ft % w.W, fz = (ft / w.W) | 0; if (Math.abs(fx - rig.focus.x) < R && Math.abs(fz - rig.focus.z) < R) fire += 0.2; if (fire > 6) break; }
    const war = [...sim.kingdoms.values()].some((k) => k.alive && k.wars.length > 0);
    audio.update(dt, { water: water / n, forest: forest / n, village: village / n, rain: U.uRain.value, fire, war: war ? 1 : 0, paused: this.game.paused });
    for (const e of this.game.events) audio.event(e.t, e.x, e.z, e.a);
    // screen flash for lightning
    const fl = document.getElementById('flash');
    if (fl) fl.style.opacity = String(this.game.fx.screenFlash * 0.5);
    // population history (per year)
    if (sim.year !== this.lastYear) {
      this.lastYear = sim.year;
      const c = [0, 0, 0, 0];
      for (const u of sim.units) if (u.sp <= 3) c[u.sp]++;
      this.popHistory.push(c);
      if (this.popHistory.length > 200) this.popHistory.shift();
    }
    void YEAR_TICKS; void THREE; void damp;
  }

  click() { audio.ui('click'); }
  hoverSound() { audio.ui('hover'); }
  tabSound() { audio.ui('tab'); }
  whoosh() { audio.ui('whoosh'); }
}
