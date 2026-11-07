/**
 * War overlay data (headless): campaigns appear for kingdoms at war (from the marching army, or the
 * capital while mustering), point at the right town, and front lines cover exactly the borders where
 * warring territories touch (none in peace).
 * Usage: npx tsx tools/wartest.ts
 */
import { generateWorld } from '../src/sim/worldgen';
import { Sim } from '../src/sim/sim';
import { seedLife } from '../src/sim/seed';
import { YEAR_TICKS } from '../src/sim/defs';
import { declareWar, makePeace } from '../src/sim/civ';
import { WarOverlay } from '../src/render/war';
import { CameraRig } from '../src/render/cameraRig';

let fails = 0;
const check = (name: string, ok: boolean, info: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${info}`); if (!ok) fails++; };
// a world where two kingdoms' territories touch (try a few seeds)
let w = generateWorld({ size: 192, shape: 'pangaea', seed: 909 }), sim = new Sim(w, 909);
let pair: [number, number] | null = null;
const kOf = (vid: number) => sim.villages.get(vid)?.kingdom ?? -1;
for (const seed of [909, 910, 911, 912, 913, 914]) {
  w = generateWorld({ size: 192, shape: 'pangaea', seed }); sim = new Sim(w, seed); seedLife(sim, { tribes: 6 });
  for (let i = 0; i < YEAR_TICKS * 10; i++) sim.step();
  for (let t = 0; t < w.N - 1 && !pair; t++) { const a = w.owner[t], b = w.owner[t + 1]; if (a >= 0 && b >= 0 && kOf(a) !== kOf(b) && kOf(a) >= 0 && kOf(b) >= 0) pair = [kOf(a), kOf(b)]; }
  if (pair) break;
}
if (!pair) { console.log('FAIL no touching kingdoms in any test world'); process.exit(1); }
const ka = sim.kingdoms.get(pair[0])!, kb = sim.kingdoms.get(pair[1])!;
for (const k of [ka, kb]) for (const o of sim.kingdoms.values()) if (k.wars.includes(o.id)) makePeace(sim, k, o);
const rig = new CameraRig(16 / 9); rig.setMap(w.W, w.H); rig.V = rig.tV = rig.vFromZoom(0.8); rig.update(0.016);
const ov = new WarOverlay();
const refresh = () => { (ov as any).acc = 1; ov.update(sim, rig, 0.016); };
refresh();
const peaceFront = ov.frontTiles;
declareWar(sim, ka, kb, true);
sim.laws.wars = true;
// front lines right after the declaration, against a direct count of shared border edges
const frontAt = () => { let n = 0; for (let z = 0; z < w.H - 1; z++) for (let x = 0; x < w.W - 1; x++) { const t = z * w.W + x, o = w.owner[t]; if (o < 0) continue; for (const nb of [t + 1, t + w.W]) { const on = w.owner[nb]; if (on < 0 || on === o) continue; const a = kOf(o), b = kOf(on); if (a !== b && sim.kingdoms.get(a)?.wars.includes(b)) n++; } } return n; };
refresh();
const warFront = ov.frontTiles, warExpect = frontAt();
let firstCamp = -1, armyCamp = false;
for (let i = 0; i < 1200; i++) {
  sim.step();
  if (!ka.wars.includes(kb.id)) declareWar(sim, ka, kb, true);
  if (i % 25 === 0) {
    refresh();
    if (firstCamp < 0 && ov.campaigns.length) firstCamp = i;
    if (ov.campaigns.some((c) => c.soldiers > 0)) armyCamp = true;
  }
}
refresh();
// expected front: count shared edges directly
let expect = 0;
for (let z = 0; z < w.H - 1; z++) for (let x = 0; x < w.W - 1; x++) {
  const t = z * w.W + x, o = w.owner[t]; if (o < 0) continue;
  for (const n of [t + 1, t + w.W]) { const on = w.owner[n]; if (on < 0 || on === o) continue; const a = kOf(o), b = kOf(on); if (a !== b && sim.kingdoms.get(a)?.wars.includes(b)) expect++; }
}
const targetsOk = ov.campaigns.every((c) => { const v = sim.villages.get(c.to); return !!v && Math.abs(v.cx + 0.5 - c.tx) < 0.01 && sim.kingdoms.get(c.from)!.wars.includes(v.kingdom); });
check('campaign arrows appear for the war and point at enemy towns', firstCamp >= 0 && targetsOk, `first campaign after ${(firstCamp / 10).toFixed(1)} s, campaigns now ${ov.campaigns.length}, all aimed at enemy towns ${targetsOk}, army-led arrows seen ${armyCamp}`);
check('front lines cover exactly the warring borders', warFront === warExpect && warExpect > 0 && peaceFront === 0 && ov.frontTiles === expect, `front edges at the declaration ${warFront} (expected ${warExpect}), 2 min later ${ov.frontTiles} (expected ${expect}), in peace ${peaceFront}`);
makePeace(sim, ka, kb); refresh();
check('peace clears the overlay for that pair', !ov.campaigns.some((c) => (c.from === ka.id && kOf(c.to) === kb.id) || (c.from === kb.id && kOf(c.to) === ka.id)), `campaigns left between them ${ov.campaigns.filter((c) => c.from === ka.id || c.from === kb.id).length}`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
