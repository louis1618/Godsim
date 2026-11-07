import { Sim } from './sim';
import { lightningTarget, lightningRod, napalmImpact } from './monsters';
import type { Unit } from './entities';
import { UF, Emote } from './entities';
import { SPECIES, Feat, Mat, isCiv, Bk, YEAR_TICKS, Sp, isVehicle } from './defs';
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

export function lightning(sim: Sim, x0: number, z0: number) {
  // lightning seeks metal: tanks, turrets, saucers and armed soldiers draw the strike to themselves
  const [x, z] = lightningTarget(sim, x0, z0);
  sim.fx.push({ t: 'lightning', x, z });
  const t = sim.world.tileAt(x, z);
  const rod = lightningRod;
  const strike = (u: Unit) => {
    // conductors take the full charge: a struck saucer drops out of the sky
    const k = u.sp === Sp.UFO ? 6 : isVehicle(u.sp) ? 3 : 1;
    hurt(sim, u, 70 * k, undefined, 'lightning');
    if (!(u.flags & UF.Dead) && u.sp !== Sp.UFO && !isVehicle(u.sp)) { u.flags |= UF.Burning; panic(sim, u, x, z); }
  };
  sim.near(x, z, 1.6, (u) => { if (u !== rod) strike(u); });
  if (rod && !(rod.flags & UF.Dead)) strike(rod);
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

/**
 * Launch ordnance at (x,z): it appears high in the sky, arms for a moment (warning on the ground),
 * then falls. A nuke takes about four seconds from launch to impact, a bomb under two.
 */
export function spawnMissile(sim: Sim, x: number, z: number, kind: 'nuke' | 'bomb' | 'napalm') {
  const nuke = kind === 'nuke';
  sim.missiles.push({ id: sim.id(), x, z, y: nuke ? 70 : 34, vy: 0, kind, arm: nuke ? 14 : 4 });
  sim.fx.push({ t: 'launch', x, z, a: nuke ? 1 : 0 });
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

// --------------------------------------------------------------------------- volcano, drought, flood

/** A volcano rises from the ground and erupts for a while; cooled lava turns to rock, ash enriches the soil. */
export function spawnVolcano(sim: Sim, x: number, z: number) {
  const w = sim.world;
  const R = 8;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const xx = Math.floor(x) + dx, zz = Math.floor(z) + dz;
    if (!w.inside(xx, zz)) continue;
    const d = Math.hypot(dx, dz);
    if (d > R) continue;
    const t = w.idx(xx, zz);
    const k = 1 - d / R;
    const crater = d < 1.6 ? -1.6 * (1 - d / 1.6) : 0;
    w.height[t] = Math.max(w.height[t], 0.4) + 9 * Math.pow(k, 1.4) + crater;
    if (w.water[t] > w.height[t]) { w.water[t] = 0; w.waterVersion++; }
    if (w.feat[t] !== Feat.None && k > 0.3) w.setFeat(t, Feat.None, 0);
    w.mat[t] = d < 1.8 ? Mat.Lava : k > 0.35 ? Mat.Rock : w.mat[t];
    const b = sim.buildingAt(t);
    if (b) sim.damageBuilding(b, 400);
  }
  w.markTerrain(Math.floor(x) - R - 2, Math.floor(z) - R - 2, Math.floor(x) + R + 2, Math.floor(z) + R + 2);
  sim.near(x, z, R, (u) => { sim.fling(u, (u.x - x) * 1.5, 7, (u.z - z) * 1.5); panic(sim, u, x, z); });
  sim.volcanoes.push({ id: sim.id(), x, z, life: 900 });
  sim.fx.push({ t: 'quake', x, z, a: 10 });
  sim.log('eruption', { x, z, text: '' });
}

export function spawnDrought(sim: Sim, x: number, z: number, r = 18) {
  sim.droughts.push({ id: sim.id(), x, z, r, life: Math.round(YEAR_TICKS * 1.5) });
  sim.fx.push({ t: 'drought', x, z, a: r });
  sim.log('drought', { x, z, text: '' });
}
export function inDrought(sim: Sim, x: number, z: number) {
  for (const d of sim.droughts) if ((x - d.x) ** 2 + (z - d.z) ** 2 < d.r * d.r) return true;
  return false;
}

/** Water surges over low ground, wrecks what it reaches, then slowly drains away. */
export function spawnFlood(sim: Sim, x: number, z: number, r = 11) {
  const w = sim.world;
  const R = Math.ceil(r);
  let lo = Infinity;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) { const xx = Math.floor(x) + dx, zz = Math.floor(z) + dz; if (w.inside(xx, zz) && Math.hypot(dx, dz) <= r) lo = Math.min(lo, w.height[w.idx(xx, zz)]); }
  const level = Math.max(lo, 0) + 1.6;
  const tiles: number[] = [], base: number[] = [];
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const xx = Math.floor(x) + dx, zz = Math.floor(z) + dz;
    if (!w.inside(xx, zz)) continue;
    const d = Math.hypot(dx, dz);
    if (d > r) continue;
    const t = w.idx(xx, zz);
    const lv = level - (d / r) * 0.5;
    if (w.height[t] >= lv) continue;
    tiles.push(t); base.push(w.water[t]);
    w.water[t] = Math.max(w.water[t], lv);
    w.waterVersion++;
    w.wet[t] = 255;
    if (w.fire[t]) w.fire[t] = 0;
  }
  w.markTerrain(Math.floor(x) - R - 2, Math.floor(z) - R - 2, Math.floor(x) + R + 2, Math.floor(z) + R + 2);
  w.islandsDirty = true; w.navVersion++;
  sim.floods.push({ id: sim.id(), x, z, r, life: 420, tiles, base, level });
  sim.fx.push({ t: 'flood', x, z, a: r });
  sim.near(x, z, r, (u) => { if (!SPECIES[u.sp].undead) panic(sim, u, x, z); });
  sim.log('flood', { x, z, text: '' });
}

function disasterExtras(sim: Sim) {
  const w = sim.world;
  // volcanoes: lava bombs, spreading lava, ash plume
  for (const v of sim.volcanoes) {
    v.life--;
    if (v.life > 0) {
      if (sim.tick % 7 === 0) { const a = sim.rng.range(0, Math.PI * 2), d = sim.rng.range(3, 13); sim.meteors.push({ id: sim.id(), x: v.x + Math.cos(a) * d, z: v.z + Math.sin(a) * d, y: 14, vy: 0.6, size: 0.3 }); }
      if (sim.tick % 15 === 0) sim.fx.push({ t: 'ash', x: v.x, z: v.z });
      if (sim.tick % 6 === 0) {
        // lava creeps downhill from the crater
        const a = sim.rng.range(0, Math.PI * 2), d = sim.rng.range(1.5, 7);
        const t = w.tileAt(v.x + Math.cos(a) * d, v.z + Math.sin(a) * d);
        if (t >= 0 && !w.isWater(t)) { w.mat[t] = Mat.Lava; if (w.feat[t]) w.setFeat(t, Feat.None, 0); ignite(sim, t, 255); w.markMat(w.tx(t), w.tz(t), w.tx(t), w.tz(t)); const b = sim.buildingAt(t); if (b) sim.damageBuilding(b, 120); }
      }
    } else {
      // eruption over: lava cools to rock, the slopes are covered in fertile ash
      const R = 10;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const xx = Math.floor(v.x) + dx, zz = Math.floor(v.z) + dz;
        if (!w.inside(xx, zz)) continue;
        const d = Math.hypot(dx, dz);
        if (d > R) continue;
        const t = w.idx(xx, zz);
        if (w.mat[t] === Mat.Lava) w.mat[t] = d < 2 ? Mat.Lava : Mat.Rock;
        else if (d > 4 && !w.isWater(t) && w.mat[t] !== Mat.Rock && sim.rng.chance(0.6)) w.mat[t] = Mat.Ash;
      }
      w.markTerrain(Math.floor(v.x) - R - 2, Math.floor(v.z) - R - 2, Math.floor(v.x) + R + 2, Math.floor(v.z) + R + 2);
    }
  }
  sim.volcanoes = sim.volcanoes.filter((v) => v.life > 0);
  // droughts: the land parches (handled in nature), they end on their own
  for (const d of sim.droughts) {
    d.life--;
    if (sim.tick % 40 === 0) {
      // rain clouds dissolve over the dry land
      for (const c of sim.rainClouds) if ((c.x - d.x) ** 2 + (c.z - d.z) ** 2 < d.r * d.r) c.life = Math.min(c.life, 20);
    }
  }
  sim.droughts = sim.droughts.filter((d) => d.life > 0);
  // floods: wreck buildings and fields while high, then drain
  for (const f of sim.floods) {
    f.life--;
    if (sim.tick % 10 === 0) {
      for (const t of f.tiles) {
        if (!w.isWater(t)) continue;
        const b = sim.buildingAt(t);
        if (b && b.kind !== Bk.Ruin) sim.damageBuilding(b, b.kind === Bk.Farm ? 6 : 14);
        if (w.feat[t] === Feat.Crop || w.feat[t] === Feat.Berry || w.feat[t] === Feat.Flower) w.setFeat(t, Feat.None, 0);
      }
    }
    if (f.life < 200 && sim.tick % 5 === 0) {
      const k = Math.max(0, f.life) / 200;
      for (let i = 0; i < f.tiles.length; i++) {
        const t = f.tiles[i];
        const lv = f.base[i] + (f.level - f.base[i]) * k;
        w.water[t] = Math.min(w.water[t], Math.max(f.base[i], lv));
        w.waterVersion++;
      }
      w.markTerrain(Math.floor(f.x - f.r) - 2, Math.floor(f.z - f.r) - 2, Math.floor(f.x + f.r) + 2, Math.floor(f.z + f.r) + 2);
      if (f.life <= 0) { for (let i = 0; i < f.tiles.length; i++) w.water[f.tiles[i]] = f.base[i]; w.islandsDirty = true; w.navVersion++; w.waterVersion++; }
    }
  }
  sim.floods = sim.floods.filter((f) => f.life > 0);
}

let nukeImpact: (sim: Sim, x: number, z: number) => void = () => {};
export function setNukeImpact(fn: (sim: Sim, x: number, z: number) => void) { nukeImpact = fn; }

export function disasterTick(sim: Sim) {
  const w = sim.world;
  disasterExtras(sim);
  // falling ordnance
  if (sim.missiles.length) {
    for (const m of sim.missiles) {
      if (m.arm > 0) { m.arm--; continue; }
      m.vy -= m.kind === 'nuke' ? 0.32 : 0.45;
      m.y += m.vy;
      const ground = Math.max(0, w.heightAt(m.x, m.z), w.water[w.tileAt(m.x, m.z)] ?? 0);
      if (m.y <= ground) {
        m.y = -999;
        if (m.kind === 'nuke') nukeImpact(sim, m.x, m.z);
        else if (m.kind === 'napalm') napalmImpact(sim, m.x, m.z);
        else explode(sim, m.x, m.z, 2.6, 110, { crater: 1.2, fire: true });
      }
    }
    sim.missiles = sim.missiles.filter((m) => m.y > -900);
  }
  // meteors falling
  for (const m of sim.meteors) {
    m.y += m.vy; m.vy -= 0.12;
    const ground = Math.max(0, w.heightAt(m.x, m.z));
    if (m.y <= ground) {
      m.y = -999;
      explode(sim, m.x, m.z, 4.5 * m.size, 180 * m.size, { crater: 3.2 * m.size, fire: true });
      const t = w.tileAt(m.x, m.z);
      if (t >= 0 && m.size >= 1) { w.mat[t] = Mat.Lava; w.markMat(w.tx(t), w.tz(t), w.tx(t), w.tz(t)); }
      if (m.size >= 0.8) sim.log('meteor', { x: m.x, z: m.z, text: '' });
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
      if (r < 0.22) spawnTornado(sim, x, z);
      else if (r < 0.32) spawnDrought(sim, x, z, 16 + sim.rng.next() * 8);
      else if (r < 0.38) spawnFlood(sim, x, z, 9);
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
