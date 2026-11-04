import '@fontsource/lilita-one';
import '@fontsource/jua';
import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/600.css';
import './ui/style.css';
import { AppCtl } from './app';
import { store } from './ui/store';
import { audio } from './audio/audio';
import { U } from './render/shared';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
const boot = document.getElementById('boot')!;
const bar = boot.querySelector('.bar i') as HTMLElement;
const app = new AppCtl(canvas, ui);
(window as any).app = app;
(window as any).game = app.game;
(window as any).U = U;
(window as any).store = store;

let running = true;
function loop() { if (running) app.gr.frame(); requestAnimationFrame(loop); }

(async () => {
  await document.fonts?.ready;
  await app.boot((k) => { bar.style.width = `${Math.round(k * 100)}%`; });
  const params = new URLSearchParams(location.search);
  app.gr.rig.orbit = app.gr.rig.tOrbit = 1;
  loop();
  if (params.has('play')) {
    store.set({ screen: 'title' });
    app.startPlay();
    if (params.get('zoom')) { const r = app.gr.rig; r.V = r.tV = r.vFromZoom(Number(params.get('zoom'))); r.orbit = r.tOrbit = 0; }
  } else store.set({ screen: 'title' });
  revealWorld();
  audio.ui('start');
})();
/**
 * Loading hands over to the title as one gesture: the glowing seed swells into a sun and the night
 * of the loader opens as a widening circle of daylight, revealing the world (and the title) behind it.
 */
function revealWorld() {
  const core = boot.querySelector('.seed') as HTMLElement | null;
  const barEl = boot.querySelector('.bar') as HTMLElement | null;
  const r = core?.getBoundingClientRect();
  const cx = r ? r.left + r.width / 2 : innerWidth / 2, cy = r ? r.top + r.height / 2 : innerHeight * 0.45;
  const maxR = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy)) + 40;
  if (barEl) { barEl.style.transition = 'opacity .3s'; barEl.style.opacity = '0'; }
  boot.style.transition = 'none';
  const t0 = performance.now(), dur = Number(new URLSearchParams(location.search).get('reveal') ?? 1500);
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // ease in-out
    const rad = 26 + e * maxR;
    const m = `radial-gradient(circle at ${cx}px ${cy}px, transparent ${rad}px, rgba(0,0,0,.6) ${rad + 18}px, #000 ${rad + 60}px)`;
    boot.style.setProperty('mask-image', m); boot.style.setProperty('-webkit-mask-image', m);
    if (core) { core.style.transform = `scale(${1 + e * 5})`; core.style.opacity = String(1 - Math.min(1, k * 1.6)); }
    if (k < 1) requestAnimationFrame(step); else boot.remove();
  };
  requestAnimationFrame(step);
}
void running;
