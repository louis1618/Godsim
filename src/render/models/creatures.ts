import * as THREE from 'three';
import { ModelBuilder, T, geo, hex } from './kit';
import { Sp } from '../../sim/defs';

/**
 * Rigged-by-part creature models. Parts: 0 body, 1 head, 2 L hand, 3 R hand, 4 L leg, 5 R leg,
 * 6 item (in R hand), 7 tail, 8 head attachments. Colour slots: 1 cloth (kingdom), 2 skin, 3 hair,
 * 4 cloth dark (trousers), 5 cloth light (trim). All facing +Z, feet at y=0, ~0.62 tall for a human.
 */
export const enum P { Body = 0, Head = 1, LHand = 2, RHand = 3, LLeg = 4, RLeg = 5, Item = 6, Tail = 7, HeadAtt = 8 }
const W = 0xffffff;

/** Items: 1 axe, 2 pickaxe, 3 hammer, 4 sword, 5 bow, 6 hoe, 7 cleaver, 8 warhammer, 9 basket, 10 spear, 11 torch */
function items(b: ModelBuilder, hx: number, hy: number, hz: number, s = 1) {
  const piv: [number, number, number] = [hx, hy + 0.17 * s, hz - 0.02];
  const wood = 0x8a5a33, iron = 0xb9c0c8, dark = 0x4c5056;
  const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => T(hx + x * s, hy + y * s, hz + z * s, rx, ry, rz, s);
  const add = (id: number, g: THREE.BufferGeometry, color: number, m: THREE.Matrix4) => b.add(g, { color, part: P.Item, item: id, pivot: piv, flat: id !== 9 }, m);
  // axe
  add(1, geo.cyl(0.012, 0.014, 0.22, 5), wood, at(0, 0.07, 0.02, 0.35));
  add(1, geo.box(0.02, 0.06, 0.07), iron, at(0, 0.16, 0.07, 0.35));
  // pickaxe
  add(2, geo.cyl(0.012, 0.014, 0.22, 5), wood, at(0, 0.07, 0.02, 0.35));
  add(2, geo.cone(0.018, 0.16, 4), dark, at(0, 0.165, 0.08, 0.35 + Math.PI / 2));
  add(2, geo.cone(0.018, 0.08, 4), dark, at(0, 0.19, 0.0, 0.35 - Math.PI / 2));
  // hammer
  add(3, geo.cyl(0.011, 0.013, 0.16, 5), wood, at(0, 0.05, 0.02, 0.35));
  add(3, geo.box(0.06, 0.04, 0.04), dark, at(0, 0.13, 0.05, 0.35));
  // sword
  add(4, geo.box(0.022, 0.24, 0.008), 0xdfe6ee, at(0, 0.15, 0.04, 0.3));
  add(4, geo.box(0.07, 0.014, 0.02), 0xc8a23c, at(0, 0.03, 0.005, 0.3));
  add(4, geo.cyl(0.01, 0.01, 0.05, 4), 0x5a3a22, at(0, 0.0, -0.005, 0.3));
  // bow
  add(5, geo.torus(0.13, 0.008, 4, 10, Math.PI * 0.9), wood, T(hx, hy + 0.02, hz + 0.02, 0, Math.PI / 2, Math.PI * 0.55, s));
  add(5, geo.cyl(0.002, 0.002, 0.25, 3), 0xeeeeee, at(0, 0.02, 0.02));
  // hoe
  add(6, geo.cyl(0.011, 0.013, 0.26, 5), wood, at(0, 0.09, 0.02, 0.3));
  add(6, geo.box(0.06, 0.012, 0.05), iron, at(0, 0.215, 0.07, 0.3));
  // cleaver (orc)
  add(7, geo.box(0.07, 0.18, 0.012), 0x8d8f91, at(0, 0.14, 0.05, 0.3));
  add(7, geo.cyl(0.012, 0.012, 0.07, 4), 0x3a2a1a, at(0, 0.02, 0.01, 0.3));
  // warhammer (dwarf)
  add(8, geo.cyl(0.012, 0.014, 0.24, 5), wood, at(0, 0.08, 0.02, 0.3));
  add(8, geo.box(0.09, 0.06, 0.06), 0x70757c, at(0, 0.2, 0.06, 0.3));
  // basket
  add(9, geo.cyl(0.06, 0.045, 0.06, 8, 1, false), 0xc8a060, T(hx, hy - 0.02, hz + 0.02, 0, 0, 0, s));
  add(9, geo.sphere(0.02, 5, 4), 0xd8304a, T(hx + 0.01, hy + 0.015, hz + 0.02, 0, 0, 0, s));
  // spear
  add(10, geo.cyl(0.009, 0.009, 0.42, 4), wood, at(0, 0.15, 0.0));
  add(10, geo.cone(0.022, 0.07, 4), iron, at(0, 0.39, 0.0));
}

interface HumanoidOpts {
  height: number; width: number; headR: number; skinDefault: number;
  style: 'human' | 'elf' | 'dwarf' | 'orc' | 'skeleton';
}

function humanoid(o: HumanoidOpts): THREE.BufferGeometry {
  const b = new ModelBuilder(7, true);
  const H = o.height, Wd = o.width;
  const legH = H * 0.16, bodyH = H * 0.36, headY = legH + bodyH + o.headR * 0.78;
  const hipY = legH;
  const skel = o.style === 'skeleton';
  // legs (stubby) + feet
  for (const side of [-1, 1]) {
    const part = side < 0 ? P.LLeg : P.RLeg;
    const piv: [number, number, number] = [side * Wd * 0.22, hipY, 0];
    b.add(geo.capsule(Wd * 0.11, legH * 0.55, 3, 8), { color: W, slot: skel ? 0 : 4, part, pivot: piv }, T(side * Wd * 0.22, legH * 0.55, 0));
    b.add(geo.sphere(Wd * 0.14, 10, 6), { color: skel ? 0xd9d4c4 : 0x4a3a2c, part, pivot: piv }, T(side * Wd * 0.22, Wd * 0.07, Wd * 0.06, 0, 0, 0, 1, 0.65, 1.35));
  }
  // torso: soft barrel
  if (skel) {
    b.add(geo.capsule(Wd * 0.18, bodyH * 0.5, 3, 8), { color: 0xe6e1d2 }, T(0, hipY + bodyH * 0.5, 0, 0, 0, 0, 1, 1, 0.8));
    for (let i = 0; i < 3; i++) b.add(geo.torus(Wd * 0.2, 0.012, 4, 10), { color: 0xd5cfbd }, T(0, hipY + bodyH * (0.35 + i * 0.18), 0, Math.PI / 2, 0, 0, 1, 1, 0.75));
  } else {
    b.add(geo.lathe([[0, 0], [Wd * 0.34, 0.01], [Wd * 0.4, bodyH * 0.35], [Wd * 0.36, bodyH * 0.8], [Wd * 0.22, bodyH], [0, bodyH]], 14), { color: W, slot: 1, ao: [hipY, hipY + bodyH, 0.82] }, T(0, hipY, 0));
    // belt + collar trim
    b.add(geo.torus(Wd * 0.385, Wd * 0.04, 5, 14), { color: 0x5b3b24 }, T(0, hipY + bodyH * 0.3, 0, Math.PI / 2));
    b.add(geo.torus(Wd * 0.24, Wd * 0.04, 5, 12), { color: W, slot: 5 }, T(0, hipY + bodyH * 0.95, 0, Math.PI / 2));
  }
  // head
  const hy = headY;
  const hr = o.headR;
  const headPiv: [number, number, number] = [0, hy - hr * 0.6, 0];
  const skinSlot = skel ? 0 : 2;
  b.add(geo.sphere(hr, 18, 14), { color: skel ? 0xece7d8 : W, slot: skinSlot, part: P.Head, pivot: headPiv }, T(0, hy, 0, 0, 0, 0, 1, 0.94, 0.96));
  // eyes
  for (const side of [-1, 1]) {
    if (skel) b.add(geo.sphere(hr * 0.22, 8, 6), { color: 0x221b22, part: P.Head, pivot: headPiv }, T(side * hr * 0.36, hy + hr * 0.05, hr * 0.8, 0, 0, 0, 1, 1.15, 0.5));
    else {
      b.add(geo.sphere(hr * 0.13, 8, 6), { color: 0x1d1a24, part: P.Head, pivot: headPiv }, T(side * hr * 0.36, hy + hr * 0.02, hr * 0.9, 0, 0, 0, 0.9, 1.25, 0.6));
      b.add(geo.sphere(hr * 0.045, 5, 4), { color: 0xffffff, part: P.Head, pivot: headPiv }, T(side * hr * 0.33, hy + hr * 0.08, hr * 0.97));
      // rosy cheeks
      b.add(geo.sphere(hr * 0.12, 6, 4), { color: 0xf09a8c, part: P.Head, pivot: headPiv }, T(side * hr * 0.55, hy - hr * 0.2, hr * 0.78, 0, 0, 0, 1, 0.6, 0.4));
    }
  }
  if (!skel) b.add(geo.sphere(hr * 0.12, 8, 6), { color: W, slot: 2, part: P.Head, pivot: headPiv }, T(0, hy - hr * 0.08, hr * 0.98, 0, 0, 0, 1, 0.8, 0.8));
  // style details
  const hairSlot = { color: W, slot: 3, part: P.HeadAtt, pivot: headPiv } as const;
  switch (o.style) {
    case 'human':
      b.add(geo.sphere(hr * 1.04, 16, 10, ), hairSlot, T(0, hy + hr * 0.18, -hr * 0.12, -0.25, 0, 0, 1, 0.78, 1.0));
      b.add(geo.sphere(hr * 0.35, 8, 6), hairSlot, T(hr * 0.35, hy + hr * 0.72, hr * 0.45, 0.4, 0, -0.4, 1.1, 0.5, 0.9));
      break;
    case 'elf':
      b.add(geo.sphere(hr * 1.05, 16, 10), hairSlot, T(0, hy + hr * 0.12, -hr * 0.18, -0.2, 0, 0, 1, 0.82, 1.05));
      b.add(geo.capsule(hr * 0.5, hr * 1.2, 3, 8), hairSlot, T(0, hy - hr * 0.5, -hr * 0.62, 0.1));
      for (const side of [-1, 1]) b.add(geo.cone(hr * 0.16, hr * 0.85, 6), { color: W, slot: 2, part: P.HeadAtt, pivot: headPiv }, T(side * hr * 1.05, hy + hr * 0.25, -hr * 0.05, 0, 0, -side * 1.15));
      break;
    case 'dwarf':
      // big beard + helmet
      b.add(geo.sphere(hr * 0.78, 12, 10), hairSlot, T(0, hy - hr * 0.55, hr * 0.42, 0.3, 0, 0, 1.05, 1.1, 0.75));
      b.add(geo.cone(hr * 0.5, hr * 0.9, 8), hairSlot, T(0, hy - hr * 1.15, hr * 0.5, Math.PI - 0.35, 0, 0));
      b.add(geo.sphere(hr * 0.2, 8, 6), hairSlot, T(0, hy - hr * 0.12, hr * 0.92, 0, 0, 0, 1.6, 0.55, 0.6));
      b.add(geo.sphere(hr * 1.07, 16, 8, ), { color: 0x9aa1a8, part: P.HeadAtt, pivot: headPiv, flat: false }, T(0, hy + hr * 0.15, -hr * 0.02, 0, 0, 0, 1, 0.75, 1));
      b.add(geo.torus(hr * 1.02, hr * 0.08, 5, 16), { color: 0xc8a23c, part: P.HeadAtt, pivot: headPiv }, T(0, hy + hr * 0.15, 0, Math.PI / 2));
      for (const side of [-1, 1]) b.add(geo.cone(hr * 0.13, hr * 0.5, 6), { color: 0xf2ede0, part: P.HeadAtt, pivot: headPiv }, T(side * hr * 0.95, hy + hr * 0.65, 0, 0, 0, -side * 0.9));
      break;
    case 'orc':
      b.add(geo.sphere(hr * 0.45, 10, 8), { color: W, slot: 2, part: P.Head, pivot: headPiv }, T(0, hy - hr * 0.42, hr * 0.48, 0, 0, 0, 1.5, 0.85, 1));
      for (const side of [-1, 1]) {
        b.add(geo.cone(hr * 0.09, hr * 0.38, 5), { color: 0xf3ecd8, part: P.Head, pivot: headPiv }, T(side * hr * 0.32, hy - hr * 0.22, hr * 0.78, -0.2, 0, side * 0.15));
        b.add(geo.cone(hr * 0.15, hr * 0.5, 5), { color: W, slot: 2, part: P.HeadAtt, pivot: headPiv }, T(side * hr * 1.0, hy + hr * 0.15, -hr * 0.1, 0, 0, -side * 1.35));
      }
      b.add(geo.box(hr * 1.3, hr * 0.16, hr * 0.3), { color: W, slot: 2, part: P.Head, pivot: headPiv }, T(0, hy + hr * 0.28, hr * 0.72, 0.3));
      b.add(geo.capsule(hr * 0.22, hr * 0.5, 3, 6), hairSlot, T(0, hy + hr * 1.05, -hr * 0.1, -0.3));
      break;
    case 'skeleton':
      b.add(geo.box(hr * 0.9, hr * 0.25, hr * 0.5), { color: 0xe6e1d2, part: P.Head, pivot: headPiv }, T(0, hy - hr * 0.75, hr * 0.32));
      break;
  }
  // hands
  const shoulderY = hipY + bodyH * 0.82;
  for (const side of [-1, 1]) {
    const part = side < 0 ? P.LHand : P.RHand;
    const hx = side * Wd * 0.5, hyy = hipY + bodyH * 0.3;
    b.add(geo.sphere(Wd * 0.12, 10, 8), { color: skel ? 0xe6e1d2 : W, slot: skinSlot, part, pivot: [side * Wd * 0.38, shoulderY, 0] }, T(hx, hyy, 0.02));
    if (!skel) b.add(geo.capsule(Wd * 0.085, (shoulderY - hyy) * 0.6, 3, 8), { color: W, slot: 1, part, pivot: [side * Wd * 0.38, shoulderY, 0] }, T(side * Wd * 0.45, (shoulderY + hyy) / 2 + 0.01, 0, 0, 0, side * 0.12));
  }
  items(b, Wd * 0.5, hipY + bodyH * 0.3, 0.02, H / 0.62);
  return b.build();
}

function quadruped(sp: Sp): THREE.BufferGeometry {
  const b = new ModelBuilder(11, true);
  const legP = (x: number, z: number): [number, number, number] => [x, 0.16, z];
  const leg = (x: number, z: number, h: number, r: number, col: number, part: number) =>
    b.add(geo.capsule(r, h, 3, 6), { color: col, part, pivot: legP(x, z) }, T(x, h / 2 + r * 0.5, z));
  switch (sp) {
    case Sp.Sheep: {
      const wool = 0xf4f1ea;
      for (const [x, y, z, r] of [[0, 0.24, 0, 0.17], [0.09, 0.26, 0.08, 0.12], [-0.09, 0.26, 0.08, 0.12], [0.09, 0.25, -0.1, 0.12], [-0.09, 0.25, -0.1, 0.12], [0, 0.33, 0, 0.12], [0, 0.25, 0.14, 0.11], [0, 0.26, -0.16, 0.1]] as const)
        b.add(geo.ico(r, 1), { color: wool, jitter: 0.012 }, T(x, y, z));
      const hp: [number, number, number] = [0, 0.27, 0.16];
      b.add(geo.sphere(0.075, 10, 8), { color: 0x2d2a2c, part: P.Head, pivot: hp }, T(0, 0.3, 0.25, 0, 0, 0, 0.9, 1, 1.25));
      for (const s of [-1, 1]) {
        b.add(geo.sphere(0.02, 6, 4), { color: 0xffffff, part: P.Head, pivot: hp }, T(s * 0.035, 0.325, 0.32));
        b.add(geo.sphere(0.035, 6, 4), { color: 0x2d2a2c, part: P.Head, pivot: hp }, T(s * 0.08, 0.33, 0.22, 0, 0, s * 0.5, 1.6, 0.5, 0.8));
      }
      b.add(geo.ico(0.06, 1), { color: wool, part: P.Head, pivot: hp }, T(0, 0.38, 0.22));
      for (const [x, z, p] of [[0.07, 0.09, P.LLeg], [-0.07, 0.09, P.RLeg], [0.07, -0.1, P.RLeg], [-0.07, -0.1, P.LLeg]] as const) leg(x, z, 0.1, 0.025, 0x2d2a2c, p);
      break;
    }
    case Sp.Wolf: case Sp.Bear: case Sp.Deer: {
      const bear = sp === Sp.Bear, deer = sp === Sp.Deer;
      const fur = bear ? 0x7a5236 : deer ? 0xb27a46 : 0x8d939c;
      const belly = bear ? 0x9b7050 : deer ? 0xf0e2c8 : 0xd8dde2;
      const S = bear ? 1.25 : 1;
      const bodyY = (deer ? 0.3 : 0.24) * S;
      b.add(geo.capsule(0.11 * S, 0.22 * S, 4, 10), { color: fur }, T(0, bodyY, 0, Math.PI / 2, 0, 0, bear ? 1.15 : 1, 1, 1));
      b.add(geo.capsule(0.08 * S, 0.16 * S, 3, 8), { color: belly }, T(0, bodyY - 0.04 * S, 0.01, Math.PI / 2, 0, 0, 0.9, 0.7, 1));
      const hp: [number, number, number] = [0, bodyY + 0.04 * S, 0.17 * S];
      const hy = bodyY + (deer ? 0.13 : 0.06) * S, hz = 0.24 * S;
      b.add(geo.sphere(0.095 * S, 12, 10), { color: fur, part: P.Head, pivot: hp }, T(0, hy, hz));
      b.add(geo.capsule(0.045 * S, (deer ? 0.05 : 0.08) * S, 3, 8), { color: bear ? 0x9b7050 : fur, part: P.Head, pivot: hp }, T(0, hy - 0.02 * S, hz + 0.09 * S, Math.PI / 2));
      b.add(geo.sphere(0.022 * S, 6, 4), { color: 0x1f1b1d, part: P.Head, pivot: hp }, T(0, hy - 0.005 * S, hz + 0.16 * S));
      for (const s of [-1, 1]) {
        b.add(geo.sphere(0.018 * S, 6, 4), { color: 0x1d1a24, part: P.Head, pivot: hp }, T(s * 0.045 * S, hy + 0.03 * S, hz + 0.07 * S));
        if (bear) b.add(geo.sphere(0.035 * S, 8, 6), { color: fur, part: P.Head, pivot: hp }, T(s * 0.07 * S, hy + 0.08 * S, hz - 0.02 * S));
        else b.add(geo.cone(0.03 * S, 0.08 * S, 4), { color: fur, part: P.Head, pivot: hp }, T(s * 0.05 * S, hy + 0.1 * S, hz - 0.03 * S, 0, 0, -s * 0.25));
        if (deer) {
          // antlers
          b.add(geo.cyl(0.008, 0.012, 0.16, 4), { color: 0xe8dcc0, part: P.HeadAtt, pivot: hp }, T(s * 0.04, hy + 0.15, hz - 0.03, 0, 0, -s * 0.35));
          b.add(geo.cyl(0.006, 0.009, 0.08, 4), { color: 0xe8dcc0, part: P.HeadAtt, pivot: hp }, T(s * 0.08, hy + 0.2, hz + 0.01, 0.6, 0, -s * 0.2));
        }
      }
      const legH = (deer ? 0.2 : 0.12) * S, legR = (bear ? 0.045 : deer ? 0.022 : 0.03) * S;
      for (const [x, z, p] of [[0.07, 0.12, P.LLeg], [-0.07, 0.12, P.RLeg], [0.07, -0.12, P.RLeg], [-0.07, -0.12, P.LLeg]] as const)
        b.add(geo.capsule(legR, legH, 3, 6), { color: fur, part: p, pivot: [x * S, bodyY, z * S] }, T(x * S, legH / 2 + legR, z * S));
      // tail
      const tp: [number, number, number] = [0, bodyY + 0.03, -0.2 * S];
      if (sp === Sp.Wolf) b.add(geo.capsule(0.035, 0.14, 3, 6), { color: fur, part: P.Tail, pivot: tp }, T(0, bodyY + 0.0, -0.27, -0.9));
      else b.add(geo.sphere(deer ? 0.035 : 0.04, 6, 4), { color: deer ? 0xffffff : fur, part: P.Tail, pivot: tp }, T(0, bodyY + 0.04 * S, -0.22 * S));
      break;
    }
    case Sp.Chicken: {
      b.add(geo.sphere(0.1, 12, 10), { color: 0xf8f4ec }, T(0, 0.14, 0, 0, 0, 0, 0.9, 0.95, 1.15));
      b.add(geo.cone(0.06, 0.1, 6), { color: 0xf0ebe0, part: P.Tail, pivot: [0, 0.16, -0.1] }, T(0, 0.2, -0.12, -0.7));
      const hp: [number, number, number] = [0, 0.18, 0.06];
      b.add(geo.sphere(0.06, 10, 8), { color: 0xf8f4ec, part: P.Head, pivot: hp }, T(0, 0.26, 0.08));
      b.add(geo.cone(0.018, 0.045, 4), { color: 0xf2b330, part: P.Head, pivot: hp }, T(0, 0.255, 0.15, Math.PI / 2));
      b.add(geo.box(0.012, 0.04, 0.05), { color: 0xe23a3a, part: P.Head, pivot: hp }, T(0, 0.32, 0.08));
      b.add(geo.sphere(0.015, 6, 4), { color: 0xe23a3a, part: P.Head, pivot: hp }, T(0, 0.22, 0.14));
      for (const s of [-1, 1]) b.add(geo.sphere(0.01, 5, 4), { color: 0x1d1a24, part: P.Head, pivot: hp }, T(s * 0.035, 0.275, 0.12));
      for (const [x, p] of [[0.035, P.LLeg], [-0.035, P.RLeg]] as const) {
        b.add(geo.cyl(0.007, 0.007, 0.07, 4), { color: 0xf2b330, part: p, pivot: [x, 0.08, 0] }, T(x, 0.04, 0));
        b.add(geo.box(0.035, 0.008, 0.04), { color: 0xf2b330, part: p, pivot: [x, 0.08, 0] }, T(x, 0.004, 0.012));
      }
      for (const s of [-1, 1]) b.add(geo.sphere(0.05, 8, 6), { color: 0xe9e3d6, part: s < 0 ? P.LHand : P.RHand, pivot: [s * 0.08, 0.18, 0] }, T(s * 0.085, 0.15, -0.01, 0, 0, 0, 0.4, 0.8, 1.2));
      break;
    }
  }
  return b.build();
}

export function buildCreatureModels(): Record<number, THREE.BufferGeometry> {
  return {
    [Sp.Human]: humanoid({ height: 0.62, width: 0.2, headR: 0.125, skinDefault: 0xf2c8a0, style: 'human' }),
    [Sp.Elf]: humanoid({ height: 0.68, width: 0.18, headR: 0.12, skinDefault: 0xf6dcc4, style: 'elf' }),
    [Sp.Dwarf]: humanoid({ height: 0.5, width: 0.25, headR: 0.125, skinDefault: 0xe8b590, style: 'dwarf' }),
    [Sp.Orc]: humanoid({ height: 0.66, width: 0.25, headR: 0.13, skinDefault: 0x7fae5a, style: 'orc' }),
    [Sp.Skeleton]: humanoid({ height: 0.62, width: 0.18, headR: 0.12, skinDefault: 0xeeeeee, style: 'skeleton' }),
    [Sp.Sheep]: quadruped(Sp.Sheep),
    [Sp.Wolf]: quadruped(Sp.Wolf),
    [Sp.Deer]: quadruped(Sp.Deer),
    [Sp.Bear]: quadruped(Sp.Bear),
    [Sp.Chicken]: quadruped(Sp.Chicken),
  };
}

export const SKIN_TONES: Record<number, number[]> = {
  [Sp.Human]: [0xf7d3b5, 0xeebd94, 0xd59c6f, 0xa86f48, 0x7c4f33],
  [Sp.Elf]: [0xfbe6d4, 0xf3d9c2, 0xe9cfb7],
  [Sp.Dwarf]: [0xf0c3a0, 0xe0a882, 0xc78e68],
  [Sp.Orc]: [0x7fae5a, 0x6d9b4e, 0x8fb565, 0x5f8a49],
};
export const HAIR_TONES: Record<number, number[]> = {
  [Sp.Human]: [0x3a2618, 0x5b3920, 0x8a5a2e, 0xd9b05a, 0x1f1a1a, 0xb54a22],
  [Sp.Elf]: [0xf2e2a8, 0xe8e8f0, 0xc9e0a0, 0xd9a85a],
  [Sp.Dwarf]: [0xb54a22, 0x8a5a2e, 0x5b3920, 0xd9b05a, 0x9a9a9a],
  [Sp.Orc]: [0x1f1a1a, 0x3a2618, 0x4a3a2a],
};
void hex;
