import { generateWorld } from './sim/worldgen';
import { GameRenderer } from './render/gameRenderer';
import { Input } from './input';
import { Sim } from './sim/sim';
import { seedLife } from './sim/seed';
import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gr = new GameRenderer(canvas);
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 12345);
const size = Number(params.get('size') ?? 192);
const shape = (params.get('shape') ?? 'continents') as any;
const t0 = performance.now();
const world = generateWorld({ seed, size, shape });
console.log('worldgen ms', (performance.now() - t0).toFixed(0));
const sim = new Sim(world, seed);
seedLife(sim);
const game = new Game(gr);
await game.init();
game.setSim(world, sim);
const pre = Number(params.get('pre') ?? 0);
for (let i = 0; i < pre; i++) sim.step();
new Input(canvas, gr.rig);
const z = params.get('zoom');
if (z !== null) { gr.rig.V = gr.rig.tV = gr.rig.vFromZoom(Number(z)); }
const fx = params.get('fx'), fz = params.get('fz');
if (fx && fz) { gr.rig.focus.set(Number(fx), 0, Number(fz)); gr.rig.tFocus.copy(gr.rig.focus); }
const vil = params.get('village');
if (vil !== null) {
  const v = [...sim.villages.values()][Number(vil)];
  if (v) { gr.rig.focus.set(v.cx + 0.5, 0, v.cz + 2.5); gr.rig.tFocus.copy(gr.rig.focus); }
}
const yaw = params.get('yaw');
if (yaw) gr.rig.yaw = gr.rig.tYaw = Number(yaw);
if (params.get('speed')) game.speed = Number(params.get('speed'));
(window as any).gr = gr; (window as any).game = game; (window as any).sim = sim;
function loop() { gr.frame(); requestAnimationFrame(loop); }
loop();
