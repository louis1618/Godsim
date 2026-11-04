import '@fontsource/lilita-one';
import '@fontsource/jua';
import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/600.css';
import './ui/style.css';
import { AppCtl } from './app';
import { store } from './ui/store';
import { audio } from './audio/audio';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
const boot = document.getElementById('boot')!;
const bar = boot.querySelector('.bar i') as HTMLElement;
const app = new AppCtl(canvas, ui);
(window as any).app = app;
(window as any).game = app.game;

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
  boot.classList.add('hide');
  setTimeout(() => boot.remove(), 1600);
  audio.ui('start');
})();
void running;
