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
  // musket: long barrel, wooden stock
  add(12, geo.box(0.03, 0.12, 0.035), wood, at(0, 0.02, 0.0, 1.25));
  add(12, geo.cyl(0.009, 0.009, 0.34, 6), 0x5a5e64, at(0, 0.09, 0.17, 1.25 + Math.PI / 2 - Math.PI / 2));
  // rifle: dark, with scope and magazine
  add(13, geo.box(0.03, 0.1, 0.035), 0x3a3a3e, at(0, 0.02, 0.0, 1.25));
  add(13, geo.cyl(0.01, 0.01, 0.3, 6), 0x2a2c30, at(0, 0.09, 0.16, 1.25));
  add(13, geo.cyl(0.014, 0.014, 0.08, 6), 0x1a1c20, at(0, 0.12, 0.08, 1.25));
  add(13, geo.box(0.02, 0.05, 0.025), 0x2a2c30, at(0, 0.03, 0.08, 1.25));
  // satchel (trader)
  add(14, geo.rbox(0.09, 0.08, 0.05, 0.015, 1), 0x8a5a33, T(hx + 0.01, hy - 0.03, hz + 0.02, 0, 0, 0, s));
  add(14, geo.box(0.092, 0.025, 0.052), 0xc8a23c, T(hx + 0.01, hy + 0.0, hz + 0.02, 0, 0, 0, s));
  // baton (guard)
  add(15, geo.cyl(0.012, 0.012, 0.2, 6), 0x22252a, at(0, 0.08, 0.02, 0.35));
  add(15, geo.cyl(0.016, 0.016, 0.03, 6), 0x6a6e74, at(0, -0.01, -0.01, 0.35));
  // fishing rod with line and float
  add(16, geo.cyl(0.006, 0.01, 0.5, 4), 0x9a6a3a, at(0, 0.2, 0.08, 0.6));
  add(16, geo.cyl(0.002, 0.002, 0.22, 3), 0xeeeeee, at(0, 0.32, 0.36));
  add(16, geo.sphere(0.018, 6, 4), 0xe23a3a, at(0, 0.21, 0.36));
  // staff (mages): gnarled shaft, glowing orb in a claw
  add(18, geo.cyl(0.011, 0.014, 0.5, 5), 0x6a4426, at(0, 0.16, 0.03, 0.12));
  add(18, geo.sphere(0.04, 10, 8), 0xffb84a, at(0, 0.43, 0.06));
  add(18, geo.sphere(0.022, 8, 6), 0xfff4c8, at(0.01, 0.44, 0.08));
  for (const a of [0, 2.1, 4.2]) add(18, geo.cone(0.008, 0.06, 4), 0x4a2e18, at(Math.cos(a) * 0.035, 0.42, 0.06 + Math.sin(a) * 0.035, 0, 0, Math.cos(a) * 0.5));
  // ray gun (aliens): bulbous emitter rings
  add(19, geo.rbox(0.035, 0.07, 0.05, 0.012, 1), 0x9aa4b0, at(0, 0.02, 0.0, 1.25));
  add(19, geo.cyl(0.016, 0.022, 0.12, 8), 0xc8d0da, at(0, 0.08, 0.07, 1.25));
  for (const k of [0, 1]) add(19, geo.torus(0.026, 0.007, 4, 10), 0x4af0a0, at(0, 0.075 + k * 0.025, 0.06 + k * 0.03, 1.25 + Math.PI / 2));
  add(19, geo.sphere(0.014, 6, 4), 0x9affd0, at(0, 0.12, 0.13));
  // book (scholar)
  add(17, geo.box(0.09, 0.11, 0.025), 0x3a5aa8, T(hx + 0.02, hy + 0.02, hz + 0.05, -0.4, 0, 0, s));
  add(17, geo.box(0.08, 0.1, 0.027), 0xf3ecd8, T(hx + 0.022, hy + 0.02, hz + 0.05, -0.4, 0, 0, s));
}

// ------------------------------------------------------------------ machines
const STEEL = 0x6f757c, DARK = 0x33363b, PLANK = 0xa8743f, PLANK_D = 0x7a5235;

/** Boats share one hull; variant gear is drawn as items 20 (fishing), 21 (warship), 22 (ferry). */
function boat(): THREE.BufferGeometry {
  const b = new ModelBuilder(41, true);
  const it = (id: number) => ({ part: P.Item, item: id, pivot: [0, 0, 0] as [number, number, number] });
  // hull: tapered planked shell with a keel line in kingdom colour
  b.add(geo.lathe([[0, -0.08], [0.17, -0.05], [0.2, 0.06], [0.2, 0.12]], 12), { color: PLANK }, T(0, 0, 0, 0, 0, 0, 1, 1, 2.5));
  b.add(geo.box(0.36, 0.03, 0.9), { color: PLANK_D }, T(0, 0.09, 0));
  b.add(geo.torus(0.2, 0.018, 4, 16), { color: W, slot: 1 }, T(0, 0.115, 0, Math.PI / 2, 0, 0, 1, 2.5, 1));
  b.add(geo.cone(0.03, 0.12, 5), { color: PLANK_D }, T(0, 0.08, 0.52, Math.PI / 2));
  // fishing: mast, sail, net heap, lantern
  b.add(geo.cyl(0.012, 0.014, 0.6, 5), { color: PLANK_D, ...it(20) }, T(0, 0.38, 0.06));
  b.add(geo.box(0.005, 0.38, 0.26), { color: 0xf3ead8, ...it(20) }, T(0, 0.42, -0.07));
  b.add(geo.box(0.006, 0.08, 0.27), { color: W, slot: 1, ...it(20) }, T(0, 0.62, -0.07));
  b.add(geo.sphere(0.07, 8, 6), { color: 0x9a8a6a, ...it(20) }, T(0.05, 0.13, -0.28, 0, 0, 0, 1.3, 0.5, 1));
  b.add(geo.sphere(0.025, 6, 4), { color: 0xffd27a, ...it(20) }, T(0, 0.68, 0.06));
  // warship: deckhouse, funnel, gun turrets, flag
  b.add(geo.rbox(0.26, 0.14, 0.32, 0.02, 1), { color: 0xd8d4cc, ...it(21) }, T(0, 0.17, -0.12));
  b.add(geo.cyl(0.045, 0.05, 0.22, 8), { color: DARK, ...it(21) }, T(0, 0.33, -0.16));
  b.add(geo.cyl(0.05, 0.05, 0.03, 8), { color: W, slot: 1, ...it(21) }, T(0, 0.41, -0.16));
  for (const z of [0.22, -0.38]) {
    b.add(geo.cyl(0.06, 0.07, 0.06, 10), { color: STEEL, ...it(21) }, T(0, 0.14, z));
    b.add(geo.cyl(0.012, 0.012, 0.2, 6), { color: DARK, ...it(21) }, T(0, 0.15, z + (z > 0 ? 0.12 : -0.12), Math.PI / 2));
  }
  b.add(geo.cyl(0.008, 0.008, 0.3, 4), { color: DARK, ...it(21) }, T(0, 0.38, 0.0));
  b.add(geo.box(0.005, 0.07, 0.11), { color: W, slot: 1, ...it(21) }, T(0, 0.48, -0.06));
  // ferry: canopy over benches, a big steering oar
  b.add(geo.box(0.34, 0.015, 0.5), { color: W, slot: 5, ...it(22) }, T(0, 0.34, -0.05));
  for (const x of [-0.15, 0.15]) for (const z of [-0.28, 0.18]) b.add(geo.cyl(0.01, 0.01, 0.24, 4), { color: PLANK_D, ...it(22) }, T(x, 0.22, z));
  b.add(geo.box(0.04, 0.03, 0.3), { color: PLANK_D, ...it(22) }, T(0.12, 0.1, -0.55, 0.35));
  return b.build();
}

function tank(): THREE.BufferGeometry {
  const b = new ModelBuilder(43, true);
  for (const side of [-1, 1]) {
    b.add(geo.capsule(0.07, 0.4, 3, 8), { color: 0x2c2e30 }, T(side * 0.17, 0.08, 0, Math.PI / 2));
    for (let i = 0; i < 5; i++) b.add(geo.cyl(0.045, 0.045, 0.02, 10), { color: 0x55595e }, T(side * 0.2, 0.07, -0.2 + i * 0.1, 0, 0, Math.PI / 2));
  }
  b.add(geo.rbox(0.3, 0.1, 0.56, 0.02, 1), { color: 0x6d7a52 }, T(0, 0.17, 0));
  b.add(geo.rbox(0.38, 0.03, 0.6, 0.01, 1), { color: 0x5a6644 }, T(0, 0.135, 0));
  b.add(geo.cyl(0.13, 0.15, 0.1, 12), { color: W, slot: 1, ao: [0.2, 0.3, 0.8] }, T(0, 0.27, -0.03));
  b.add(geo.sphere(0.12, 12, 6), { color: 0x6d7a52 }, T(0, 0.31, -0.03, 0, 0, 0, 1, 0.45, 1));
  b.add(geo.cyl(0.022, 0.026, 0.4, 8), { color: 0x4a5238 }, T(0, 0.28, 0.3, Math.PI / 2));
  b.add(geo.cyl(0.03, 0.03, 0.05, 8), { color: 0x2c2e30 }, T(0, 0.28, 0.5, Math.PI / 2));
  b.add(geo.cyl(0.035, 0.035, 0.04, 8), { color: 0x4a5238 }, T(0.06, 0.36, -0.08));
  b.add(geo.cyl(0.005, 0.005, 0.25, 4), { color: DARK }, T(-0.08, 0.45, -0.12));
  return b.build();
}

function plane(): THREE.BufferGeometry {
  const b = new ModelBuilder(47, true);
  b.add(geo.capsule(0.07, 0.5, 4, 10), { color: 0xe8e4da }, T(0, 0, 0, Math.PI / 2));
  b.add(geo.sphere(0.06, 10, 8), { color: 0x7ab8e0 }, T(0, 0.05, 0.12, 0, 0, 0, 0.8, 0.6, 1.4));
  b.add(geo.rbox(0.9, 0.02, 0.15, 0.01, 1), { color: W, slot: 1 }, T(0, -0.01, 0.04));
  b.add(geo.rbox(0.32, 0.015, 0.08, 0.008, 1), { color: W, slot: 1 }, T(0, 0.0, -0.3));
  b.add(geo.box(0.015, 0.14, 0.1), { color: W, slot: 1 }, T(0, 0.07, -0.3));
  for (const x of [-0.25, 0.25]) b.add(geo.capsule(0.025, 0.06, 3, 6), { color: DARK }, T(x, -0.05, 0.06, Math.PI / 2));
  b.add(geo.cone(0.035, 0.06, 8), { color: 0xd8b84a }, T(0, 0, 0.33, Math.PI / 2));
  // propeller spins (part 7)
  b.add(geo.box(0.32, 0.03, 0.01), { color: DARK, part: P.Tail, pivot: [0, 0, 0.36] }, T(0, 0, 0.36));
  return b.build();
}

interface HumanoidOpts {
  height: number; width: number; headR: number; skinDefault: number;
  style: 'human' | 'elf' | 'dwarf' | 'orc' | 'skeleton' | 'troll' | 'zombie' | 'mage' | 'alien' | 'demon' | 'coldone';
}

function humanoid(o: HumanoidOpts): THREE.BufferGeometry {
  const b = new ModelBuilder(7, true);
  const H = o.height, Wd = o.width;
  const legH = H * 0.16, bodyH = H * 0.36, headY = legH + bodyH + o.headR * 0.78;
  const hipY = legH;
  const skel = o.style === 'skeleton';
  const troll = o.style === 'troll';
  const st = o.style;
  const bare = st === 'demon' || st === 'coldone'; // no tailoring: skin all over
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
    b.add(geo.lathe(troll ? [[0, 0], [Wd * 0.4, 0.01], [Wd * 0.5, bodyH * 0.4], [Wd * 0.46, bodyH * 0.85], [Wd * 0.3, bodyH], [0, bodyH]] : st === 'coldone' ? [[0, 0], [Wd * 0.38, 0.01], [Wd * 0.48, bodyH * 0.45], [Wd * 0.46, bodyH * 0.85], [Wd * 0.3, bodyH], [0, bodyH]] : [[0, 0], [Wd * 0.34, 0.01], [Wd * 0.4, bodyH * 0.35], [Wd * 0.36, bodyH * 0.8], [Wd * 0.22, bodyH], [0, bodyH]], 14), { color: troll ? 0x7f9a98 : W, slot: troll ? 0 : bare ? 2 : 1, ao: [hipY, hipY + bodyH, 0.82] }, T(0, hipY, 0));
    if (st === 'mage') {
      // a long robe down to the ankles, with a trimmed hem and a rope belt
      b.add(geo.lathe([[0, 0], [Wd * 0.46, 0], [Wd * 0.4, legH * 0.9], [Wd * 0.36, legH + bodyH * 0.3], [0, legH + bodyH * 0.3]], 14), { color: W, slot: 1, ao: [0, hipY, 0.85] }, T(0, 0.004, 0));
      b.add(geo.torus(Wd * 0.45, Wd * 0.03, 4, 14), { color: W, slot: 5 }, T(0, 0.02, 0, Math.PI / 2));
    }
    if (st === 'zombie') {
      // torn, faded rags: dark patches and a ripped hem
      for (const [x, y, z] of [[0.6, 0.45, 0.85], [-0.5, 0.7, 0.8], [0.2, 0.2, -0.9]] as [number, number, number][]) b.add(geo.sphere(Wd * 0.12, 6, 4), { color: 0x4a3e30 }, T(x * Wd * 0.4, hipY + bodyH * y, z * Wd * 0.38, 0, 0, 0, 1, 1, 0.35));
      for (let i = 0; i < 5; i++) b.add(geo.cone(Wd * 0.06, Wd * 0.14, 3), { color: W, slot: 1 }, T(Math.cos(i * 1.3) * Wd * 0.36, hipY - Wd * 0.02, Math.sin(i * 1.3) * Wd * 0.36, Math.PI));
    }
    if (st === 'demon') {
      // loincloth, chest plates of brimstone
      b.add(geo.cyl(Wd * 0.42, Wd * 0.46, bodyH * 0.22, 12), { color: 0x2a1a1a }, T(0, hipY + bodyH * 0.1, 0));
      for (const sx of [-1, 1]) b.add(geo.sphere(Wd * 0.14, 8, 6), { color: 0x7a1a14 }, T(sx * Wd * 0.17, hipY + bodyH * 0.72, Wd * 0.3, 0, 0, 0, 1, 0.7, 0.5));
    }
    if (st === 'coldone') {
      // ice crystals jutting from the shoulders and back
      for (const [x, y, z, rz] of [[0.42, 0.95, -0.05, -0.6], [-0.42, 0.95, -0.05, 0.6], [0.15, 0.8, -0.4, -0.2], [-0.2, 0.6, -0.42, 0.3], [0, 1.05, -0.3, 0]] as number[][])
        b.add(geo.cone(Wd * 0.09, Wd * 0.42, 5), { color: 0xd8f6ff, flat: true }, T(x * Wd, hipY + bodyH * y, z * Wd, -0.5, 0, rz));
    }
    if (troll) b.add(geo.cyl(Wd * 0.42, Wd * 0.48, bodyH * 0.35, 12), { color: 0x6b4a2e }, T(0, hipY + bodyH * 0.18, 0));
    // belt + collar trim
    if (!bare) {
      b.add(geo.torus(Wd * 0.385, Wd * 0.04, 5, 14), { color: st === 'mage' ? 0xd9b84a : 0x5b3b24 }, T(0, hipY + bodyH * 0.3, 0, Math.PI / 2));
      b.add(geo.torus(Wd * 0.24, Wd * 0.04, 5, 12), { color: W, slot: 5 }, T(0, hipY + bodyH * 0.95, 0, Math.PI / 2));
    }
    if (!troll && !bare && st !== 'alien') {
      // buckle, buttons, a pouch on the belt and a hem stripe: clothes with some tailoring
      b.add(geo.rbox(Wd * 0.14, Wd * 0.1, Wd * 0.05, Wd * 0.015, 1), { color: 0xd9b84a }, T(0, hipY + bodyH * 0.3, Wd * 0.39));
      for (const k of [0.55, 0.74]) b.add(geo.sphere(Wd * 0.035, 6, 4), { color: W, slot: 5 }, T(0, hipY + bodyH * k, Wd * 0.385 - (k - 0.55) * Wd * 0.1));
      b.add(geo.rbox(Wd * 0.16, Wd * 0.18, Wd * 0.1, Wd * 0.03, 1), { color: 0x7a5235 }, T(Wd * 0.3, hipY + bodyH * 0.2, Wd * 0.24, 0, 0.6, 0));
      b.add(geo.torus(Wd * 0.36, Wd * 0.025, 4, 14), { color: W, slot: 5 }, T(0, hipY + bodyH * 0.05, 0, Math.PI / 2));
    }
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
    else if (st === 'alien') {
      // huge, glossy almond eyes
      b.add(geo.sphere(hr * 0.3, 10, 8), { color: 0x0c0a14, part: P.Head, pivot: headPiv }, T(side * hr * 0.4, hy + hr * 0.02, hr * 0.78, 0, 0, side * 0.5, 1.5, 0.85, 0.5));
      b.add(geo.sphere(hr * 0.06, 5, 4), { color: 0xffffff, part: P.Head, pivot: headPiv }, T(side * hr * 0.33, hy + hr * 0.12, hr * 0.94));
    } else if (st === 'zombie' || st === 'demon' || st === 'coldone') {
      // glowing eyes: sickly green, ember yellow, frost cyan
      const glow = st === 'zombie' ? 0xc8ff5a : st === 'demon' ? 0xffd23a : 0x8af0ff;
      b.add(geo.sphere(hr * 0.15, 8, 6), { color: glow, part: P.Head, pivot: headPiv }, T(side * hr * 0.36, hy + hr * 0.04, hr * 0.88, 0, 0, side * 0.3, 1.2, 0.8, 0.55));
    } else {
      b.add(geo.sphere(hr * 0.13, 8, 6), { color: 0x1d1a24, part: P.Head, pivot: headPiv }, T(side * hr * 0.36, hy + hr * 0.02, hr * 0.9, 0, 0, 0, 0.9, 1.25, 0.6));
      b.add(geo.sphere(hr * 0.045, 5, 4), { color: 0xffffff, part: P.Head, pivot: headPiv }, T(side * hr * 0.33, hy + hr * 0.08, hr * 0.97));
      // rosy cheeks
      b.add(geo.sphere(hr * 0.12, 6, 4), { color: 0xf09a8c, part: P.Head, pivot: headPiv }, T(side * hr * 0.55, hy - hr * 0.2, hr * 0.78, 0, 0, 0, 1, 0.6, 0.4));
    }
  }
  if (!skel && st !== 'alien') b.add(geo.sphere(hr * 0.12, 8, 6), { color: W, slot: 2, part: P.Head, pivot: headPiv }, T(0, hy - hr * 0.08, hr * 0.98, 0, 0, 0, 1, 0.8, 0.8));
  if (!skel && !troll && (st === 'human' || st === 'elf' || st === 'dwarf' || st === 'orc' || st === 'mage')) {
    // brows (hair-coloured) and a small smile give every face an expression
    for (const side of [-1, 1]) b.add(geo.capsule(hr * 0.04, hr * 0.2, 2, 5), { color: W, slot: 3, part: P.Head, pivot: headPiv }, T(side * hr * 0.37, hy + hr * 0.3, hr * 0.86, -0.2, 0, Math.PI / 2 + side * 0.18));
    b.add(geo.torus(hr * 0.13, hr * 0.028, 4, 10, Math.PI), { color: 0x5a2a2a, part: P.Head, pivot: headPiv }, T(0, hy - hr * 0.26, hr * 0.92, -0.25, 0, Math.PI));
  }
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
    case 'zombie':
      // matted hair, a gaping mouth, stitches across the brow
      b.add(geo.sphere(hr * 1.02, 12, 8), hairSlot, T(0.02, hy + hr * 0.25, -hr * 0.15, -0.3, 0, 0.15, 1, 0.65, 0.95));
      b.add(geo.sphere(hr * 0.2, 8, 6), { color: 0x2a1a1a, part: P.Head, pivot: headPiv }, T(0, hy - hr * 0.42, hr * 0.85, 0, 0, 0, 1.2, 0.9, 0.5));
      b.add(geo.box(hr * 0.7, hr * 0.05, hr * 0.06), { color: 0x3a2a2a, part: P.Head, pivot: headPiv }, T(0, hy + hr * 0.5, hr * 0.84, -0.3, 0, 0.2));
      break;
    case 'mage':
      // tall pointed hat with a crooked tip and a wide brim; a long beard
      b.add(geo.cyl(hr * 1.45, hr * 1.45, hr * 0.1, 18), { color: W, slot: 4, part: P.HeadAtt, pivot: headPiv }, T(0, hy + hr * 0.62, 0));
      b.add(geo.cone(hr * 0.85, hr * 2.0, 14), { color: W, slot: 4, part: P.HeadAtt, pivot: headPiv }, T(0.0, hy + hr * 1.6, -hr * 0.05, -0.15, 0, 0.12));
      b.add(geo.torus(hr * 0.86, hr * 0.08, 4, 16), { color: 0xd9b84a, part: P.HeadAtt, pivot: headPiv }, T(0, hy + hr * 0.72, 0, Math.PI / 2));
      b.add(geo.sphere(hr * 0.75, 12, 10), hairSlot, T(0, hy - hr * 0.6, hr * 0.45, 0.35, 0, 0, 0.95, 1.25, 0.7));
      b.add(geo.cone(hr * 0.45, hr * 0.9, 8), hairSlot, T(0, hy - hr * 1.3, hr * 0.55, Math.PI - 0.3, 0, 0));
      break;
    case 'alien':
      // a tall egg-shaped cranium, slit mouth, two little antennae
      b.add(geo.sphere(hr * 1.05, 16, 12), { color: W, slot: 2, part: P.Head, pivot: headPiv }, T(0, hy + hr * 0.45, -hr * 0.1, -0.2, 0, 0, 0.95, 1.2, 1.0));
      b.add(geo.box(hr * 0.3, hr * 0.03, hr * 0.05), { color: 0x2a3a2a, part: P.Head, pivot: headPiv }, T(0, hy - hr * 0.42, hr * 0.86));
      for (const side of [-1, 1]) {
        b.add(geo.cyl(hr * 0.03, hr * 0.03, hr * 0.7, 4), { color: W, slot: 2, part: P.HeadAtt, pivot: headPiv }, T(side * hr * 0.35, hy + hr * 1.55, -hr * 0.1, 0, 0, -side * 0.35));
        b.add(geo.sphere(hr * 0.1, 6, 4), { color: 0x7affb0, part: P.HeadAtt, pivot: headPiv }, T(side * hr * 0.48, hy + hr * 1.88, -hr * 0.1));
      }
      break;
    case 'demon':
      // curling horns, pointed ears, a sharp grin
      for (const side of [-1, 1]) {
        b.add(geo.cone(hr * 0.2, hr * 0.85, 7), { color: 0x2a1a14, part: P.HeadAtt, pivot: headPiv }, T(side * hr * 0.55, hy + hr * 0.95, -hr * 0.05, -0.3, 0, -side * 0.55));
        b.add(geo.cone(hr * 0.12, hr * 0.45, 5), { color: 0xf0e0c0, part: P.HeadAtt, pivot: headPiv }, T(side * hr * 0.82, hy + hr * 1.35, -hr * 0.25, -0.9, 0, -side * 0.2));
        b.add(geo.cone(hr * 0.13, hr * 0.5, 5), { color: W, slot: 2, part: P.HeadAtt, pivot: headPiv }, T(side * hr * 1.0, hy + hr * 0.2, -hr * 0.1, 0, 0, -side * 1.3));
      }
      b.add(geo.torus(hr * 0.22, hr * 0.03, 4, 10, Math.PI), { color: 0xfff0d0, part: P.Head, pivot: headPiv }, T(0, hy - hr * 0.3, hr * 0.9, -0.2, 0, Math.PI));
      break;
    case 'coldone':
      // a crown of ice shards and a frosted beard
      for (let i = 0; i < 5; i++) b.add(geo.cone(hr * 0.16, hr * (0.7 + (i % 2) * 0.4), 5), { color: 0xe8fbff, part: P.HeadAtt, pivot: headPiv, flat: true }, T(Math.cos(i * 0.75 - 1.5) * hr * 0.6, hy + hr * 0.95, Math.sin(i * 0.75 - 1.5) * hr * 0.4 - hr * 0.1, -0.2, 0, -Math.cos(i * 0.75 - 1.5) * 0.4));
      b.add(geo.ico(hr * 0.55, 0), { color: 0xc8eeff, part: P.Head, pivot: headPiv, flat: true }, T(0, hy - hr * 0.62, hr * 0.42, 0.3, 0, 0, 1, 1.2, 0.7));
      break;
    case 'troll':
      // heavy brow, underbite with tusks, warty nose, tuft of moss hair
      b.add(geo.box(hr * 1.5, hr * 0.28, hr * 0.5), { color: 0x6f8a8a, part: P.Head, pivot: headPiv }, T(0, hy + hr * 0.3, hr * 0.62, 0.35));
      b.add(geo.sphere(hr * 0.55, 10, 8), { color: 0x7f9a98, part: P.Head, pivot: headPiv }, T(0, hy - hr * 0.5, hr * 0.42, 0, 0, 0, 1.6, 0.9, 1));
      for (const side of [-1, 1]) b.add(geo.cone(hr * 0.12, hr * 0.5, 5), { color: 0xf3ecd8, part: P.Head, pivot: headPiv }, T(side * hr * 0.42, hy - hr * 0.15, hr * 0.8, -0.15, 0, side * 0.2));
      b.add(geo.sphere(hr * 0.24, 8, 6), { color: 0x8aa6a2, part: P.Head, pivot: headPiv }, T(0, hy - hr * 0.02, hr * 1.02, 0, 0, 0, 1, 1.2, 1));
      b.add(geo.ico(hr * 0.45, 1), { color: 0x4f7a3a, part: P.HeadAtt, pivot: headPiv, jitter: 0.03 }, T(0, hy + hr * 0.85, -hr * 0.1, 0, 0, 0, 1.3, 0.6, 1.1));
      break;
  }
  // hands
  const shoulderY = hipY + bodyH * 0.82;
  const reach = st === 'zombie'; // the hungry dead walk with arms outstretched
  for (const side of [-1, 1]) {
    const part = side < 0 ? P.LHand : P.RHand;
    const hx = side * Wd * (reach ? 0.38 : 0.5), hyy = reach ? shoulderY - 0.01 : hipY + bodyH * 0.3;
    const fwd = reach ? Wd * 0.75 : 0.02;
    b.add(geo.sphere(Wd * 0.12, 10, 8), { color: skel ? 0xe6e1d2 : W, slot: skinSlot, part, pivot: [side * Wd * 0.38, shoulderY, 0] }, T(hx, hyy, fwd));
    if (reach) b.add(geo.capsule(Wd * 0.085, Wd * 0.5, 3, 8), { color: W, slot: 1, part, pivot: [side * Wd * 0.38, shoulderY, 0] }, T(side * Wd * 0.38, shoulderY, fwd * 0.5, Math.PI / 2, 0, 0));
    else if (!skel) b.add(geo.capsule(Wd * 0.085, (shoulderY - hyy) * 0.6, 3, 8), { color: W, slot: bare ? 2 : 1, part, pivot: [side * Wd * 0.38, shoulderY, 0] }, T(side * Wd * 0.45, (shoulderY + hyy) / 2 + 0.01, 0, 0, 0, side * 0.12));
    if (!skel && !troll && !bare && !reach) b.add(geo.torus(Wd * 0.085, Wd * 0.025, 4, 10), { color: W, slot: 5, part, pivot: [side * Wd * 0.38, shoulderY, 0] }, T(side * Wd * 0.48, hyy + Wd * 0.13, 0.01, Math.PI / 2, 0, side * 0.12));
  }
  if (st === 'demon') {
    // a whip of a tail and small leathery wings
    const tp: [number, number, number] = [0, hipY + bodyH * 0.15, -Wd * 0.35];
    b.add(geo.capsule(Wd * 0.05, Wd * 1.1, 3, 6), { color: W, slot: 2, part: P.Tail, pivot: tp }, T(0, hipY + bodyH * 0.05, -Wd * 0.8, Math.PI / 2 + 0.5));
    b.add(geo.cone(Wd * 0.12, Wd * 0.25, 3), { color: 0x2a1a14, part: P.Tail, pivot: tp, flat: true }, T(0, hipY - bodyH * 0.12, -Wd * 1.35, -Math.PI / 2));
    for (const side of [-1, 1]) b.add(geo.extrude([[0, 0], [0.55, 0.35], [0.9, 0.1], [0.7, -0.05], [0.5, -0.2], [0.3, -0.12], [0, -0.05]], 0.012), { color: 0x5a1612, part: P.HeadAtt, pivot: [0, hipY + bodyH * 0.8, -Wd * 0.3] }, T(side * Wd * 0.2, hipY + bodyH * 0.8, -Wd * 0.32, 0, side > 0 ? -0.5 : Math.PI + 0.5, 0.3, Wd * 1.1, Wd * 1.1, 1));
  }
  items(b, Wd * 0.5, hipY + bodyH * 0.3, 0.02, H / 0.62);
  return b.build();
}

/** Flying saucer: steel disc, glass dome, a spinning ring of lights (part 7), glowing belly. */
function ufo(): THREE.BufferGeometry {
  const b = new ModelBuilder(23, true);
  b.add(geo.lathe([[0, -0.08], [0.22, -0.07], [0.44, -0.02], [0.5, 0.0], [0.44, 0.04], [0.22, 0.08], [0, 0.09]], 28), { color: 0xb8c2cc }, T(0, 0.35, 0));
  b.add(geo.torus(0.47, 0.03, 6, 32), { color: 0x6f7a86 }, T(0, 0.35, 0, Math.PI / 2));
  b.add(new THREE.SphereGeometry(0.2, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), { color: 0x9fe8ff }, T(0, 0.42, 0));
  b.add(geo.sphere(0.07, 10, 8), { color: 0x6ad87a }, T(0, 0.47, 0.02, 0, 0, 0, 1, 1.2, 1));
  b.add(geo.cyl(0.16, 0.12, 0.05, 20), { color: 0x9affd0 }, T(0, 0.25, 0));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.add(geo.sphere(0.035, 6, 4), { color: i % 2 ? 0xffe05a : 0x5affb0, part: P.Tail, pivot: [0, 0.35, 0] }, T(Math.cos(a) * 0.4, 0.35, Math.sin(a) * 0.4));
  }
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.5; b.add(geo.cyl(0.012, 0.02, 0.18, 5), { color: 0x6f7a86 }, T(Math.cos(a) * 0.26, 0.2, Math.sin(a) * 0.26, Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3)); }
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
      for (let i = 0; i < 10; i++) { const a = i * 2.4, e = (i % 3) * 0.4; b.add(geo.ico(0.06, 1), { color: i % 2 ? 0xfaf7f0 : 0xece6da, jitter: 0.008 }, T(Math.cos(a) * 0.13 * Math.cos(e), 0.27 + Math.sin(e) * 0.09, Math.sin(a) * 0.15)); }
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
      if (sp === Sp.Wolf) for (let i = 0; i < 5; i++) b.add(geo.ico(0.06, 1), { color: i % 2 ? belly : fur, jitter: 0.01 }, T(Math.cos(i * 1.3) * 0.06, bodyY + 0.05, 0.13 + Math.sin(i * 1.3) * 0.02));
      if (deer) for (let i = 0; i < 7; i++) b.add(geo.sphere(0.014, 5, 4), { color: 0xf4ead8 }, T((i % 2 ? 1 : -1) * (0.075 + (i % 3) * 0.01), bodyY + 0.06 + (i % 3) * 0.02, -0.12 + i * 0.035));
      if (bear) b.add(geo.ico(0.1 * S, 1), { color: 0x6a4630, jitter: 0.015 }, T(0, bodyY + 0.1 * S, 0.06 * S, 0, 0, 0, 1.3, 0.8, 1));
      const hp: [number, number, number] = [0, bodyY + 0.04 * S, 0.17 * S];
      const hy = bodyY + (deer ? 0.13 : 0.06) * S, hz = 0.24 * S;
      b.add(geo.sphere(0.095 * S, 12, 10), { color: fur, part: P.Head, pivot: hp }, T(0, hy, hz));
      b.add(geo.capsule(0.045 * S, (deer ? 0.05 : 0.08) * S, 3, 8), { color: bear ? 0x9b7050 : fur, part: P.Head, pivot: hp }, T(0, hy - 0.02 * S, hz + 0.09 * S, Math.PI / 2));
      b.add(geo.sphere(0.022 * S, 6, 4), { color: 0x1f1b1d, part: P.Head, pivot: hp }, T(0, hy - 0.005 * S, hz + 0.16 * S));
      for (const s of [-1, 1]) {
        b.add(geo.sphere(0.018 * S, 6, 4), { color: 0x1d1a24, part: P.Head, pivot: hp }, T(s * 0.045 * S, hy + 0.03 * S, hz + 0.07 * S));
        b.add(geo.sphere(0.006 * S, 4, 3), { color: 0xffffff, part: P.Head, pivot: hp }, T(s * 0.043 * S, hy + 0.037 * S, hz + 0.085 * S));
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

// ------------------------------------------------------------------ more wildlife & monsters
function wildlife(sp: Sp): THREE.BufferGeometry {
  const b = new ModelBuilder(13 + sp, true);
  const eye = (x: number, y: number, z: number, r: number, hp: [number, number, number]) => {
    b.add(geo.sphere(r, 6, 4), { color: 0x1d1a24, part: P.Head, pivot: hp }, T(x, y, z));
    b.add(geo.sphere(r * 0.35, 4, 3), { color: 0xffffff, part: P.Head, pivot: hp }, T(x * 0.95, y + r * 0.35, z + r * 0.6));
  };
  switch (sp) {
    case Sp.Rabbit: {
      const fur = 0xcab49a;
      b.add(geo.sphere(0.085, 12, 10), { color: fur }, T(0, 0.09, -0.01, 0, 0, 0, 0.9, 0.85, 1.15));
      b.add(geo.sphere(0.05, 8, 6), { color: 0xf3ece2 }, T(0, 0.075, 0.04, 0, 0, 0, 0.8, 0.7, 1));
      const hp: [number, number, number] = [0, 0.13, 0.06];
      b.add(geo.sphere(0.055, 12, 10), { color: fur, part: P.Head, pivot: hp }, T(0, 0.16, 0.1));
      for (const sd of [-1, 1]) {
        b.add(geo.capsule(0.017, 0.09, 3, 6), { color: fur, part: P.HeadAtt, pivot: hp }, T(sd * 0.025, 0.25, 0.08, -0.25, 0, sd * 0.18));
        b.add(geo.capsule(0.009, 0.07, 3, 4), { color: 0xf0b8b8, part: P.HeadAtt, pivot: hp }, T(sd * 0.025, 0.25, 0.092, -0.25, 0, sd * 0.18));
        eye(sd * 0.03, 0.175, 0.145, 0.011, hp);
      }
      b.add(geo.sphere(0.012, 5, 4), { color: 0xe88a9a, part: P.Head, pivot: hp }, T(0, 0.155, 0.155));
      b.add(geo.sphere(0.03, 8, 6), { color: 0xffffff, part: P.Tail, pivot: [0, 0.1, -0.1] }, T(0, 0.1, -0.11));
      for (const [x, z, p] of [[0.04, 0.06, P.LLeg], [-0.04, 0.06, P.RLeg], [0.05, -0.06, P.RLeg], [-0.05, -0.06, P.LLeg]] as const)
        b.add(geo.capsule(0.016, z < 0 ? 0.05 : 0.035, 3, 4), { color: fur, part: p, pivot: [x, 0.07, z] }, T(x, 0.03, z + (z < 0 ? 0.02 : 0), z < 0 ? Math.PI / 2 : 0));
      break;
    }
    case Sp.Fox: {
      const fur = 0xe0742e, white = 0xf6efe4, dark = 0x3a2a22;
      b.add(geo.capsule(0.07, 0.18, 4, 10), { color: fur }, T(0, 0.17, 0, Math.PI / 2));
      b.add(geo.capsule(0.05, 0.12, 3, 8), { color: white }, T(0, 0.14, 0.02, Math.PI / 2, 0, 0, 0.9, 0.7, 1));
      const hp: [number, number, number] = [0, 0.2, 0.13];
      b.add(geo.sphere(0.065, 12, 10), { color: fur, part: P.Head, pivot: hp }, T(0, 0.23, 0.19));
      b.add(geo.cone(0.04, 0.1, 8), { color: white, part: P.Head, pivot: hp }, T(0, 0.215, 0.27, Math.PI / 2));
      b.add(geo.sphere(0.014, 5, 4), { color: dark, part: P.Head, pivot: hp }, T(0, 0.215, 0.32));
      for (const sd of [-1, 1]) { b.add(geo.cone(0.03, 0.08, 4), { color: fur, part: P.Head, pivot: hp }, T(sd * 0.04, 0.3, 0.17, 0, 0, -sd * 0.2)); eye(sd * 0.03, 0.245, 0.245, 0.011, hp); }
      for (const [x, z, p] of [[0.045, 0.08, P.LLeg], [-0.045, 0.08, P.RLeg], [0.045, -0.08, P.RLeg], [-0.045, -0.08, P.LLeg]] as const)
        b.add(geo.capsule(0.018, 0.09, 3, 5), { color: dark, part: p, pivot: [x, 0.15, z] }, T(x, 0.06, z));
      const tp: [number, number, number] = [0, 0.19, -0.14];
      b.add(geo.capsule(0.05, 0.16, 3, 8), { color: fur, part: P.Tail, pivot: tp }, T(0, 0.2, -0.24, -1.1));
      b.add(geo.sphere(0.045, 8, 6), { color: white, part: P.Tail, pivot: tp }, T(0, 0.26, -0.33));
      break;
    }
    case Sp.Boar: {
      const hide = 0x6a4a36, dark = 0x3e2a1e;
      b.add(geo.capsule(0.12, 0.2, 4, 10), { color: hide }, T(0, 0.22, 0, Math.PI / 2, 0, 0, 1, 1.05, 1));
      // bristly mane
      for (let i = 0; i < 5; i++) b.add(geo.cone(0.03, 0.08, 4), { color: dark }, T(0, 0.34, 0.12 - i * 0.06, -0.3));
      const hp: [number, number, number] = [0, 0.24, 0.16];
      b.add(geo.sphere(0.1, 12, 10), { color: hide, part: P.Head, pivot: hp }, T(0, 0.23, 0.24, 0, 0, 0, 0.95, 0.95, 1.15));
      b.add(geo.cyl(0.045, 0.05, 0.06, 10), { color: 0xc89a8a, part: P.Head, pivot: hp }, T(0, 0.2, 0.35, Math.PI / 2));
      for (const sd of [-1, 1]) {
        b.add(geo.cone(0.013, 0.07, 5), { color: 0xf3ecd8, part: P.Head, pivot: hp }, T(sd * 0.045, 0.2, 0.33, -0.9, 0, sd * 0.3));
        b.add(geo.cone(0.03, 0.06, 4), { color: dark, part: P.Head, pivot: hp }, T(sd * 0.06, 0.32, 0.2, 0, 0, -sd * 0.4));
        eye(sd * 0.05, 0.26, 0.31, 0.012, hp);
      }
      for (const [x, z, p] of [[0.06, 0.1, P.LLeg], [-0.06, 0.1, P.RLeg], [0.06, -0.1, P.RLeg], [-0.06, -0.1, P.LLeg]] as const)
        b.add(geo.capsule(0.03, 0.09, 3, 5), { color: dark, part: p, pivot: [x, 0.18, z] }, T(x, 0.07, z));
      b.add(geo.capsule(0.012, 0.06, 3, 4), { color: dark, part: P.Tail, pivot: [0, 0.25, -0.18] }, T(0, 0.24, -0.21, -0.6));
      break;
    }
    case Sp.Crocodile: {
      const scale = (p: THREE.Vector3) => hex(0x4f7a3a).multiplyScalar(0.85 + 0.25 * ((Math.floor(p.z * 30) + Math.floor(p.x * 30)) % 2));
      b.add(geo.capsule(0.09, 0.42, 4, 10), { color: scale }, T(0, 0.1, 0, Math.PI / 2, 0, 0, 1.25, 0.75, 1));
      b.add(geo.capsule(0.07, 0.3, 3, 8), { color: 0xd8c890 }, T(0, 0.07, 0.02, Math.PI / 2, 0, 0, 1.1, 0.5, 1));
      for (let i = 0; i < 7; i++) b.add(geo.cone(0.022, 0.05, 4), { color: 0x3a5a2a }, T(0, 0.16, 0.2 - i * 0.07));
      const hp: [number, number, number] = [0, 0.1, 0.3];
      b.add(geo.box(0.13, 0.05, 0.26), { color: 0x4f7a3a, part: P.Head, pivot: hp }, T(0, 0.11, 0.42));
      b.add(geo.box(0.12, 0.035, 0.24), { color: 0x45682f, part: P.Head, pivot: hp }, T(0, 0.07, 0.41));
      for (let i = 0; i < 5; i++) for (const sd of [-1, 1]) b.add(geo.cone(0.008, 0.025, 3), { color: 0xf3ecd8, part: P.Head, pivot: hp }, T(sd * 0.055, 0.085, 0.32 + i * 0.045, Math.PI));
      for (const sd of [-1, 1]) { b.add(geo.sphere(0.025, 8, 6), { color: 0x4f7a3a, part: P.Head, pivot: hp }, T(sd * 0.045, 0.15, 0.34)); b.add(geo.sphere(0.013, 6, 4), { color: 0xe8d84a, part: P.Head, pivot: hp }, T(sd * 0.045, 0.165, 0.355)); }
      for (const [x, z, p] of [[0.11, 0.17, P.LLeg], [-0.11, 0.17, P.RLeg], [0.11, -0.15, P.RLeg], [-0.11, -0.15, P.LLeg]] as const)
        b.add(geo.capsule(0.025, 0.06, 3, 5), { color: 0x45682f, part: p, pivot: [x * 0.7, 0.08, z] }, T(x, 0.04, z, 0, 0, Math.sign(x) * 0.9));
      const tp: [number, number, number] = [0, 0.1, -0.3];
      b.add(geo.cone(0.075, 0.4, 8), { color: scale, part: P.Tail, pivot: tp }, T(0, 0.09, -0.48, -Math.PI / 2, 0, 0, 1, 1, 0.7));
      break;
    }
    case Sp.Fish: {
      const body = (p: THREE.Vector3) => hex(0x4aa8d8).lerp(hex(0xe8f4ff), Math.max(0, Math.min(1, (0.06 - p.y) * 12)));
      b.add(geo.sphere(0.07, 12, 8), { color: body }, T(0, 0.06, 0, 0, 0, 0, 0.6, 0.9, 1.5));
      b.add(geo.box(0.005, 0.06, 0.06), { color: 0xf2a33a }, T(0, 0.12, -0.01));
      for (const sd of [-1, 1]) { b.add(geo.sphere(0.012, 5, 4), { color: 0x1d1a24 }, T(sd * 0.032, 0.075, 0.07)); b.add(geo.box(0.004, 0.025, 0.04), { color: 0xf2a33a }, T(sd * 0.035, 0.045, 0.02, 0, 0, sd * 0.6)); }
      const tp: [number, number, number] = [0, 0.06, -0.09];
      b.add(geo.cone(0.05, 0.08, 4), { color: 0xf2a33a, part: P.Tail, pivot: tp }, T(0, 0.06, -0.12, -Math.PI / 2, 0, 0, 0.15, 1, 1));
      break;
    }
    case Sp.Dragon: {
      const sc = (p: THREE.Vector3) => hex(0xb8322a).lerp(hex(0x6a1a22), Math.max(0, Math.min(1, (0.3 - p.y) * 3)));
      const belly = 0xf2c46a;
      b.add(geo.capsule(0.12, 0.3, 4, 12), { color: sc }, T(0, 0.3, 0, Math.PI / 2 - 0.15));
      b.add(geo.capsule(0.09, 0.22, 3, 10), { color: belly }, T(0, 0.26, 0.03, Math.PI / 2 - 0.15, 0, 0, 0.9, 0.7, 1));
      // neck & head
      b.add(geo.capsule(0.06, 0.16, 3, 8), { color: sc }, T(0, 0.42, 0.24, 0.6));
      const hp: [number, number, number] = [0, 0.48, 0.3];
      b.add(geo.sphere(0.08, 12, 10), { color: 0xb8322a, part: P.Head, pivot: hp }, T(0, 0.53, 0.36, 0, 0, 0, 0.9, 0.85, 1.2));
      b.add(geo.box(0.09, 0.05, 0.12), { color: 0xa82a24, part: P.Head, pivot: hp }, T(0, 0.51, 0.45));
      for (const sd of [-1, 1]) {
        b.add(geo.cone(0.018, 0.12, 5), { color: 0xf3ecd8, part: P.HeadAtt, pivot: hp }, T(sd * 0.04, 0.62, 0.3, -0.7, 0, sd * 0.3));
        b.add(geo.sphere(0.016, 6, 4), { color: 0xffd23a, part: P.Head, pivot: hp }, T(sd * 0.04, 0.56, 0.43));
      }
      // wings are the "hands": they flap with the flying pose
      for (const sd of [-1, 1]) {
        const part = sd < 0 ? P.LHand : P.RHand;
        const piv: [number, number, number] = [sd * 0.1, 0.38, 0.05];
        b.add(geo.cyl(0.012, 0.018, 0.4, 5), { color: 0x6a1a22, part, pivot: piv }, T(sd * 0.3, 0.42, 0.04, 0, 0, sd * 1.35));
        b.add(geo.box(0.42, 0.012, 0.3), { color: 0xd85a3a, part, pivot: piv }, T(sd * 0.31, 0.4, -0.08, 0, 0, sd * -0.1));
        for (let i = 0; i < 3; i++) b.add(geo.cyl(0.006, 0.01, 0.3, 4), { color: 0x6a1a22, part, pivot: piv }, T(sd * (0.2 + i * 0.1), 0.4, -0.08, Math.PI / 2 - 0.3 + i * 0.2, 0, 0));
      }
      for (const [x, z, p] of [[0.08, 0.1, P.LLeg], [-0.08, 0.1, P.RLeg], [0.08, -0.12, P.RLeg], [-0.08, -0.12, P.LLeg]] as const)
        b.add(geo.capsule(0.035, 0.12, 3, 6), { color: 0x8a2420, part: p, pivot: [x, 0.25, z] }, T(x, 0.12, z));
      const tp: [number, number, number] = [0, 0.28, -0.22];
      b.add(geo.cone(0.07, 0.5, 8), { color: sc, part: P.Tail, pivot: tp }, T(0, 0.24, -0.45, -Math.PI / 2 - 0.2));
      b.add(geo.octa(0.05), { color: 0xd85a3a, part: P.Tail, pivot: tp, flat: true }, T(0, 0.19, -0.72));
      for (let i = 0; i < 5; i++) b.add(geo.cone(0.025, 0.06, 4), { color: belly }, T(0, 0.44 - i * 0.02, 0.12 - i * 0.1));
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
    [Sp.Troll]: humanoid({ height: 0.62, width: 0.26, headR: 0.11, skinDefault: 0x7f9a98, style: 'troll' }),
    [Sp.Sheep]: quadruped(Sp.Sheep),
    [Sp.Wolf]: quadruped(Sp.Wolf),
    [Sp.Deer]: quadruped(Sp.Deer),
    [Sp.Bear]: quadruped(Sp.Bear),
    [Sp.Chicken]: quadruped(Sp.Chicken),
    [Sp.Boat]: boat(),
    [Sp.Tank]: tank(),
    [Sp.Plane]: plane(),
    [Sp.Rabbit]: wildlife(Sp.Rabbit),
    [Sp.Fox]: wildlife(Sp.Fox),
    [Sp.Boar]: wildlife(Sp.Boar),
    [Sp.Crocodile]: wildlife(Sp.Crocodile),
    [Sp.Fish]: wildlife(Sp.Fish),
    [Sp.Dragon]: wildlife(Sp.Dragon),
    [Sp.Zombie]: humanoid({ height: 0.62, width: 0.2, headR: 0.125, skinDefault: 0x8aa66a, style: 'zombie' }),
    [Sp.Mage]: humanoid({ height: 0.64, width: 0.2, headR: 0.12, skinDefault: 0xeebd94, style: 'mage' }),
    [Sp.UFO]: ufo(),
    [Sp.Alien]: humanoid({ height: 0.56, width: 0.16, headR: 0.14, skinDefault: 0x9ad6a0, style: 'alien' }),
    [Sp.Demon]: humanoid({ height: 0.68, width: 0.24, headR: 0.12, skinDefault: 0xc8322a, style: 'demon' }),
    [Sp.ColdOne]: humanoid({ height: 0.7, width: 0.27, headR: 0.12, skinDefault: 0x9fd8f0, style: 'coldone' }),
  };
}

export const SKIN_TONES: Record<number, number[]> = {
  [Sp.Human]: [0xf7d3b5, 0xeebd94, 0xd59c6f, 0xa86f48, 0x7c4f33],
  [Sp.Elf]: [0xfbe6d4, 0xf3d9c2, 0xe9cfb7],
  [Sp.Dwarf]: [0xf0c3a0, 0xe0a882, 0xc78e68],
  [Sp.Orc]: [0x7fae5a, 0x6d9b4e, 0x8fb565, 0x5f8a49],
  [Sp.Troll]: [0x7f9a98, 0x6f8a8a, 0x8aa6a2],
  [Sp.Zombie]: [0x8aa66a, 0x7a9a6a, 0x9aae7a, 0x6f8a5a],
  [Sp.Mage]: [0xf7d3b5, 0xeebd94, 0xd59c6f],
  [Sp.Alien]: [0x9ad6a0, 0xa8b4c0, 0x8ac8b8],
  [Sp.Demon]: [0xc8322a, 0xb02a24, 0xd84a2a],
  [Sp.ColdOne]: [0x9fd8f0, 0xb8e8f8, 0x8ac8e8],
};
export const HAIR_TONES: Record<number, number[]> = {
  [Sp.Human]: [0x3a2618, 0x5b3920, 0x8a5a2e, 0xd9b05a, 0x1f1a1a, 0xb54a22],
  [Sp.Elf]: [0xf2e2a8, 0xe8e8f0, 0xc9e0a0, 0xd9a85a],
  [Sp.Dwarf]: [0xb54a22, 0x8a5a2e, 0x5b3920, 0xd9b05a, 0x9a9a9a],
  [Sp.Orc]: [0x1f1a1a, 0x3a2618, 0x4a3a2a],
  [Sp.Zombie]: [0x2a2420, 0x4a3a2a, 0x5a5048],
  [Sp.Mage]: [0xf0f0f4, 0xd8d8e0, 0xbcbcc8],
};
void hex;
