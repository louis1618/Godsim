import { Sim } from './sim';
import { UF, Emote } from './entities';
import { SPECIES, Feat, Mat, isCiv, Bk } from './defs';
import { ignite } from './nature';
import { hurt, panic } from './ai';

/** Shared blast: damages units, buildings, scorches terrain, digs a crater. */
export function explode(sim: Sim, x: number, z: number, radius: number, power: number, opts: { crater?: number; fire?: boolean; fling?: boolean } = {}) {
  const w = sim.world;
  sim.fx.push({ t: 'explosion', x, z, a: radius, b: power });
  // units
  sim.near(x, z, radius * 1.6, (u, d2) => {
    const d = Math.sqrt(d2);
    const f = 1 - d / (radius * 1.6);
    hurt(sim, u, power * f * (d < radius ? 1 : 0.4), undefined, 'explosion');
    if (opts.fling !== false && !(u.flags & UF.Dead) || (u.flags & UF.Dead)) {
      const dx = (u.x - x) / (d || 1), dz = (u.z - z) / (d || 1);
      const s = (0.5 + f) * Math.min(1.6, power / 60);
      sim.fling(u, dx * s * 6, s * 9, dz * s * 6);
    }
    if (!(u.flags & UF.Dead)) panic(sim, u, x, z);
  });
  // terrain
  const R = Math.ceil(radius);
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const xx = Math.floor(x) + dx, zz = Math.floor(z) + dz;
    if (!w.inside(xx, zz)) continue;
    const d = Math.hypot(dx, dz);
    if (d > radius) continue;
    const t = w.idx(xx, zz);
    const k = 1 - d / radius;
    if (opts.crater) w.height[t] -= opts.crater * k * k;
    if (w.feat[t] !== Feat.None) {
      if (Feat.Boulder === w.feat[t] || Feat.Ore === w.feat[t]) { if (k > 0.5) w.setFeat(t, Feat.None, 0); }
      else w.setFeat(t, k > 0.4 ? Feat.None : Feat.Dead, 120);
    }
    if (k > 0.25 && !w.isWater(t)) { w.mat[t] = k > 0.8 && power > 150 ? Mat.Rock : Mat.Ash; w.grass[t] = 0; }
    if (opts.fire && k < 0.9 && sim.rng.chance(0.5)) ignite(sim, t, 200);
    const b = sim.buildingAt(t);
    if (b) sim.damageBuilding(b, power * 3 * k);
  }
  w.markTerrain(Math.floor(x) - R - 2, Math.floor(z) - R - 2, Math.floor(x) + R + 2, Math.floor(z) + R + 2);
}

export function lightning(sim: Sim, x: number, z: number) {
  sim.fx.push({ t: 'lightning', x, z });
  const t = sim.world.tileAt(x, z);
  sim.near(x, z, 1.6, (u) => { hurt(sim, u, 70, undefined, 'lightning'); if (!(u.flags & UF.Dead)) { u.flags |= UF.Burning; panic(sim, u, x, z); } });
  if (t >= 0) {
    ignite(sim, t, 230);
    const b = sim.buildingAt(t);
    if (b) sim.damageBuilding(b, 120);
  }
}

export function earthquake(sim: Sim, x: number, z: number, r: number) {
  const w = sim.world;
  sim.fx.push({ t: 'quake', x, z, a: r });
  const R = Math.ceil(r);
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const xx = Math.floor(x) + dx, zz = Math.floor(z) + dz;
    if (!w.inside(xx, zz) || Math.hypot(dx, dz) > r) continue;
    const t = w.idx(xx, zz);
    // fault line ripples
    const ripple = Math.sin((dx * 0.7 + dz * 0.4) * 0.9 + sim.rng.next()) * 0.9;
    w.height[t] += ripple * (1 - Math.hypot(dx, dz) / r);
    const b = sim.buildingAt(t);
    if (b && sim.rng.chance(0.08)) sim.damageBuilding(b, 80);
    if (w.feat[t] && sim.rng.chance(0.08)) w.setFeat(t, Feat.None, 0);
  }
  w.markTerrain(Math.floor(x) - R - 2, Math.floor(z) - R - 2, Math.floor(x) + R + 2, Math.floor(z) + R + 2);
  sim.near(x, z, r, (u) => { if (sim.rng.chance(0.4)) { hurt(sim, u, 10, undefined, 'quake'); sim.fling(u, 0, 3 + sim.rng.next() * 3, 0); } panic(sim, u, u.x, u.z); });
}

export function infect(sim: Sim, x: number, z: number, r: number) {
  sim.fx.push({ t: 'plague', x, z, a: r });
  sim.near(x, z, r, (u) => { if (!SPECIES[u.sp].undead) { u.flags |= UF.Sick; sim.emote(u, Emote.Sick, 40); } });
  const k = [...sim.kingdoms.values()].find((k) => k.villages.some((vid) => { const v = sim.villages.get(vid); return v && Math.hypot(v.cx - x, v.cz - z) < 16; }));
  sim.log('plague', { a: k?.id, x, z, text: k?.name ?? '' });
}

export function spawnMeteor(sim: Sim, x: number, z: number, size = 1) {
  sim.meteors.push({ id: sim.id(), x, z, y: 120, vy: -2.5, size });
  sim.fx.push({ t: 'meteorStart', x, z, a: size });
}

export function spawnTornado(sim: Sim, x: number, z: number) {
  const a = sim.rng.range(0, Math.PI * 2);
  sim.tornadoes.push({ id: sim.id(), x, z, vx: Math.cos(a) * 0.08, vz: Math.sin(a) * 0.08, life: 500, power: 1 });
  sim.log('tornado', { x, z, text: '' });
}

export function disasterTick(sim: Sim) {
  const w = sim.world;
  // meteors falling
  for (const m of sim.meteors) {
    m.y += m.vy; m.vy -= 0.12;
    const ground = Math.max(0, w.heightAt(m.x, m.z));
    if (m.y <= ground) {
      m.y = -999;
      explode(sim, m.x, m.z, 4.5 * m.size, 180 * m.size, { crater: 3.2 * m.size, fire: true });
      const t = w.tileAt(m.x, m.z);
      if (t >= 0 && m.size >= 1) { w.mat[t] = Mat.Lava; w.markMat(w.tx(t), w.tz(t), w.tx(t), w.tz(t)); }
      sim.log('meteor', { x: m.x, z: m.z, text: '' });
    }
  }
  sim.meteors = sim.meteors.filter((m) => m.y > -900);
  // tornadoes
  for (const tn of sim.tornadoes) {
    tn.life--;
    // wander
    const a = Math.atan2(tn.vz, tn.vx) + sim.rng.range(-0.15, 0.15);
    tn.vx = Math.cos(a) * 0.09; tn.vz = Math.sin(a) * 0.09;
    tn.x += tn.vx; tn.z += tn.vz;
    if (tn.x < 2 || tn.z < 2 || tn.x > w.W - 2 || tn.z > w.H - 2) { tn.vx *= -1; tn.vz *= -1; }
    if (sim.tick % 3 === 0) {
      sim.near(tn.x, tn.z, 2.6, (u) => {
        if (u.flags & (UF.Ragdoll | UF.Held)) return;
        sim.fling(u, -tn.vz * 30 + (u.x - tn.x), 6 + sim.rng.next() * 5, tn.vx * 30 + (u.z - tn.z));
        hurt(sim, u, 8, undefined, 'tornado');
      });
      const R = 2;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const xx = Math.floor(tn.x) + dx, zz = Math.floor(tn.z) + dz;
        if (!w.inside(xx, zz)) continue;
        const t = w.idx(xx, zz);
        if (w.feat[t] !== Feat.None && sim.rng.chance(0.25)) { sim.fx.push({ t: 'uproot', x: xx + 0.5, z: zz + 0.5, a: w.feat[t] }); w.setFeat(t, Feat.None, 0); }
        const b = sim.buildingAt(t);
        if (b && b.kind !== Bk.Ruin) sim.damageBuilding(b, 9);
        if (w.fire[t] > 0) w.fire[t] = Math.max(0, w.fire[t] - 50);
      }
    }
  }
  sim.tornadoes = sim.tornadoes.filter((t) => t.life > 0);
  // random natural disasters
  if (sim.laws.disasters && sim.tick % 600 === 0 && sim.rng.chance(0.25)) {
    const x = sim.rng.range(10, w.W - 10), z = sim.rng.range(10, w.H - 10);
    const t = w.tileAt(x, z);
    if (t >= 0 && !w.isWater(t)) {
      const r = sim.rng.next();
      if (r < 0.3) spawnTornado(sim, x, z);
      else if (r < 0.5) spawnMeteor(sim, x, z, 0.8);
      else if (r < 0.7) earthquake(sim, x, z, 8);
      else if (r < 0.85 && sim.laws.plague) {
        const vs = [...sim.villages.values()].filter((v) => v.alive && v.residents.length > 10);
        if (vs.length) { const v = sim.rng.pick(vs); infect(sim, v.cx + 0.5, v.cz + 0.5, 3); }
      } else {
        sim.rainClouds.push({ id: sim.id(), x, z, vx: sim.rng.range(-0.06, 0.06), vz: sim.rng.range(-0.06, 0.06), life: 700, r: 9, storm: true });
      }
    }
  }
  void isCiv;
}
