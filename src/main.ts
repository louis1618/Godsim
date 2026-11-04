import { generateWorld } from './sim/worldgen';
import { GameRenderer } from './render/gameRenderer';
import { Input } from './input';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gr = new GameRenderer(canvas);
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 12345);
const size = Number(params.get('size') ?? 192);
const shape = (params.get('shape') ?? 'continents') as any;
const t0 = performance.now();
const world = generateWorld({ seed, size, shape });
console.log('worldgen ms', performance.now() - t0);
gr.setWorld(world);
new Input(canvas, gr.rig);
const z = params.get('zoom');
if (z !== null) { gr.rig.V = gr.rig.tV = gr.rig.vFromZoom(Number(z)); }
const fx = params.get('fx'), fz = params.get('fz');
if (fx && fz) { gr.rig.focus.set(Number(fx), 0, Number(fz)); gr.rig.tFocus.copy(gr.rig.focus); }
const yaw = params.get('yaw');
if (yaw) gr.rig.yaw = gr.rig.tYaw = Number(yaw);
(window as any).gr = gr;
function loop() { gr.frame(); requestAnimationFrame(loop); }
loop();
