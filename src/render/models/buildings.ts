import * as THREE from 'three';
import { ModelBuilder, T, geo, hex, vgrad, noisy } from './kit';
import { Sp, Bk } from '../../sim/defs';

/**
 * Procedural architecture. Origin = footprint centre on the ground, front door facing +Z.
 * Slot 1 = kingdom colour (roofs, banners), slot 5 = light kingdom colour.
 * Part 1 = rotor (windmill blades, spins about Z), part 2 = flame (flickers), part 3 = flag (waves).
 */
const TEAM = { color: 0xffffff, slot: 1 } as const;
const TEAM_L = { color: 0xffffff, slot: 5 } as const;

interface Style {
  wall: number; wall2: number; trim: number; base: number; roofMix: number; door: number; window: number;
}
const STYLES: Record<number, Style> = {
  [Sp.Human]: { wall: 0xf3e6c8, wall2: 0xe8d6b0, trim: 0x6b4428, base: 0x9d968c, roofMix: 0, door: 0x6b4428, window: 0x9fd4ef },
  [Sp.Elf]: { wall: 0xf4f1e6, wall2: 0xe3dccb, trim: 0xa98a5c, base: 0xb9b3a2, roofMix: 0, door: 0x8a6a42, window: 0xbff0d8 },
  [Sp.Dwarf]: { wall: 0xa7a097, wall2: 0x8f887f, trim: 0x5a4a3a, base: 0x6f6a64, roofMix: 0, door: 0x5b3b24, window: 0xffb35a },
  [Sp.Orc]: { wall: 0x9a7650, wall2: 0x7f5f3e, trim: 0x4a3322, base: 0x6a5c4d, roofMix: 0, door: 0x3a2618, window: 0xff8a3a },
};

function flag(b: ModelBuilder, x: number, y: number, z: number, h: number, w = 0.32) {
  b.add(geo.cyl(0.02, 0.025, h, 5), { color: 0x6b4428 }, T(x, y + h / 2, z));
  b.add(geo.sphere(0.035, 6, 4), { color: 0xd9b84a }, T(x, y + h + 0.02, z));
  b.add(geo.box(w, w * 0.62, 0.015), { ...TEAM, part: 3, pivot: [x, y + h, z] }, T(x + w / 2 + 0.02, y + h - w * 0.33, z));
}

function windows(b: ModelBuilder, s: Style, w: number, d: number, y: number, n: number, depth = 0.02) {
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : -w * 0.3 + (i / (n - 1)) * w * 0.6;
    for (const side of [-1, 1]) {
      b.add(geo.box(0.16, 0.18, 0.02), { color: s.trim }, T(x, y, side * (d / 2 + depth)));
      b.add(geo.box(0.11, 0.13, 0.02), { color: s.window }, T(x, y, side * (d / 2 + depth + 0.008)));
    }
  }
}

function door(b: ModelBuilder, s: Style, z: number, w = 0.24, h = 0.38) {
  b.add(geo.box(w + 0.06, h + 0.04, 0.03), { color: s.trim }, T(0, h / 2, z));
  b.add(geo.box(w, h, 0.04), { color: s.door }, T(0, h / 2, z + 0.01));
  b.add(geo.sphere(0.018, 5, 4), { color: 0xd9b84a }, T(w * 0.3, h * 0.45, z + 0.04));
}

/** gable roof along X: ridge height h above y */
function gable(b: ModelBuilder, len: number, w: number, h: number, y: number, slot = true) {
  const thick = 0.06;
  const ang = Math.atan2(h, w / 2);
  const slope = Math.hypot(h, w / 2) + 0.08;
  for (const side of [-1, 1]) {
    b.add(geo.rbox(len + 0.16, thick, slope, 0.025, 1), slot ? { ...TEAM, ao: [y, y + h, 0.75] } : { color: 0x9a5a3a }, T(0, y + h / 2, side * (w / 4), side * ang, 0, 0));
  }
  // gable ends
  b.add(geo.prism(len, w, h), { color: 0xf0e2c0 }, T(0, y, 0));
}

function chimney(b: ModelBuilder, x: number, y: number, z: number, h: number, col = 0x8d8780) {
  b.add(geo.rbox(0.14, h, 0.14, 0.02, 1), { color: col }, T(x, y + h / 2, z));
  b.add(geo.rbox(0.18, 0.05, 0.18, 0.015, 1), { color: 0x6f6a64 }, T(x, y + h, z));
}

function barrel(b: ModelBuilder, x: number, z: number, s = 1) {
  b.add(geo.cyl(0.07 * s, 0.07 * s, 0.16 * s, 8), { color: 0x9a6a3a }, T(x, 0.08 * s, z));
  b.add(geo.torus(0.072 * s, 0.008, 4, 10), { color: 0x4a4a4a }, T(x, 0.04 * s, z, Math.PI / 2));
  b.add(geo.torus(0.072 * s, 0.008, 4, 10), { color: 0x4a4a4a }, T(x, 0.12 * s, z, Math.PI / 2));
}
function crate(b: ModelBuilder, x: number, z: number, s = 1, r = 0) {
  b.add(geo.rbox(0.16 * s, 0.16 * s, 0.16 * s, 0.015, 1), { color: 0xb88a52 }, T(x, 0.08 * s, z, 0, r, 0));
}

function bonfire(b: ModelBuilder, x: number, z: number, s = 1) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.add(geo.sphere(0.05 * s, 6, 4), { color: 0x8d8780, flat: true }, T(x + Math.cos(a) * 0.15 * s, 0.03, z + Math.sin(a) * 0.15 * s));
  }
  b.add(geo.cyl(0.02 * s, 0.025 * s, 0.25 * s, 5), { color: 0x5b3b24 }, T(x, 0.06, z, 0, 0, 1.2));
  b.add(geo.cyl(0.02 * s, 0.025 * s, 0.25 * s, 5), { color: 0x5b3b24 }, T(x, 0.06, z, 1.2, 0, 0));
  b.add(geo.cone(0.09 * s, 0.24 * s, 6), { color: 0xffa52a, part: 2, pivot: [x, 0.04, z] }, T(x, 0.15 * s, z));
  b.add(geo.cone(0.05 * s, 0.16 * s, 6), { color: 0xfff09a, part: 2, pivot: [x, 0.04, z] }, T(x, 0.13 * s, z));
}

// ----------------------------------------------------------------- houses

function house(race: Sp, seed: number): THREE.BufferGeometry {
  const b = new ModelBuilder(seed, true);
  const s = STYLES[race];
  switch (race) {
    case Sp.Human: {
      b.add(geo.rbox(1.5, 0.16, 1.3, 0.04, 1), { color: noisy(s.base, 0.06, 6) }, T(0, 0.08, 0));
      b.add(geo.rbox(1.34, 0.72, 1.14, 0.03, 1), { color: vgrad(s.wall2, s.wall, 0.1, 0.9) }, T(0, 0.52, 0));
      // timber frame
      for (const x of [-0.66, 0.66]) for (const z of [-0.56, 0.56]) b.add(geo.box(0.07, 0.74, 0.07), { color: s.trim }, T(x, 0.52, z));
      for (const z of [-0.575, 0.575]) { b.add(geo.box(1.36, 0.06, 0.03), { color: s.trim }, T(0, 0.86, z)); b.add(geo.box(1.36, 0.05, 0.03), { color: s.trim }, T(0, 0.2, z)); }
      b.add(geo.box(0.05, 0.75, 0.03), { color: s.trim }, T(-0.36, 0.52, 0.575, 0, 0, 0.6));
      door(b, s, 0.575);
      windows(b, s, 1.2, 1.14, 0.58, 2, 0.0);
      gable(b, 1.5, 1.36, 0.62, 0.88);
      chimney(b, 0.42, 1.05, -0.22, 0.45);
      // flower box + lantern
      b.add(geo.box(0.22, 0.06, 0.07), { color: 0x7a5235 }, T(0.36, 0.47, 0.62));
      for (let i = 0; i < 3; i++) b.add(geo.sphere(0.03, 5, 4), { color: [0xf28bb8, 0xf7d84a, 0xffffff][i] }, T(0.29 + i * 0.07, 0.52, 0.63));
      barrel(b, -0.62, 0.78);
      break;
    }
    case Sp.Elf: {
      b.add(geo.cyl(0.66, 0.72, 0.12, 14), { color: s.base }, T(0, 0.06, 0));
      b.add(geo.cyl(0.55, 0.6, 0.75, 14, 3), { color: vgrad(s.wall2, s.wall, 0.1, 0.9) }, T(0, 0.5, 0));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; b.add(geo.cyl(0.035, 0.05, 0.85, 5), { color: s.trim }, T(Math.cos(a) * 0.6, 0.5, Math.sin(a) * 0.6, 0, 0, 0)); }
      // leaf dome roof
      b.add(geo.sphere(0.78, 16, 10, ), { color: vgrad(0x3e8a46, 0x8fd06a, 0.85, 1.6), leaf: 1, jitter: 0.03 }, T(0, 0.85, 0, 0, 0, 0, 1, 0.75, 1));
      b.add(geo.cone(0.12, 0.35, 6), { ...TEAM }, T(0, 1.55, 0));
      b.add(geo.torus(0.6, 0.04, 5, 16), { ...TEAM_L }, T(0, 0.88, 0, Math.PI / 2));
      door(b, s, 0.6, 0.22, 0.4);
      b.add(geo.sphere(0.06, 8, 6), { color: 0xfff3b0, part: 2, pivot: [0.3, 0.5, 0.68] }, T(0.32, 0.55, 0.68));
      break;
    }
    case Sp.Dwarf: {
      b.add(geo.rbox(1.55, 0.2, 1.4, 0.04, 1), { color: s.base }, T(0, 0.1, 0));
      b.add(geo.rbox(1.4, 0.6, 1.24, 0.06, 1), { color: noisy(s.wall, 0.08, 7) }, T(0, 0.48, 0));
      for (const z of [-0.63, 0.63]) b.add(geo.box(1.42, 0.06, 0.02), { color: 0x5f6368 }, T(0, 0.74, z));
      b.add(geo.pyramid(1.75, 0.55), { ...TEAM, ao: [0.78, 1.3, 0.7], flat: true }, T(0, 1.05, 0, 0, 0, 0, 1, 1, 0.9));
      // stone arch door
      b.add(geo.cyl(0.18, 0.18, 0.06, 10, 1, false), { color: 0x5f5a54 }, T(0, 0.38, 0.62, Math.PI / 2));
      door(b, s, 0.63, 0.26, 0.34);
      chimney(b, -0.4, 0.9, -0.3, 0.55, 0x6f6a64);
      b.add(geo.sphere(0.06, 6, 4), { color: 0xff9a3a, part: 2, pivot: [-0.4, 1.45, -0.3] }, T(-0.4, 1.47, -0.3));
      windows(b, s, 1.2, 1.24, 0.5, 2, 0.0);
      crate(b, 0.62, 0.8, 1, 0.3);
      break;
    }
    case Sp.Orc: {
      // hide tent hut
      b.add(geo.cyl(0.62, 0.7, 0.1, 9), { color: 0x6a5c4d }, T(0, 0.05, 0));
      b.add(geo.cyl(0.18, 0.66, 1.1, 9, 2), { color: vgrad(0x7a5a3a, 0xb08458, 0, 1.2), flat: true }, T(0, 0.6, 0));
      b.add(geo.cyl(0.19, 0.5, 0.25, 9), { ...TEAM, flat: true }, T(0, 0.75, 0));
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; b.add(geo.cyl(0.02, 0.025, 0.55, 4), { color: 0x4a3322 }, T(Math.cos(a) * 0.12, 1.3, Math.sin(a) * 0.12, Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4)); }
      b.add(geo.box(0.3, 0.42, 0.05), { color: 0x2a1c12 }, T(0, 0.24, 0.6, -0.12));
      // tusks & skull
      for (const side of [-1, 1]) b.add(geo.cone(0.04, 0.35, 5), { color: 0xf3ecd8 }, T(side * 0.25, 0.55, 0.62, -0.9, 0, side * 0.3));
      b.add(geo.sphere(0.07, 8, 6), { color: 0xeae2cc }, T(0, 0.62, 0.6));
      bonfire(b, 0.62, 0.62, 0.7);
      break;
    }
  }
  return b.build();
}

// ----------------------------------------------------------------- town halls

function townHall(race: Sp, level: number): THREE.BufferGeometry {
  const b = new ModelBuilder(31 + level, true);
  const s = STYLES[race];
  if (level === 0) {
    // camp: tent + bonfire + supplies
    b.add(geo.cyl(0.02, 0.62, 0.9, 8, 1), { ...TEAM, flat: true, ao: [0, 0.9, 0.7] }, T(-0.35, 0.45, -0.25));
    b.add(geo.box(0.3, 0.4, 0.03), { color: 0x3a2618 }, T(-0.35, 0.2, 0.32, -0.25));
    bonfire(b, 0.55, 0.45, 1.3);
    crate(b, 0.75, -0.6, 1.1, 0.4); crate(b, 0.92, -0.45, 0.9, 0.1); barrel(b, 0.55, -0.85, 1.1);
    for (let i = 0; i < 3; i++) b.add(geo.cyl(0.05, 0.05, 0.42, 6), { color: 0x9a6a3a }, T(-0.9 + i * 0.03, 0.06 + i * 0.07, 0.7 - i * 0.11, 0, 0.3, Math.PI / 2));
    flag(b, -0.95, 0, -0.9, 1.1);
    return b.build();
  }
  const big = level >= 2, castle = level >= 3;
  switch (race) {
    case Sp.Human: {
      b.add(geo.rbox(2.6, 0.2, 2.4, 0.05, 1), { color: noisy(s.base, 0.06, 5) }, T(0, 0.1, 0));
      b.add(geo.rbox(2.2, 1.0, 1.8, 0.04, 1), { color: vgrad(s.wall2, s.wall, 0.1, 1.2) }, T(0, 0.68, 0));
      for (const x of [-1.07, 1.07]) for (const z of [-0.87, 0.87]) b.add(geo.box(0.09, 1.0, 0.09), { color: s.trim }, T(x, 0.68, z));
      b.add(geo.box(2.22, 0.07, 1.84), { color: s.trim }, T(0, 1.18, 0));
      gable(b, 2.4, 2.0, 0.85, 1.18);
      door(b, s, 0.91, 0.36, 0.55);
      windows(b, s, 2.0, 1.8, 0.75, 3, 0.0);
      flag(b, 0, 2.0, 0, 0.6, 0.4);
      if (big) {
        b.add(geo.rbox(0.8, 1.9, 0.8, 0.04, 1), { color: noisy(0xb9b3a8, 0.06, 4) }, T(0.85, 0.95, -0.65));
        for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; b.add(geo.box(0.2, 0.18, 0.2), { color: 0xa9a398 }, T(0.85 + Math.cos(a) * 0.32, 1.98, -0.65 + Math.sin(a) * 0.32)); }
        b.add(geo.pyramid(0.95, 0.7), { ...TEAM, flat: true }, T(0.85, 2.3, -0.65));
      }
      if (castle) {
        for (const [x, z] of [[-1.2, 1.1], [1.2, 1.1], [-1.2, -1.1]]) {
          b.add(geo.cyl(0.28, 0.32, 1.5, 10), { color: noisy(0xb9b3a8, 0.06, 4) }, T(x, 0.75, z));
          b.add(geo.cone(0.38, 0.6, 10), { ...TEAM }, T(x, 1.8, z));
        }
        b.add(geo.box(2.4, 0.5, 0.12), { color: 0xa9a398 }, T(0, 0.25, 1.15));
      }
      break;
    }
    case Sp.Elf: {
      // great tree hall
      b.add(geo.cyl(0.38, 0.62, 1.8, 10, 4), { color: vgrad(0x6b4a2e, 0x8a6a42, 0, 1.8), jitter: 0.03 }, T(0, 0.9, -0.2));
      b.add(geo.cyl(0.95, 1.05, 0.9, 16, 2), { color: vgrad(s.wall2, s.wall, 0.1, 1) }, T(0, 0.45, 0.15));
      b.add(geo.torus(0.98, 0.05, 5, 18), { ...TEAM_L }, T(0, 0.9, 0.15, Math.PI / 2));
      b.add(geo.sphere(1.1, 14, 10), { color: vgrad(0x3e8a46, 0x9ad66e, 1.6, 2.8), leaf: 1, jitter: 0.08 }, T(0, 2.2, -0.2, 0, 0, 0, 1.1, 0.75, 1.1));
      b.add(geo.sphere(0.7, 12, 8), { color: vgrad(0x3e8a46, 0x9ad66e, 1.6, 2.8), leaf: 1, jitter: 0.06 }, T(0.7, 1.9, 0.2));
      door(b, s, 1.08, 0.32, 0.55);
      flag(b, -0.95, 0.9, 0.8, 0.9);
      if (big) for (const side of [-1, 1]) { b.add(geo.cyl(0.32, 0.36, 1.3, 10), { color: s.wall }, T(side * 1.05, 0.65, -0.6)); b.add(geo.sphere(0.45, 10, 6), { color: vgrad(0x3e8a46, 0x9ad66e, 1.2, 1.9), leaf: 1 }, T(side * 1.05, 1.45, -0.6, 0, 0, 0, 1, 0.8, 1)); }
      if (castle) { b.add(geo.cone(0.3, 1.2, 8), { ...TEAM }, T(0, 3.2, -0.2)); for (const side of [-1, 1]) b.add(geo.sphere(0.12, 8, 6), { color: 0xfff3b0, part: 2, pivot: [side, 1, 1] }, T(side * 0.6, 1.0, 1.1)); }
      break;
    }
    case Sp.Dwarf: {
      // mountain hall: carved stone mound with great door
      b.add(geo.rbox(2.7, 0.25, 2.5, 0.05, 1), { color: s.base }, T(0, 0.12, 0));
      b.add(geo.sphere(1.3, 14, 10), { color: noisy(0x8f887f, 0.1, 3), flat: true, jitter: 0.06 }, T(0, 0.35, -0.1, 0, 0, 0, 1.05, 0.85, 0.95));
      b.add(geo.rbox(1.2, 1.1, 0.4, 0.05, 1), { color: 0x7a746c }, T(0, 0.6, 1.0));
      b.add(geo.box(0.5, 0.7, 0.05), { color: 0x4a3a2a }, T(0, 0.38, 1.21));
      b.add(geo.box(1.3, 0.12, 0.45), { ...TEAM }, T(0, 1.2, 1.0));
      for (const side of [-1, 1]) { b.add(geo.cyl(0.08, 0.1, 0.9, 6), { color: 0x6f6a64 }, T(side * 0.5, 0.45, 1.25)); b.add(geo.sphere(0.08, 6, 4), { color: 0xff9a3a, part: 2, pivot: [side * 0.5, 0.92, 1.25] }, T(side * 0.5, 0.95, 1.25)); }
      flag(b, 0.9, 0.8, -0.6, 1.0);
      if (big) { b.add(geo.cyl(0.35, 0.45, 1.6, 8), { color: noisy(0x9a948c, 0.07, 4), flat: true }, T(-0.8, 1.1, -0.5)); b.add(geo.pyramid(0.8, 0.5), { ...TEAM, flat: true }, T(-0.8, 2.15, -0.5)); }
      if (castle) for (const [x, z] of [[1.15, 0.95], [-1.15, 0.95]]) { b.add(geo.cyl(0.25, 0.3, 1.3, 8), { color: 0x8f887f, flat: true }, T(x, 0.65, z)); b.add(geo.pyramid(0.6, 0.4), { ...TEAM, flat: true }, T(x, 1.5, z)); }
      break;
    }
    case Sp.Orc: {
      // longhouse with palisade spikes
      b.add(geo.cyl(1.2, 1.3, 0.12, 10), { color: 0x6a5c4d }, T(0, 0.06, 0));
      b.add(geo.capsule(0.75, 1.0, 4, 10), { color: vgrad(0x6b4a2e, 0xa47a4c, 0, 1.4), flat: true }, T(0, 0.45, 0, 0, 0, Math.PI / 2, 1, 1, 1.05));
      b.add(geo.box(2.5, 0.12, 1.55), { color: 0x3a2618 }, T(0, 0.05, 0));
      b.add(geo.box(2.0, 0.2, 0.3), { ...TEAM }, T(0, 1.05, 0.45, -0.35));
      b.add(geo.box(2.0, 0.2, 0.3), { ...TEAM }, T(0, 1.05, -0.45, 0.35));
      b.add(geo.box(0.42, 0.6, 0.06), { color: 0x241810 }, T(0, 0.3, 0.75));
      for (const side of [-1, 1]) b.add(geo.cone(0.07, 0.7, 6), { color: 0xf3ecd8 }, T(side * 0.35, 0.75, 0.82, -0.9, 0, side * 0.25));
      b.add(geo.sphere(0.12, 8, 6), { color: 0xeae2cc }, T(0, 0.9, 0.78));
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 1.6 + 2.0; b.add(geo.cone(0.06, 0.6, 5), { color: 0x7a5a3a }, T(Math.cos(a) * 1.35, 0.28, Math.sin(a) * 1.25, Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2)); }
      flag(b, 1.0, 0, 0.9, 1.4);
      bonfire(b, -0.9, 0.95, 1.1);
      if (big) { b.add(geo.cyl(0.08, 0.1, 2.2, 5), { color: 0x4a3322 }, T(-1.05, 1.1, -0.7)); b.add(geo.box(0.5, 0.08, 0.5), { color: 0x6b4a2e }, T(-1.05, 2.0, -0.7)); b.add(geo.sphere(0.1, 8, 6), { color: 0xeae2cc }, T(-1.05, 2.25, -0.7)); }
      if (castle) for (const [x, z] of [[1.1, -0.9], [-0.2, -1.15]]) { b.add(geo.cyl(0.5, 0.55, 0.85, 8), { color: 0x9a7650, flat: true }, T(x, 0.42, z)); b.add(geo.cone(0.6, 0.6, 8), { ...TEAM, flat: true }, T(x, 1.1, z)); }
      break;
    }
  }
  return b.build();
}

// ----------------------------------------------------------------- other buildings

function farm(race: Sp): THREE.BufferGeometry {
  const b = new ModelBuilder(41, true);
  const post = race === Sp.Orc ? 0x5a3a22 : race === Sp.Dwarf ? 0x8d8780 : 0x9a6a3a;
  const H = 1.45;
  for (let i = 0; i <= 6; i++) {
    const t = -H + (i / 6) * H * 2;
    for (const [x, z] of [[t, -H], [t, H], [-H, t], [H, t]]) {
      if (Math.abs(x) === H && Math.abs(z) === H && i !== 0 && i !== 6) continue;
      b.add(geo.cyl(0.025, 0.03, 0.26, 5), { color: post }, T(x, 0.13, z));
    }
  }
  for (const side of [-1, 1]) {
    b.add(geo.box(H * 2, 0.03, 0.025), { color: post }, T(0, 0.18, side * H));
    b.add(geo.box(0.025, 0.03, H * 2), { color: post }, T(side * H, 0.18, 0));
  }
  // scarecrow
  b.add(geo.cyl(0.02, 0.02, 0.6, 4), { color: 0x6b4428 }, T(0.9, 0.3, -0.9));
  b.add(geo.cyl(0.015, 0.015, 0.4, 4), { color: 0x6b4428 }, T(0.9, 0.45, -0.9, 0, 0, Math.PI / 2));
  b.add(geo.sphere(0.07, 8, 6), { color: 0xe8c45a }, T(0.9, 0.62, -0.9));
  b.add(geo.cone(0.11, 0.1, 8), { color: 0x8a6a42 }, T(0.9, 0.7, -0.9));
  b.add(geo.box(0.16, 0.18, 0.08), { ...TEAM }, T(0.9, 0.42, -0.9));
  return b.build();
}

function storage(race: Sp): THREE.BufferGeometry {
  const b = new ModelBuilder(51, true);
  const s = STYLES[race];
  const wood = race === Sp.Dwarf ? 0x8f887f : race === Sp.Orc ? 0x7a5a3a : 0xa8743f;
  b.add(geo.rbox(1.6, 0.12, 1.5, 0.03, 1), { color: s.base }, T(0, 0.06, 0));
  b.add(geo.rbox(1.4, 0.8, 1.2, 0.03, 1), { color: (p) => hex(wood).multiplyScalar(0.92 + 0.12 * Math.sin(p.y * 40)) }, T(0, 0.52, -0.1));
  b.add(geo.box(0.6, 0.6, 0.04), { color: 0x6b4428 }, T(0, 0.42, 0.51));
  b.add(geo.box(0.05, 0.6, 0.05), { color: 0xe8dcc0 }, T(0, 0.42, 0.53, 0, 0, 0.78));
  b.add(geo.box(0.05, 0.6, 0.05), { color: 0xe8dcc0 }, T(0, 0.42, 0.53, 0, 0, -0.78));
  gable(b, 1.5, 1.3, 0.55, 0.92);
  for (let i = 0; i < 3; i++) crate(b, -0.6 + i * 0.18, 0.62, 1, i * 0.4);
  barrel(b, 0.55, 0.65); barrel(b, 0.68, 0.5, 0.9);
  b.add(geo.sphere(0.18, 8, 6), { color: 0xe8c45a, flat: true }, T(0.45, 0.1, -0.75, 0, 0, 0, 1.4, 0.7, 1));
  return b.build();
}

function tower(race: Sp): THREE.BufferGeometry {
  const b = new ModelBuilder(61, true);
  if (race === Sp.Orc) {
    for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) b.add(geo.cyl(0.04, 0.05, 1.6, 5), { color: 0x5a3a22 }, T(x, 0.8, z));
    b.add(geo.box(0.85, 0.08, 0.85), { color: 0x7a5a3a }, T(0, 1.55, 0));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.add(geo.cone(0.04, 0.3, 4), { color: 0x7a5a3a }, T(Math.cos(a) * 0.4, 1.72, Math.sin(a) * 0.4)); }
    b.add(geo.cone(0.6, 0.4, 6), { ...TEAM, flat: true }, T(0, 2.05, 0));
    b.add(geo.sphere(0.09, 8, 6), { color: 0xeae2cc }, T(0, 1.2, 0.33));
    return b.build();
  }
  const stone = race === Sp.Elf ? 0xf0ece0 : race === Sp.Dwarf ? 0x8f887f : 0xb9b3a8;
  const r = race === Sp.Elf ? 0.26 : 0.36;
  b.add(geo.cyl(r, r + 0.06, 1.8, 10, 3), { color: noisy(stone, 0.06, 5), flat: race === Sp.Dwarf }, T(0, 0.9, 0));
  b.add(geo.cyl(r + 0.08, r + 0.08, 0.14, 10), { color: noisy(stone, 0.06, 5) }, T(0, 1.85, 0));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.add(geo.box(0.12, 0.14, 0.12), { color: stone }, T(Math.cos(a) * (r + 0.04), 1.98, Math.sin(a) * (r + 0.04), 0, -a)); }
  if (race === Sp.Elf) b.add(geo.cone(0.34, 1.0, 10), { ...TEAM }, T(0, 2.45, 0));
  else if (race === Sp.Dwarf) { b.add(geo.cyl(0.14, 0.1, 0.12, 8), { color: 0x4a4a4a }, T(0, 2.0, 0)); b.add(geo.cone(0.12, 0.25, 6), { color: 0xffa52a, part: 2, pivot: [0, 2.05, 0] }, T(0, 2.15, 0)); }
  else b.add(geo.cone(0.5, 0.7, 10), { ...TEAM }, T(0, 2.35, 0));
  b.add(geo.box(0.12, 0.2, 0.02), { color: 0x2a2a35 }, T(0, 1.3, r + 0.04));
  b.add(geo.box(0.2, 0.32, 0.04), { color: 0x5b3b24 }, T(0, 0.16, r + 0.05));
  flag(b, 0.0, 2.0, 0, 0.7, 0.3);
  return b.build();
}

function temple(race: Sp): THREE.BufferGeometry {
  const b = new ModelBuilder(71, true);
  const stone = race === Sp.Orc ? 0x8a7a68 : race === Sp.Dwarf ? 0x8f887f : 0xefe9dc;
  b.add(geo.rbox(2.5, 0.18, 2.5, 0.04, 1), { color: noisy(0xb9b3a8, 0.05, 5) }, T(0, 0.09, 0));
  b.add(geo.rbox(2.2, 0.14, 2.2, 0.04, 1), { color: noisy(0xc9c3b8, 0.05, 5) }, T(0, 0.25, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    b.add(geo.cyl(0.09, 0.1, 1.0, 8), { color: stone }, T(Math.cos(a) * 0.85, 0.82, Math.sin(a) * 0.85));
  }
  b.add(geo.cyl(0.65, 0.7, 0.9, 12), { color: vgrad(0xd8d0c0, stone, 0.3, 1.2) }, T(0, 0.77, 0));
  b.add(geo.cyl(1.05, 1.05, 0.14, 16), { color: stone }, T(0, 1.38, 0));
  if (race === Sp.Orc) b.add(geo.cone(0.95, 1.1, 8), { ...TEAM, flat: true }, T(0, 2.0, 0));
  else b.add(geo.sphere(0.85, 16, 10, ), { color: (p) => hex(0xffd65a).lerp(hex(0xfff2b0), Math.max(0, (p.y - 1.4) / 0.9)) }, T(0, 1.45, 0, 0, 0, 0, 1, 0.9, 1));
  b.add(geo.octa(0.16), { color: 0x9fe8ff, part: 2, pivot: [0, 2.4, 0], flat: true }, T(0, 2.45, 0, 0, 0, 0, 1, 1.5, 1));
  b.add(geo.box(0.36, 0.5, 0.05), { color: 0x6b4428 }, T(0, 0.55, 0.69));
  flag(b, -1.0, 0.3, 1.0, 0.9);
  flag(b, 1.0, 0.3, 1.0, 0.9);
  return b.build();
}

function windmill(race: Sp): THREE.BufferGeometry {
  const b = new ModelBuilder(81, true);
  const wall = race === Sp.Dwarf ? 0x9a948c : race === Sp.Orc ? 0x9a7650 : 0xefe6d0;
  b.add(geo.cyl(0.42, 0.62, 1.6, 10, 3), { color: vgrad(0xcfc4ab, wall, 0, 1.4) }, T(0, 0.8, 0));
  b.add(geo.cone(0.55, 0.65, 10), { ...TEAM }, T(0, 1.9, 0));
  b.add(geo.box(0.22, 0.34, 0.04), { color: 0x6b4428 }, T(0, 0.17, 0.6));
  b.add(geo.box(0.12, 0.14, 0.03), { color: 0x9fd4ef }, T(0, 1.0, 0.5));
  const hub: [number, number, number] = [0, 1.55, 0.58];
  b.add(geo.cyl(0.07, 0.07, 0.14, 8), { color: 0x6b4428, part: 1, pivot: hub }, T(0, 1.55, 0.55, Math.PI / 2));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const m = new THREE.Matrix4().makeTranslation(hub[0], hub[1], hub[2] + 0.04).multiply(new THREE.Matrix4().makeRotationZ(a));
    b.add(geo.box(0.05, 0.95, 0.03), { color: 0x7a5235, part: 1, pivot: hub }, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)));
    b.add(geo.box(0.2, 0.75, 0.015), { color: 0xf3ead8, part: 1, pivot: hub }, m.clone().multiply(new THREE.Matrix4().makeTranslation(0.11, 0.58, 0.01)));
  }
  return b.build();
}

function ruin(): THREE.BufferGeometry {
  const b = new ModelBuilder(91, true);
  b.add(geo.rbox(1.5, 0.12, 1.3, 0.03, 1), { color: 0x6f6a64 }, T(0, 0.06, 0));
  b.add(geo.box(0.12, 0.6, 1.0), { color: 0x4a4440 }, T(-0.6, 0.3, 0, 0, 0, 0.05));
  b.add(geo.box(0.8, 0.35, 0.12), { color: 0x4a4440 }, T(-0.1, 0.18, -0.5));
  b.add(geo.box(0.1, 0.45, 0.1), { color: 0x2a2420 }, T(0.5, 0.22, 0.4, 0.3, 0, 0.4));
  for (let i = 0; i < 7; i++) b.add(geo.dodeca(0.08 + (i % 3) * 0.03), { color: i % 2 ? 0x5a5550 : 0x3a3532, flat: true }, T(-0.4 + (i * 0.17) % 1.0, 0.06, -0.3 + ((i * 0.37) % 0.8), i, i * 2, 0));
  b.add(geo.box(0.9, 0.05, 0.1), { color: 0x2a2420 }, T(0.1, 0.1, 0.2, 0, 0.6, 0.15));
  return b.build();
}

export function scaffold(size: number): THREE.BufferGeometry {
  const b = new ModelBuilder(5, true);
  const h = size * 0.6 + 0.4, r = size * 0.5 - 0.05;
  for (const [x, z] of [[-r, -r], [r, -r], [-r, r], [r, r]]) b.add(geo.cyl(0.025, 0.025, h, 4), { color: 0xc8955a }, T(x, h / 2, z));
  for (const y of [h * 0.35, h * 0.75]) for (const side of [-1, 1]) {
    b.add(geo.box(r * 2, 0.03, 0.035), { color: 0xb88a52 }, T(0, y, side * r));
    b.add(geo.box(0.035, 0.03, r * 2), { color: 0xb88a52 }, T(side * r, y, 0));
  }
  b.add(geo.box(r * 2, 0.025, 0.035), { color: 0xa8743f }, T(0, h * 0.55, r, 0, 0, 0.45));
  return b.build();
}

export type BuildingKey = string;
export const bkey = (kind: Bk, race: Sp, level: number) => `${kind}-${kind === Bk.Ruin ? 0 : race}-${kind === Bk.TownHall ? level : 0}`;

export function buildBuildingModels(): Map<BuildingKey, THREE.BufferGeometry> {
  const out = new Map<BuildingKey, THREE.BufferGeometry>();
  for (const race of [Sp.Human, Sp.Elf, Sp.Dwarf, Sp.Orc]) {
    for (let l = 0; l <= 3; l++) out.set(bkey(Bk.TownHall, race, l), townHall(race, l));
    out.set(bkey(Bk.House, race, 0), house(race, 3));
    out.set(bkey(Bk.Farm, race, 0), farm(race));
    out.set(bkey(Bk.Storage, race, 0), storage(race));
    out.set(bkey(Bk.Tower, race, 0), tower(race));
    out.set(bkey(Bk.Temple, race, 0), temple(race));
    out.set(bkey(Bk.Windmill, race, 0), windmill(race));
  }
  out.set(bkey(Bk.Ruin, 0, 0), ruin());
  return out;
}
