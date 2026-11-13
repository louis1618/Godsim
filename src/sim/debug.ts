import { Sim } from './sim';
import { Unit, Village } from './entities';
import { Bk, isVehicle } from './defs';
import { machineDebug } from './vehicles';
import { buildingState } from './civ';

/**
 * What a unit's AI is doing right now, as label/value rows for the developer view of the
 * inspector (turn it on with F3 or ?dev): state, target, destination, route, time since it last
 * made progress, and the last recovery.
 */
export function unitDebug(sim: Sim, u: Unit): [string, string][] {
  const rows: [string, string][] = [];
  const md = isVehicle(u.sp) ? machineDebug(sim, u) : null;
  if (md) {
    rows.push(['state', md.state], ['target', md.target], ['destination', md.dest], ['route', md.path ? `${md.path} waypoints` : 'none'],
      ['no progress for', `${(md.sinceMove / 10).toFixed(1)} s`], ['recoveries', String(md.recoveries)], ['last', md.last || '-']);
    if (md.bombs !== undefined) rows.push(['bombs', String(md.bombs)], ['altitude', u.y.toFixed(1)]);
    return rows;
  }
  const t = u.task as (Record<string, unknown> & { k: string }) | null;
  rows.push(['task', t ? t.k : 'none']);
  if (t) {
    const tgt = t.u !== undefined ? `unit #${t.u}` : t.b !== undefined ? `building #${t.b}` : t.v !== undefined ? `town #${t.v}` : t.tile !== undefined ? `tile ${t.tile}` : '-';
    rows.push(['target', tgt]);
    if (typeof t.tx === 'number' && typeof t.tz === 'number') rows.push(['destination', `${t.tx.toFixed(0)},${t.tz.toFixed(0)}`]);
    else if (typeof t.sx === 'number' && typeof t.sz === 'number') rows.push(['destination', `${t.sx.toFixed(0)},${t.sz.toFixed(0)}`]);
  }
  rows.push(['intent', String(u.intent ?? 0)]);
  rows.push(['route', u.path ? `${u.path.length - u.pathI} waypoints` : 'none']);
  rows.push(['no progress for', u.wdT >= 0 ? `${((sim.tick - u.wdT) / 10).toFixed(1)} s` : '-']);
  rows.push(['stuck / blocked', `${u.stuck} / ${u.blocked ?? 0}`]);
  rows.push(['next think', `${u.think} ticks${u.lod ? ' (half rate)' : ''}`]);
  if (u.skipPrey >= 0 && sim.tick < u.skipT) rows.push(['gave up on', `unit #${u.skipPrey}`]);
  if (u.resume) rows.push(['will resume', (u.resume as { k: string }).k]);
  if (u.vx || u.vz || u.y > 0) rows.push(['motion', `v ${u.vx.toFixed(2)},${u.vz.toFixed(2)} y ${u.y.toFixed(2)}`]);
  return rows;
}

/** Upkeep state of a town's buildings for the developer view. */
export function villageDebug(sim: Sim, v: Village): [string, string][] {
  const n: Record<string, number> = {};
  for (const id of v.buildings) { const b = sim.buildings.get(id); if (b) { const s = buildingState(sim, b); n[s] = (n[s] ?? 0) + 1; } }
  let ruins = 0, left = 0;
  for (const b of sim.buildings.values()) if (b.kind === Bk.Ruin && (b.site === v.id || Math.hypot(b.x - v.cx, b.z - v.cz) < v.radius + 4)) { ruins++; left += (b.salvage?.[0] ?? 0) + (b.salvage?.[1] ?? 0) + (b.salvage?.[2] ?? 0); }
  return [
    ['buildings', Object.entries(n).map(([k, c]) => `${k} ${c}`).join(', ') || '-'],
    ['rubble', `${ruins} heaps, ${left} materials left`],
    ['working on', `${(v.salvageSite ?? -1) >= 0 ? 'rubble #' + v.salvageSite : '-'} / repair ${(v.repairSite ?? -1) >= 0 ? '#' + v.repairSite : '-'}`],
    ['rebuild queue', String(v.rebuilds?.length ?? 0)],
    ['saving for', (v.saveFor ?? -1) >= 0 ? `kind ${v.saveFor}` : '-'],
  ];
}
