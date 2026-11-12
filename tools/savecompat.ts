/**
 * Old saves keep working: load save files written by earlier versions of the game with the current
 * code and play them on.
 *  - the file loads, and every unit comes back on the current canonical shape (no missing fields)
 *  - the world then runs for years without an exception, a NaN position or a creature off the map
 *  - plants an older version left standing in water or surf are cleared by the loader
 *  - towns and wildlife are still alive afterwards and nobody is frozen in place
 *  - a save of the continued world reloads into exactly the same future (replay digest)
 * Save files are made with the version under test: check that commit out somewhere, grow a world
 * there and write `serialize(sim)` to a file.
 * Usage: npx tsx tools/savecompat.ts <save.json> [more.json ...] [--years=6]
 */
import { readFileSync } from 'fs';
import { Sim, blankUnit } from '../src/sim/sim';
import { YEAR_TICKS, Sp, isTree, isVehicle, isCiv } from '../src/sim/defs';
import { UF } from '../src/sim/entities';
import type { Unit } from '../src/sim/entities';
import { serialize, deserialize } from '../src/sim/save';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const years = Number(process.argv.find((a) => a.startsWith('--years='))?.split('=')[1] ?? 6);
if (!files.length) { console.log('usage: npx tsx tools/savecompat.ts <save.json> [more.json ...] [--years=6]'); process.exit(1); }

let fails = 0;
const check = (name: string, ok: boolean, info: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${info}`); if (!ok) fails++; };
const digest = (sim: Sim) => {
  let h = 2166136261 >>> 0;
  const mix = (n: number) => { h ^= Math.round(n * 1000) | 0; h = Math.imul(h, 16777619) >>> 0; };
  mix(sim.tick); mix(sim.units.length);
  for (const u of sim.units) { mix(u.id); mix(u.x); mix(u.z); mix(u.hp); mix(u.hunger); mix(u.flags); }
  for (const v of sim.villages.values()) { mix(v.food); mix(v.wood); mix(v.residents.length); }
  return h;
};
const STILL_OK = new Set(['sleep', 'jailed', 'escorted', 'voyage', 'post', 'board', 'build', 'farm', 'gather', 'dance', 'chat', 'love', 'graze', 'eat']);
const exempt = (u: Unit) => u.flags & (UF.Dead | UF.Ragdoll | UF.Held | UF.Jailed | UF.Aboard | UF.Escorted) || isVehicle(u.sp) || u.sp === Sp.Fish || u.sp === Sp.Dragon;
const KEYS = Object.keys(blankUnit());

for (const file of files) {
  const label = file.split('/').pop()!;
  let sim: Sim;
  const raw = readFileSync(file, 'utf8');
  try { sim = deserialize(raw); }
  catch (e) { check(`${label}: loads`, false, String((e as Error).message)); continue; }
  const w = sim.world;
  const civ0 = sim.units.filter((u) => isCiv(u.sp)).length, towns0 = [...sim.villages.values()].filter((v) => v.alive).length;
  const missing = new Set<string>();
  for (const u of sim.units) for (const k of KEYS) if (!(k in u)) missing.add(k);
  // what the file itself held (before the loader tidied it), and what is left after loading
  const wetIn = (ww: typeof w) => { let n = 0; for (let t = 0; t < ww.N; t++) if (isTree(ww.feat[t]) && (ww.isWater(t) || !ww.dryForPlant(t, 0.02))) n++; return n; };
  const fileWet = (() => { const d = JSON.parse(raw); const feat = new Uint8Array(Buffer.from(d.arrays.feat, 'base64')); const keep = w.feat; (w as any).feat = feat; const n = wetIn(w); (w as any).feat = keep; return { n, v: d.v ?? 1 }; })();
  const wet0 = wetIn(w);
  check(`${label}: loads on the current unit shape`, missing.size === 0 && wet0 === 0, `format v${fileWet.v}, world ${w.W}x${w.H} at year ${Math.floor(sim.tick / YEAR_TICKS)}, ${sim.units.length} units (${civ0} townsfolk), ${towns0} towns, ${sim.buildings.size} buildings; fields missing after load: ${missing.size ? [...missing].join(',') : 'none'}; trees in water or surf: ${fileWet.n} in the file -> ${wet0} after loading`);

  // play on
  let err = '', bad = 0, frozen = 0;
  const anchor = new Map<number, { x: number; z: number; t: number; reported: boolean }>();
  try {
    for (let i = 0; i < YEAR_TICKS * years; i++) {
      sim.step();
      if (i % 10) continue;
      for (const u of sim.units) {
        if (!Number.isFinite(u.x) || !Number.isFinite(u.z) || !Number.isFinite(u.hp) || u.x < 0 || u.z < 0 || u.x > w.W || u.z > w.H) bad++;
        if (exempt(u)) { anchor.delete(u.id); continue; }
        const a = anchor.get(u.id), k = u.task?.k ?? 'none';
        const fighting = u.anim === 3 && (k === 'attack' || k === 'hunt' || k === 'raze');
        if (!a || Math.hypot(u.x - a.x, u.z - a.z) > 0.15 || STILL_OK.has(k) || fighting) anchor.set(u.id, { x: u.x, z: u.z, t: sim.tick, reported: false });
        else if (sim.tick - a.t > 300 && !a.reported) { a.reported = true; frozen++; }
      }
    }
  } catch (e) { err = String((e as Error).stack ?? e).split('\n').slice(0, 3).join(' | '); }
  const civ1 = sim.units.filter((u) => isCiv(u.sp) && !(u.flags & UF.Dead)).length, towns1 = [...sim.villages.values()].filter((v) => v.alive).length;
  const wild1 = sim.units.filter((u) => !isCiv(u.sp) && !isVehicle(u.sp) && !(u.flags & UF.Dead)).length;
  let wet1 = 0; for (let t = 0; t < w.N; t++) if (isTree(w.feat[t]) && w.isWater(t)) wet1++; // (surf-side trees die back slowly by design)
  check(`${label}: plays on for ${years} years`, !err && bad === 0, err || `no exception, bad positions ${bad}`);
  check(`${label}: the world is still alive and healthy`, civ1 > 0 && towns1 > 0 && wild1 > 0 && frozen === 0,
    `townsfolk ${civ0} -> ${civ1}, towns ${towns0} -> ${towns1}, wildlife ${wild1}, frozen creatures ${frozen}, trees drowning in water newly made during play (craters, floods; they rot away) ${wet1}, watchdog rescues ${sim.stats.rescued ?? 0}`);
  if (err) continue;
  // the continued world saves and reloads into the same future
  const json = serialize(sim);
  const a = deserialize(json); for (let i = 0; i < 300; i++) a.step(); const da = digest(a);
  const b = deserialize(json); for (let i = 0; i < 300; i++) b.step(); const db = digest(b);
  check(`${label}: saved again, it reloads into the same future`, da === db, `two reloads after 300 ticks: ${da} vs ${db} (${(json.length / 1e6).toFixed(2)} MB)`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
