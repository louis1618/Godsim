import * as THREE from 'three';
import { ModelBuilder, T, geo, hex, vgrad } from './models/kit';
import { buildCreatureModels } from './models/creatures';
import { buildBuildingModels, bkey } from './models/buildings';
import { oak, pine } from './models/nature';
import { Sp, Bk } from '../sim/defs';
import { Noise2D } from '../core/noise';

/**
 * The icon forge: every UI icon is a tiny 3D diorama built with the same modelling kit as the
 * world, rendered once at boot, then given a chunky ink outline + soft shadow (sticker style).
 */
const INK = '#2a2238';
const SIZE = 192;

type Maker = () => THREE.Object3D;

const std = (g: THREE.BufferGeometry, emissive = 0x000000, ei = 0) => new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.05, emissive, emissiveIntensity: ei }));

function block(top: number, side: number, deco?: (b: ModelBuilder) => void, h = 0.55): THREE.Object3D {
  const b = new ModelBuilder(1);
  b.add(geo.rbox(1, h, 1, 0.08, 2), { color: (p) => (p.y > h / 2 - 0.09 ? hex(top) : hex(side).multiplyScalar(0.85 + 0.15 * Math.sin(p.y * 30))) }, T(0, h / 2, 0));
  deco?.(b);
  return std(b.build());
}

function arrow(color: number, up: boolean): THREE.BufferGeometry {
  const b = new ModelBuilder(2);
  b.add(geo.cyl(0.09, 0.09, 0.42, 10), { color }, T(0, up ? 0.21 : 0.29, 0));
  b.add(geo.cone(0.22, 0.3, 12), { color }, up ? T(0, 0.55, 0) : T(0, 0, 0, Math.PI));
  return b.build();
}

function creature(models: Record<number, THREE.BufferGeometry>, sp: Sp, cloth: number, skin: number, hair: number, item = 0): THREE.Object3D {
  const src = models[sp].clone();
  const col = src.attributes.color as THREE.BufferAttribute;
  const slot = src.attributes.aSlot as THREE.BufferAttribute;
  const part = src.attributes.aPart as THREE.BufferAttribute;
  const it = src.attributes.aItem as THREE.BufferAttribute | undefined;
  const piv = src.attributes.aPivot as THREE.BufferAttribute | undefined;
  const pos = src.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Color();
  const cl = hex(cloth), sk = hex(skin), hr = hex(hair);
  for (let i = 0; i < col.count; i++) {
    c.fromBufferAttribute(col, i);
    const s = Math.round(slot.getX(i));
    if (s === 1) c.multiply(cl); else if (s === 2) c.multiply(sk); else if (s === 3) c.multiply(hr);
    else if (s === 4) c.multiply(cl.clone().multiplyScalar(0.4).addScalar(0.1)); else if (s === 5) c.multiply(cl.clone().lerp(new THREE.Color(1, 1, 1), 0.6));
    col.setXYZ(i, c.r, c.g, c.b);
    if (Math.round(part.getX(i)) === 6 && it && piv && Math.round(it.getX(i)) !== item) pos.setXYZ(i, piv.getX(i), piv.getY(i), piv.getZ(i));
  }
  const m = std(src);
  m.rotation.y = -0.35;
  if (sp <= Sp.Orc || sp === Sp.Skeleton || sp === Sp.Troll) {
    const h = sp === Sp.Dwarf ? 0.5 : sp === Sp.Elf ? 0.68 : sp === Sp.Orc ? 0.66 : 0.62;
    m.userData.frame = { y: h * 0.66, r: h * 0.42 };
  }
  return m;
}

function cloud(dark = false): ModelBuilder {
  const b = new ModelBuilder(4);
  const c1 = dark ? 0x6f7380 : 0xffffff, c2 = dark ? 0x4a4e5a : 0xd6e2ee;
  for (const [x, y, r] of [[0, 0.1, 0.42], [0.38, -0.02, 0.32], [-0.38, -0.04, 0.3], [0.15, 0.32, 0.3], [-0.18, 0.26, 0.28]] as const)
    b.add(geo.ico(r, 2), { color: vgrad(c2, c1, -0.25, 0.45) }, T(x, y + 0.6, 0));
  return b;
}

function bolt(b: ModelBuilder, color: number, m: THREE.Matrix4) {
  b.add(geo.extrude([[0.05, 0.5], [-0.18, 0.02], [0.0, 0.02], [-0.12, -0.5], [0.22, 0.08], [0.03, 0.08], [0.17, 0.5]], 0.12, 0.02), { color }, m);
}

const TEAR: [number, number][] = [[0, 0], [0.2, 0.03], [0.3, 0.14], [0.32, 0.3], [0.26, 0.5], [0.15, 0.72], [0.05, 0.9], [0, 1]];
function flame(b: ModelBuilder, s = 1, x = 0, z = 0) {
  const toward = new THREE.Vector3(0.55, 0.3, 1).normalize();
  const layer = (sc: number, push: number, col: number, top: number, ox = 0, rz = 0, hs = 1) =>
    b.add(geo.lathe(TEAR, 16), { color: vgrad(col, top, 0, 0.9 * sc * s) }, T(x + ox * s + toward.x * push * s, toward.y * push * s, z + toward.z * push * s, 0, 0, rz, sc * s, sc * s * hs, sc * s));
  layer(0.62, -0.05, 0xe8361a, 0xff7a2a, -0.26, 0.35, 0.9);
  layer(0.58, -0.05, 0xe8361a, 0xff7a2a, 0.27, -0.4, 0.85);
  layer(1.0, 0, 0xf04a1c, 0xffa030, 0, 0, 1.1);
  layer(0.68, 0.18, 0xff9a24, 0xffd050, 0.02, 0, 1.0);
  layer(0.38, 0.33, 0xffe07a, 0xfff8d8, 0.03, 0, 0.95);
}

function sword(b: ModelBuilder, rz: number) {
  const m = new THREE.Matrix4().makeRotationZ(rz);
  const at = (x: number, y: number, z: number) => m.clone().multiply(T(x, y, z));
  b.add(geo.box(0.11, 0.85, 0.04), { color: vgrad(0xb9c4d0, 0xf4f8fc, 0, 0.9) }, at(0, 0.5, 0));
  b.add(geo.cone(0.078, 0.14, 4), { color: 0xf4f8fc }, at(0, 1.0, 0).multiply(new THREE.Matrix4().makeScale(1, 1, 0.35)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 4)));
  b.add(geo.rbox(0.42, 0.08, 0.1, 0.03, 1), { color: 0xd9a830 }, at(0, 0.06, 0));
  b.add(geo.cyl(0.045, 0.045, 0.24, 8), { color: 0x6b4428 }, at(0, -0.1, 0));
  b.add(geo.sphere(0.07, 10, 8), { color: 0xd9a830 }, at(0, -0.24, 0));
}

function makeIcons(): Record<string, Maker> {
  const models = buildCreatureModels();
  const blds = buildBuildingModels();
  const H = 0x3a7ae0;
  const m: Record<string, Maker> = {};
  // ---------------- categories
  m['cat-world'] = () => {
    const n = new Noise2D(5);
    const g = geo.ico(0.6, 4);
    const b = new ModelBuilder(1);
    b.add(g, { color: (p) => { const v = n.fbm(p.x * 2.2 + 3, p.y * 2.2 + p.z * 1.7, 3); return v > 0.05 ? (p.y > 0.45 ? hex(0xf4f7fb) : hex(v > 0.25 ? 0x4f9a3a : 0x86c94f)) : hex(v > -0.05 ? 0x5ac8e0 : 0x2a7fc4); } });
    b.add(geo.torus(0.82, 0.035, 6, 40), { color: 0xffd65a }, T(0, 0, 0, 1.2, 0, 0.3));
    return std(b.build());
  };
  m['cat-life'] = () => creature(models, Sp.Human, 0xe2483d, 0xf7d3b5, 0x5b3920);
  m['cat-civ'] = () => { const o = std(blds.get(bkey(Bk.TownHall, Sp.Human, 3))!.clone()); colorTeam(o, 0x3a7ae0); o.rotation.y = 0.5; return o; };
  m['cat-nature'] = () => std(oak(3)[0]);
  m['cat-disaster'] = () => { const b = new ModelBuilder(1); flame(b, 1.1); return std(b.build(), 0xff5a10, 0.3); };
  m['cat-observe'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.torus(0.36, 0.08, 10, 28), { color: 0xd9a830 }, T(0, 0.55, 0));
    b.add(geo.cyl(0.33, 0.33, 0.03, 28), { color: 0xbfe8ff }, T(0, 0.55, 0, Math.PI / 2));
    b.add(geo.cyl(0.07, 0.08, 0.5, 10), { color: 0x6b4428 }, T(0.33, 0.1, 0, 0, 0, 0.75));
    return std(b.build());
  };
  m['cat-settings'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.cyl(0.45, 0.45, 0.2, 24), { color: 0xb9c0c8 }, T(0, 0, 0, Math.PI / 2));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.add(geo.rbox(0.2, 0.2, 0.2, 0.03, 1), { color: 0xa0a8b2 }, T(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0, 0, 0, a)); }
    b.add(geo.cyl(0.17, 0.17, 0.24, 18), { color: 0x6f7680 }, T(0, 0, 0, Math.PI / 2));
    return std(b.build());
  };
  // ---------------- observe
  m['inspect'] = m['cat-observe'];
  m['hand'] = () => {
    const b = new ModelBuilder(1);
    const skin = 0xffe0c4;
    b.add(geo.rbox(0.62, 0.62, 0.26, 0.12, 2), { color: skin }, T(0, 0.35, 0));
    for (let i = 0; i < 4; i++) b.add(geo.capsule(0.075, 0.28, 4, 10), { color: skin }, T(-0.22 + i * 0.145, 0.85 + (i === 1 || i === 2 ? 0.05 : 0), 0, 0, 0, 0));
    b.add(geo.capsule(0.08, 0.22, 4, 10), { color: skin }, T(-0.4, 0.42, 0.04, 0, 0, 0.9));
    b.add(geo.cyl(0.32, 0.3, 0.14, 16), { color: 0xffd65a }, T(0, 0.03, 0, 0, 0, 0, 1, 1, 0.5));
    return std(b.build());
  };
  m['follow'] = () => {
    const b = new ModelBuilder(1);
    for (const s of [-1, 1]) {
      b.add(geo.cyl(0.17, 0.2, 0.55, 18), { color: 0x4a4458 }, T(s * 0.22, 0.45, 0, Math.PI / 2 - 0.2));
      b.add(geo.cyl(0.19, 0.19, 0.08, 18), { color: 0xd9a830 }, T(s * 0.22, 0.4, 0.27, Math.PI / 2 - 0.2));
      b.add(geo.cyl(0.14, 0.14, 0.02, 18), { color: 0x8fdcff }, T(s * 0.22, 0.4, 0.32, Math.PI / 2 - 0.2));
    }
    b.add(geo.rbox(0.2, 0.12, 0.2, 0.04, 1), { color: 0x2a2238 }, T(0, 0.48, 0));
    return std(b.build());
  };
  m['stats'] = () => {
    const b = new ModelBuilder(1);
    const cols = [0xff6a6a, 0xffc53d, 0x6cc04a, 0x3a7ae0];
    [0.35, 0.6, 0.45, 0.85].forEach((h, i) => b.add(geo.rbox(0.2, h, 0.2, 0.04, 1), { color: cols[i] }, T(-0.36 + i * 0.24, h / 2, 0)));
    b.add(geo.rbox(1.05, 0.06, 0.4, 0.02, 1), { color: 0x6b4428 }, T(0, -0.02, 0));
    return std(b.build());
  };
  m['history'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.rbox(0.8, 0.12, 0.6, 0.04, 1), { color: 0x9a3a2a }, T(0, 0.06, 0));
    b.add(geo.rbox(0.74, 0.1, 0.56, 0.03, 1), { color: 0xfff2d8 }, T(0, 0.15, 0));
    b.add(geo.rbox(0.8, 0.12, 0.6, 0.04, 1), { color: 0xb84a36 }, T(0, 0.25, 0, 0, 0, 0.0));
    b.add(geo.box(0.06, 0.13, 0.62), { color: 0xd9a830 }, T(-0.25, 0.25, 0));
    b.add(geo.octa(0.09), { color: 0xffd65a, flat: true }, T(0.15, 0.33, 0.1, 0, 0, 0, 1, 0.4, 1));
    const o = std(b.build()); o.rotation.x = 0.3; return o;
  };
  m['kingdoms'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.cyl(0.03, 0.035, 1.1, 8), { color: 0x6b4428 }, T(-0.35, 0.55, 0));
    b.add(geo.sphere(0.06, 8, 6), { color: 0xd9a830 }, T(-0.35, 1.12, 0));
    b.add(geo.extrude([[0, 0], [0.7, 0], [0.7, -0.55], [0.35, -0.42], [0, -0.55]], 0.04), { color: H }, T(-0.33, 1.02, 0));
    b.add(geo.extrude([[0, 0.12], [0.1, -0.05], [-0.1, -0.05]], 0.05), { color: 0xffd65a }, T(0.02, 0.73, 0.03));
    return std(b.build());
  };
  // ---------------- world
  const soil = 0x8a6440;
  m['raise'] = () => { const g = new THREE.Group(); g.add(block(0x86c94f, soil)); const a = std(arrow(0xffd65a, true)); a.position.set(0, 0.6, 0); g.add(a); return g; };
  m['lower'] = () => { const g = new THREE.Group(); g.add(block(0x86c94f, soil, (b) => b.add(geo.cyl(0.3, 0.2, 0.1, 16), { color: 0x5a3e28 }, T(0, 0.52, 0)))); const a = std(arrow(0x5ab4ff, false)); a.position.set(0, 0.6, 0); g.add(a); return g; };
  m['flatten'] = () => block(0xd8c48a, soil, (b) => {
    b.add(geo.rbox(0.6, 0.06, 0.32, 0.02, 1), { color: 0xb9c0c8 }, T(0, 0.62, 0, 0, 0.4, 0));
    b.add(geo.cyl(0.04, 0.04, 0.3, 8), { color: 0x6b4428 }, T(0, 0.78, 0, 0, 0, 0));
    b.add(geo.sphere(0.07, 8, 6), { color: 0x6b4428 }, T(0, 0.95, 0));
  });
  m['ocean'] = () => block(0x2a7fc4, 0x2a5f94, (b) => { for (let i = 0; i < 3; i++) b.add(geo.torus(0.12, 0.035, 6, 14, Math.PI), { color: 0xffffff }, T(-0.25 + i * 0.25, 0.56, -0.1 + (i % 2) * 0.2, 0, 0.3, 0)); });
  m['land'] = () => block(0x86c94f, soil, (b) => { b.add(geo.cone(0.06, 0.18, 4), { color: 0x5fa83a }, T(0.2, 0.62, 0.15)); b.add(geo.cone(0.06, 0.15, 4), { color: 0x5fa83a }, T(0.28, 0.6, 0.05)); b.add(geo.sphere(0.06, 6, 4), { color: 0xf7d84a }, T(-0.2, 0.58, 0.2)); });
  m['mountain'] = () => block(0x86c94f, soil, (b) => {
    b.add(geo.cone(0.42, 0.75, 7), { color: vgrad(0x8d8780, 0xb9b3aa, 0.5, 1.2), flat: true }, T(0, 0.92, 0));
    b.add(geo.cone(0.16, 0.24, 7), { color: 0xf4f7fb, flat: true }, T(0, 1.18, 0));
    b.add(geo.cone(0.25, 0.42, 6), { color: 0x9a948c, flat: true }, T(0.3, 0.75, 0.15));
  });
  m['grass'] = () => block(0x86c94f, soil, (b) => { for (let i = 0; i < 6; i++) b.add(geo.cone(0.05, 0.22, 4), { color: i % 2 ? 0x5fa83a : 0x9ad65a }, T(-0.3 + (i % 3) * 0.3, 0.64, -0.2 + Math.floor(i / 3) * 0.35, 0, 0, (i - 3) * 0.1)); });
  m['sand'] = () => block(0xf2dca0, 0xc8a870, (b) => { b.add(geo.cone(0.1, 0.12, 8), { color: 0xf8b0a8 }, T(0.18, 0.6, 0.1, 0, 0, 0.3)); b.add(geo.sphere(0.06, 8, 6), { color: 0xfff0e0 }, T(-0.2, 0.58, -0.1)); });
  m['desert'] = () => block(0xf0c27b, 0xc8955a, (b) => {
    b.add(geo.capsule(0.09, 0.4, 4, 10), { color: 0x4f9a46 }, T(0, 0.85, 0));
    b.add(geo.capsule(0.06, 0.16, 3, 10), { color: 0x4f9a46 }, T(0.15, 0.85, 0));
    b.add(geo.capsule(0.05, 0.12, 3, 10), { color: 0x4f9a46 }, T(-0.14, 0.95, 0));
  });
  m['snow'] = () => block(0xf4f7fb, 0x9aa6b8, (b) => { for (let i = 0; i < 6; i++) b.add(geo.rbox(0.42, 0.05, 0.08, 0.02, 1), { color: 0x9fd8ff }, T(0, 0.75, 0, 0, 0, (i / 6) * Math.PI)); });
  m['swamp'] = () => block(0x6c8a45, 0x4d5a34, (b) => { b.add(geo.cyl(0.25, 0.25, 0.04, 16), { color: 0x5a8a6a }, T(0.1, 0.56, 0.1)); for (let i = 0; i < 3; i++) b.add(geo.cyl(0.015, 0.015, 0.35, 5), { color: 0x7a9a4a }, T(-0.25 + i * 0.06, 0.7, -0.2)); b.add(geo.capsule(0.03, 0.08, 3, 6), { color: 0x6b4428 }, T(-0.19, 0.88, -0.2)); });
  m['lava'] = () => { const o = block(0xff6a1c, 0x5a3a2a, (b) => { b.add(geo.sphere(0.12, 10, 8), { color: 0xffc040 }, T(0.15, 0.56, 0.1)); b.add(geo.sphere(0.07, 8, 6), { color: 0xffd060 }, T(-0.2, 0.58, -0.15)); }); ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive.setHex(0x601000); return o; };
  // ---------------- life
  m['human'] = () => creature(models, Sp.Human, 0x3a7ae0, 0xeebd94, 0x5b3920, 4);
  m['elf'] = () => creature(models, Sp.Elf, 0x46b04a, 0xfbe6d4, 0xf2e2a8, 5);
  m['dwarf'] = () => creature(models, Sp.Dwarf, 0xf07c2a, 0xf0c3a0, 0xb54a22, 8);
  m['orc'] = () => creature(models, Sp.Orc, 0x9a55d6, 0x7fae5a, 0x1f1a1a, 7);
  m['sheep'] = () => creature(models, Sp.Sheep, 0xffffff, 0xffffff, 0xffffff);
  m['chicken'] = () => creature(models, Sp.Chicken, 0xffffff, 0xffffff, 0xffffff);
  m['deer'] = () => creature(models, Sp.Deer, 0xffffff, 0xffffff, 0xffffff);
  m['wolf'] = () => creature(models, Sp.Wolf, 0xffffff, 0xffffff, 0xffffff);
  m['bear'] = () => creature(models, Sp.Bear, 0xffffff, 0xffffff, 0xffffff);
  m['skeleton'] = () => creature(models, Sp.Skeleton, 0xffffff, 0xffffff, 0xffffff, 4);
  m['troll'] = () => creature(models, Sp.Troll, 0xffffff, 0x7f9a98, 0xffffff, 8);
  for (const [k, sp] of [['rabbit', Sp.Rabbit], ['fox', Sp.Fox], ['boar', Sp.Boar], ['crocodile', Sp.Crocodile], ['fish', Sp.Fish], ['dragon', Sp.Dragon]] as [string, Sp][])
    m[k] = () => { const o = creature(models, sp, 0xffffff, 0xffffff, 0xffffff); o.rotation.y = sp === Sp.Crocodile || sp === Sp.Fish ? -1.0 : -0.6; return o; };
  // monsters
  m['zombie'] = () => creature(models, Sp.Zombie, 0x5f6f7a, 0x8aa66a, 0x2a2420);
  m['mage'] = () => creature(models, Sp.Mage, 0x5a3ab0, 0xeebd94, 0xf0f0f4, 18);
  m['demon'] = () => creature(models, Sp.Demon, 0x5a1612, 0xc8322a, 0x000000);
  m['coldone'] = () => creature(models, Sp.ColdOne, 0xa8e0f8, 0x9fd8f0, 0xffffff);
  m['alien'] = () => creature(models, Sp.Alien, 0xb8c4d0, 0x9ad6a0, 0xffffff, 19);
  m['ufo'] = () => { const o = creature(models, Sp.UFO, 0xffffff, 0xffffff, 0xffffff); o.rotation.x = 0.35; o.position.y = -0.2; o.scale.setScalar(1.5); return o; };
  m['invasion'] = () => {
    const g = new THREE.Group();
    for (const [x, y, sc] of [[-0.3, 0.25, 0.9], [0.32, 0.55, 1.1], [0.0, -0.05, 0.75]] as const) { const o = m['ufo'](); o.position.set(x, y - 0.2, 0); o.scale.setScalar(sc); g.add(o); }
    return g;
  };
  m['outbreak'] = () => {
    const g = new THREE.Group();
    const a = creature(models, Sp.Zombie, 0x5f6f7a, 0x8aa66a, 0x2a2420); a.position.set(-0.22, 0, -0.1);
    const b2 = creature(models, Sp.Zombie, 0x6a5a7a, 0x7a9a6a, 0x4a3a2a); b2.position.set(0.25, 0, 0.12); b2.scale.multiplyScalar(0.9);
    g.add(a, b2);
    return g;
  };
  m['manual'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.rbox(0.9, 0.12, 0.66, 0.04, 1), { color: 0x8a3a2a }, T(0, 0.06, 0, 0, 0.2, 0));
    b.add(geo.rbox(0.84, 0.1, 0.6, 0.03, 1), { color: 0xf8f0dc }, T(0.02, 0.15, 0, 0, 0.2, 0));
    b.add(geo.rbox(0.9, 0.06, 0.66, 0.03, 1), { color: 0xc8483a }, T(0, 0.23, 0, 0, 0.2, 0));
    b.add(geo.cyl(0.13, 0.13, 0.02, 16), { color: 0xffd23a }, T(0.05, 0.27, 0, 0, 0.2, 0));
    b.add(geo.box(0.06, 0.02, 0.5), { color: 0xffd23a }, T(-0.3, 0.27, 0, 0, 0.2, 0));
    b.add(geo.box(0.08, 0.3, 0.02), { color: 0x3a6ab8 }, T(0.3, 0.25, 0.28, 0.2, 0.2, 0));
    return std(b.build());
  };
  m['volcano'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.cyl(0.18, 0.62, 0.62, 14, 3), { color: (p) => hex(0x5a4a42).lerp(hex(0x8a7a6e), Math.max(0, 1 - p.y * 2)), jitter: 0.02 }, T(0, 0.31, 0));
    b.add(geo.cyl(0.17, 0.12, 0.05, 12), { color: 0xff6a1a }, T(0, 0.63, 0));
    for (let i = 0; i < 4; i++) { const a = i * 1.7; b.add(geo.capsule(0.035, 0.18 + i * 0.05, 3, 6), { color: 0xff8a2a }, T(Math.cos(a) * 0.3, 0.38 - i * 0.02, Math.sin(a) * 0.3 + 0.1, 0, 0, Math.cos(a) * 0.5)); }
    for (let i = 0; i < 4; i++) b.add(geo.ico(0.1 + i * 0.03, 1), { color: 0x4a4440, jitter: 0.03 }, T(0.05 * i, 0.85 + i * 0.13, -0.04 * i));
    return std(b.build(), 0x602000, 0.25);
  };
  m['drought'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.cyl(0.6, 0.62, 0.12, 6), { color: 0xd8a85a, flat: true }, T(0, 0.06, 0));
    for (let i = 0; i < 4; i++) b.add(geo.box(0.6, 0.04, 0.03), { color: 0x7a5232 }, T(0, 0.125, -0.25 + i * 0.17, 0, i * 0.8, 0));
    b.add(geo.sphere(0.24, 16, 12), { color: 0xffc23a }, T(0.05, 0.75, 0));
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; b.add(geo.cone(0.05, 0.14, 5), { color: 0xffa52a }, T(0.05 + Math.cos(a) * 0.36, 0.75 + Math.sin(a) * 0.36, 0, 0, 0, a - Math.PI / 2)); }
    b.add(geo.cyl(0.02, 0.025, 0.25, 4), { color: 0x6a5a3a }, T(-0.35, 0.24, 0.15, 0, 0, 0.3));
    return std(b.build(), 0x603000, 0.15);
  };
  m['flood'] = () => {
    const b = new ModelBuilder(1);
    for (let i = 0; i < 3; i++) b.add(geo.torus(0.3 - i * 0.04, 0.09, 8, 18, Math.PI * 1.2), { color: vgrad(0x2a7fc4, 0xbfe8ff, 0, 0.6) }, T(-0.1 + i * 0.12, 0.3 + i * 0.12, -i * 0.05, 0, 0, 0.2));
    b.add(geo.rbox(0.25, 0.22, 0.22, 0.03, 1), { color: 0xf3e6c8 }, T(0.35, 0.12, 0.1));
    b.add(geo.pyramid(0.34, 0.16), { color: 0xd8483d, flat: true }, T(0.35, 0.31, 0.1));
    return std(b.build());
  };
  // ---------------- civ
  m['war'] = () => { const b = new ModelBuilder(1); sword(b, 0.75); sword(b, -0.75); return std(b.build()); };
  m['peace'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.cyl(0.03, 0.035, 1.1, 8), { color: 0x8a6a42 }, T(-0.3, 0.55, 0));
    b.add(geo.box(0.62, 0.42, 0.03), { color: 0xffffff, part: 3 }, T(0.02, 0.86, 0));
    b.add(geo.ico(0.09, 1), { color: 0x6cc04a }, T(0.02, 0.86, 0.04, 0, 0, 0, 1.6, 0.7, 0.4));
    return std(b.build());
  };
  m['alliance'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.torus(0.24, 0.07, 10, 24), { color: 0xd9a830 }, T(-0.17, 0.5, 0, 0, 0.5, 0));
    b.add(geo.torus(0.24, 0.07, 10, 24), { color: 0xffd65a }, T(0.17, 0.5, 0, 0, -0.5, Math.PI / 2));
    return std(b.build());
  };
  m['rebel'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.cyl(0.04, 0.05, 1.0, 8), { color: 0x6b4428 }, T(0, 0.45, 0, 0, 0, 0.25));
    flame(b, 0.55, -0.13, 0);
    b.add(geo.cyl(0.09, 0.07, 0.12, 10), { color: 0x4a4a52 }, T(-0.12, 0.9, 0, 0, 0, 0.25));
    return std(b.build(), 0xff5a10, 0.15);
  };
  m['bless'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.torus(0.38, 0.08, 10, 32), { color: 0xffd65a }, T(0, 0.85, 0, Math.PI / 2 - 0.9));
    for (let i = 0; i < 3; i++) b.add(geo.octa(0.1), { color: 0xfff2a0, flat: true }, T(-0.3 + i * 0.3, 0.3 + (i % 2) * 0.15, 0.1, 0, 0, 0, 0.7, 1.4, 0.7));
    return std(b.build(), 0x806000, 0.3);
  };
  m['madness'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.sphere(0.45, 20, 14), { color: 0x9a55d6 }, T(0, 0.5, 0));
    for (const s of [-1, 1]) { b.add(geo.sphere(0.12, 10, 8), { color: 0xffffff }, T(s * 0.17, 0.58, 0.36)); b.add(geo.sphere(0.06, 8, 6), { color: 0xe23a3a }, T(s * 0.17 + 0.03, 0.58, 0.46)); }
    b.add(geo.torus(0.12, 0.04, 6, 12, Math.PI), { color: 0x2a2238 }, T(0, 0.33, 0.4, 0, 0, Math.PI));
    for (let i = 0; i < 5; i++) b.add(geo.cone(0.08, 0.2, 6), { color: 0x6a2aa6 }, T(-0.3 + i * 0.15, 0.95, 0, 0, 0, (i - 2) * -0.3));
    return std(b.build());
  };
  m['crown'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.cyl(0.42, 0.38, 0.3, 24, 1, true), { color: 0xffcf3a }, T(0, 0.3, 0));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; b.add(geo.cone(0.1, 0.3, 6), { color: 0xffcf3a }, T(Math.cos(a) * 0.4, 0.58, Math.sin(a) * 0.4)); b.add(geo.sphere(0.05, 8, 6), { color: 0xfff2a0 }, T(Math.cos(a) * 0.4, 0.74, Math.sin(a) * 0.4)); }
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.6; b.add(geo.octa(0.07), { color: [0xe23a3a, 0x3a7ae0, 0x46b04a][i], flat: true }, T(Math.cos(a) * 0.41, 0.3, Math.sin(a) * 0.41)); }
    const o = std(b.build(), 0x6b4a00, 0.25); o.rotation.x = 0.2; return o;
  };
  m['strong'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.cyl(0.05, 0.05, 1.0, 10), { color: 0x6f7680 }, T(0, 0.45, 0, 0, 0, Math.PI / 2));
    for (const s of [-1, 1]) { b.add(geo.cyl(0.24, 0.24, 0.12, 20), { color: 0x3a3a48 }, T(s * 0.38, 0.45, 0, 0, 0, Math.PI / 2)); b.add(geo.cyl(0.19, 0.19, 0.1, 20), { color: 0x4a4a58 }, T(s * 0.25, 0.45, 0, 0, 0, Math.PI / 2)); }
    return std(b.build());
  };
  m['brave'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.extrude([[0, 0.5], [0.4, 0.4], [0.38, -0.05], [0, -0.5], [-0.38, -0.05], [-0.4, 0.4]], 0.12, 0.03), { color: (p) => (p.x > 0 ? hex(0xe2483d) : hex(0xf2f0e8)) }, T(0, 0.5, 0));
    b.add(geo.extrude([[0, 0.38], [0.3, 0.3], [0.28, -0.03], [0, -0.38], [-0.28, -0.03], [-0.3, 0.3]], 0.04), { color: 0xd9a830 }, T(0, 0.5, 0.06, 0, 0, 0, 0.3, 0.3, 1));
    return std(b.build());
  };
  m['fast'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.rbox(0.35, 0.45, 0.3, 0.08, 2), { color: 0x8a5a33 }, T(-0.05, 0.4, 0));
    b.add(geo.rbox(0.62, 0.18, 0.32, 0.08, 2), { color: 0x8a5a33 }, T(0.08, 0.1, 0));
    for (let i = 0; i < 3; i++) b.add(geo.extrude([[0, 0], [0.42 - i * 0.08, 0.12], [0.35 - i * 0.08, 0.02]], 0.03), { color: 0xffffff }, T(-0.28, 0.5 + i * 0.1, 0.16, 0, 0, 0.5 + i * 0.2));
    return std(b.build());
  };
  m['immortal'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.torus(0.22, 0.07, 10, 24), { color: 0x8fdcff }, T(-0.2, 0.5, 0, 0, 0, 0, 1, 1, 0.6));
    b.add(geo.torus(0.22, 0.07, 10, 24), { color: 0xbf9aff }, T(0.2, 0.5, 0, 0, 0, 0, 1, 1, 0.6));
    b.add(geo.octa(0.12), { color: 0xffffff, flat: true }, T(0, 0.5, 0.05, 0, 0, 0, 0.6, 1.2, 0.6));
    return std(b.build(), 0x2a4a80, 0.4);
  };
  // ---------------- nature
  m['rain'] = () => { const b = cloud(); for (let i = 0; i < 4; i++) b.add(geo.sphere(0.06, 8, 6), { color: 0x5ab4ff }, T(-0.3 + i * 0.2, 0.15 - (i % 2) * 0.12, 0, 0, 0, 0, 0.8, 1.4, 0.8)); return std(b.build()); };
  m['storm'] = () => { const b = cloud(true); bolt(b, 0xffe24a, T(0.05, 0.15, 0.1, 0, 0, 0, 0.7, 0.7, 0.7)); return std(b.build(), 0x403000, 0.2); };
  m['acidrain'] = () => { const b = cloud(true); for (let i = 0; i < 5; i++) b.add(geo.sphere(0.065, 8, 6), { color: 0xa8f03a }, T(-0.36 + i * 0.18, 0.15 - (i % 2) * 0.14, 0.05, 0, 0, 0, 0.8, 1.5, 0.8)); return std(b.build(), 0x2a4a00, 0.35); };
  m['napalm'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.capsule(0.16, 0.45, 6, 16), { color: vgrad(0x5a5e40, 0x8a8e60, 0, 1) }, T(0, 0.62, 0, 0, 0, 0.6));
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; b.add(geo.box(0.03, 0.14, 0.14), { color: 0x3a3e2a }, new THREE.Matrix4().makeRotationZ(0.6).multiply(T(Math.cos(a) * 0.14, 0.4, Math.sin(a) * 0.14, 0, -a, 0))); }
    flame(b, 0.6, 0.15, 0.1);
    return std(b.build(), 0x602000, 0.25);
  };
  m['forest'] = () => { const g = new THREE.Group(); const a = std(pine(2)[0]); a.position.set(-0.35, 0, -0.2); a.scale.setScalar(0.75); const b = std(oak(5)[0]); b.position.set(0.25, 0, 0.1); b.scale.setScalar(0.75); g.add(a, b); return g; };
  m['bloom'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.cyl(0.03, 0.04, 0.6, 6), { color: 0x4f8f3a }, T(0, 0.3, 0));
    b.add(geo.ico(0.12, 1), { color: 0x5aa34a }, T(0.15, 0.25, 0, 0, 0, 0, 1.6, 0.5, 0.8));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.add(geo.sphere(0.13, 10, 8), { color: 0xf28bb8 }, T(Math.cos(a) * 0.17, 0.72, Math.sin(a) * 0.17 * 0.4 + 0.02, 0, 0, 0, 1, 1, 0.5)); }
    b.add(geo.sphere(0.1, 10, 8), { color: 0xffd65a }, T(0, 0.72, 0.06));
    return std(b.build());
  };
  m['heat'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.sphere(0.36, 20, 14), { color: vgrad(0xff9a20, 0xffe24a, 0.2, 0.9) }, T(0, 0.5, 0));
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; b.add(geo.cone(0.08, 0.2, 6), { color: 0xffb030 }, T(Math.cos(a) * 0.52, 0.5 + Math.sin(a) * 0.52, 0, 0, 0, a - Math.PI / 2)); }
    return std(b.build(), 0x804000, 0.4);
  };
  m['frost'] = () => {
    const b = new ModelBuilder(1);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      b.add(geo.rbox(1.0, 0.09, 0.09, 0.03, 1), { color: 0xbfe8ff }, T(0, 0.5, 0, 0, 0, a));
      for (const s of [-1, 1]) for (const d of [0.28, 0.4]) b.add(geo.rbox(0.18, 0.06, 0.06, 0.02, 1), { color: 0xdff4ff }, new THREE.Matrix4().makeTranslation(0, 0.5, 0).multiply(new THREE.Matrix4().makeRotationZ(a)).multiply(T(s * d, 0.07, 0, 0, 0, s * 0.8)));
    }
    return std(b.build(), 0x103050, 0.3);
  };
  // ---------------- disasters
  m['lightning'] = () => { const b = new ModelBuilder(1); bolt(b, 0xffd53a, T(0, 0.5, 0, 0, 0, 0, 1.4, 1.4, 1.6)); return std(b.build(), 0x605000, 0.3); };
  m['fire'] = () => { const b = new ModelBuilder(1); flame(b, 1); return std(b.build(), 0xff5a10, 0.25); };
  m['bomb'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.sphere(0.42, 22, 16), { color: vgrad(0x1f1d26, 0x4a4658, 0, 0.9) }, T(0, 0.42, 0));
    b.add(geo.cyl(0.13, 0.13, 0.12, 12), { color: 0x6f6a74 }, T(0.15, 0.82, 0, 0, 0, -0.35));
    b.add(geo.cyl(0.025, 0.025, 0.25, 6), { color: 0xc8a060 }, T(0.24, 0.98, 0, 0, 0, -0.6));
    b.add(geo.octa(0.1), { color: 0xffd060, flat: true }, T(0.34, 1.1, 0));
    b.add(geo.sphere(0.08, 8, 6), { color: 0xffffff }, T(-0.15, 0.62, 0.3, 0, 0, 0, 1, 1.3, 0.5));
    return std(b.build());
  };
  m['meteor'] = () => {
    const b = new ModelBuilder(1);
    const tail = new THREE.Matrix4().makeTranslation(-0.05, 0.25, 0).multiply(new THREE.Matrix4().makeRotationZ(-0.75));
    for (const [sc, col, top, push] of [[1.0, 0xe8361a, 0xffa030, 0], [0.7, 0xff9a24, 0xffd050, 0.12], [0.42, 0xffe07a, 0xfff8d8, 0.22]] as const)
      b.add(geo.lathe(TEAR, 16), { color: vgrad(col, top, 0, 1.0 * sc) }, tail.clone().multiply(T(0, 0, push, 0, 0, 0, sc * 0.8, sc * 1.5, sc * 0.8)));
    b.add(geo.ico(0.36, 1), { color: (p, n) => hex(0x4a3a32).lerp(hex(0x8a6a5a), Math.max(0, n.y)), jitter: 0.06, flat: true }, T(-0.08, 0.28, 0.05));
    b.add(geo.ico(0.1, 0), { color: 0xffb040, flat: true }, T(0.05, 0.3, 0.38));
    return std(b.build(), 0x401000, 0.25);
  };
  m['tornado'] = () => {
    const b = new ModelBuilder(1);
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      b.add(geo.torus(0.1 + t * t * 0.42, 0.06 + t * 0.05, 8, 24), { color: i % 2 ? 0xc8ced8 : 0xe8ecf2 }, T(Math.sin(i * 1.3) * 0.05, 0.1 + t * 1.0, 0, Math.PI / 2, 0, 0, 1, 1, 0.8));
    }
    b.add(geo.rbox(0.14, 0.09, 0.09, 0.02, 1), { color: 0x8a5a33 }, T(0.42, 0.7, 0.15, 0.4, 0, 0.6));
    b.add(geo.ico(0.07, 0), { color: 0x6aa84a, flat: true }, T(-0.4, 0.95, 0.1));
    return std(b.build());
  };
  m['quake'] = () => block(0x9a7650, 0x6a4a30, (b) => {
    b.add(geo.extrude([[-0.5, 0.03], [-0.15, 0.08], [0, -0.05], [0.18, 0.06], [0.5, 0.0], [0.5, -0.06], [0.16, -0.0], [0, -0.12], [-0.17, 0.0], [-0.5, -0.04]], 0.02), { color: 0x2a1c12 }, T(0, 0.56, 0, -Math.PI / 2));
    b.add(geo.rbox(0.2, 0.12, 0.16, 0.03, 1), { color: 0x8a7a68 }, T(0.25, 0.7, -0.2, 0.3, 0.4, 0.2));
  });
  m['plague'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.sphere(0.4, 20, 14), { color: vgrad(0x5aa03a, 0x9ad65a, 0, 0.7) }, T(0, 0.4, 0));
    b.add(geo.cyl(0.12, 0.15, 0.25, 12), { color: 0x9ad65a }, T(0, 0.88, 0));
    b.add(geo.cyl(0.16, 0.16, 0.08, 12), { color: 0x8a5a33 }, T(0, 1.03, 0));
    for (let i = 0; i < 3; i++) b.add(geo.sphere(0.07 - i * 0.015, 8, 6), { color: 0xc8f08a }, T(0.12 + i * 0.05, 1.15 + i * 0.12, 0));
    b.add(geo.sphere(0.12, 12, 8), { color: 0xf4efe2 }, T(0, 0.42, 0.33, 0, 0, 0, 1, 1, 0.5));
    return std(b.build());
  };
  m['smite'] = () => { const b = new ModelBuilder(1); bolt(b, 0xff5a5a, T(0.05, 0.6, 0, 0, 0, 0, 1.2, 1.2, 1.4)); b.add(geo.cyl(0.4, 0.45, 0.06, 20), { color: 0x2a2238 }, T(0, 0.02, 0)); return std(b.build(), 0x600000, 0.3); };
  // ---------------- settings
  m['laws'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.cyl(0.04, 0.05, 0.9, 8), { color: 0xd9a830 }, T(0, 0.45, 0));
    b.add(geo.rbox(0.9, 0.06, 0.06, 0.02, 1), { color: 0xd9a830 }, T(0, 0.88, 0));
    for (const s of [-1, 1]) { b.add(geo.cyl(0.2, 0.14, 0.08, 16), { color: 0xffd65a }, T(s * 0.4, 0.55, 0)); b.add(geo.cyl(0.008, 0.008, 0.3, 4), { color: 0x6b4428 }, T(s * 0.4, 0.72, 0)); }
    b.add(geo.cyl(0.25, 0.3, 0.08, 16), { color: 0x6b4428 }, T(0, 0.02, 0));
    return std(b.build());
  };
  m['saveload'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.octa(0.4), { color: vgrad(0x6a4ad8, 0xb8a8ff, 0.1, 1.0), flat: true }, T(0, 0.55, 0, 0, 0.4, 0, 0.75, 1.15, 0.75));
    b.add(geo.cyl(0.32, 0.4, 0.12, 6), { color: 0xd9a830 }, T(0, 0.06, 0));
    return std(b.build(), 0x2a1a60, 0.3);
  };
  m['newworld'] = m['cat-world'];
  // ---------------- machines & weapons
  const machine = (sp: Sp, item: number, ry: number) => () => { const o = creature(models, sp, 0x3a7ae0, 0xffffff, 0xffffff, item); o.rotation.y = ry; return o; };
  m['tank'] = machine(Sp.Tank, 0, -0.7);
  m['cat-military'] = m['tank'];
  m['plane'] = () => { const o = machine(Sp.Plane, 0, -0.6)(); o.rotation.x = 0.35; return o; };
  m['warship'] = machine(Sp.Boat, 21, -0.8);
  m['boat'] = machine(Sp.Boat, 20, -0.8);
  m['cannon'] = () => { const o = std(blds.get(bkey(Bk.Cannon, Sp.Human, 0))!.clone()); colorTeam(o, 0x3a7ae0); o.rotation.y = -0.6; return o; };
  m['nuke'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.capsule(0.22, 0.55, 6, 18), { color: vgrad(0x3a3e46, 0x6a7078, 0, 1) }, T(0, 0.55, 0, 0, 0, 0.5));
    b.add(geo.cone(0.23, 0.28, 18), { color: 0xffd23a }, T(0.31, 1.05, 0, 0, 0, -0.5 + Math.PI * 0));
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; b.add(geo.box(0.04, 0.2, 0.18), { color: 0xffd23a }, new THREE.Matrix4().makeRotationZ(0.5).multiply(T(Math.cos(a) * 0.2, 0.18, Math.sin(a) * 0.2, 0, -a, 0))); }
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.3; b.add(geo.cyl(0.0, 0.13, 0.02, 3, 1), { color: 0x2a2238 }, new THREE.Matrix4().makeRotationZ(0.5).multiply(T(Math.cos(a) * 0.09, 0.6, 0.23, Math.PI / 2, 0, a))); }
    return std(b.build());
  };
  m['enlighten'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.box(0.7, 0.08, 0.5), { color: 0xf3ecd8 }, T(-0.18, 0.3, 0, 0, 0, 0.18));
    b.add(geo.box(0.7, 0.08, 0.5), { color: 0xf3ecd8 }, T(0.18, 0.3, 0, 0, 0, -0.18));
    b.add(geo.box(1.4, 0.05, 0.54), { color: 0x3a6ab8 }, T(0, 0.22, 0));
    b.add(geo.sphere(0.2, 16, 12), { color: 0xffe27a }, T(0, 0.75, 0));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.add(geo.cone(0.05, 0.18, 6), { color: 0xffd23a }, T(Math.cos(a) * 0.34, 0.75 + Math.sin(a) * 0.34, 0, 0, 0, a - Math.PI / 2)); }
    return std(b.build(), 0x604000, 0.25);
  };
  for (const [k, key] of [[Bk.Market, 'market'], [Bk.Library, 'library'], [Bk.Prison, 'prison'], [Bk.Dock, 'dock'], [Bk.Factory, 'factory'], [Bk.Apartment, 'apartment']] as [Bk, string][])
    m['b-' + key] = () => { const o = std(blds.get(bkey(k, Sp.Human, 0))!.clone()); colorTeam(o, 0x3a7ae0); o.rotation.y = 0.5; return o; };
  m['b-cannon'] = m['cannon'];
  m['audio'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.cone(0.38, 0.55, 20, ), { color: 0xffd65a }, T(0.05, 0.5, 0, 0, 0, Math.PI / 2));
    b.add(geo.rbox(0.22, 0.32, 0.3, 0.05, 1), { color: 0xd9a830 }, T(-0.32, 0.5, 0));
    for (let i = 0; i < 2; i++) b.add(geo.torus(0.25 + i * 0.17, 0.035, 6, 16, Math.PI * 0.6), { color: 0x2a2238 }, T(0.3, 0.5, 0, 0, 0, -Math.PI * 0.3));
    return std(b.build());
  };
  m['speed'] = () => {
    const b = new ModelBuilder(1);
    b.add(geo.lathe([[0.02, 0], [0.3, 0.02], [0.28, 0.2], [0.05, 0.42], [0.28, 0.64], [0.3, 0.84], [0.02, 0.86]], 18), { color: 0xcfeeff }, T(0, 0.05, 0));
    b.add(geo.cone(0.22, 0.2, 18), { color: 0xf2dca0 }, T(0, 0.17, 0));
    for (const y of [0, 0.92]) b.add(geo.cyl(0.36, 0.36, 0.08, 18), { color: 0x8a5a33 }, T(0, y + 0.02, 0));
    return std(b.build());
  };
  return m;
}

function colorTeam(o: THREE.Object3D, team: number) {
  o.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const col = g.attributes.color as THREE.BufferAttribute, slot = g.attributes.aSlot as THREE.BufferAttribute;
    if (!col || !slot) return;
    const tc = hex(team), lc = hex(team).lerp(new THREE.Color(1, 1, 1), 0.55);
    for (let i = 0; i < col.count; i++) {
      const s = Math.round(slot.getX(i));
      if (s === 1) col.setXYZ(i, col.getX(i) * tc.r, col.getY(i) * tc.g, col.getZ(i) * tc.b);
      if (s === 5) col.setXYZ(i, col.getX(i) * lc.r, col.getY(i) * lc.g, col.getZ(i) * lc.b);
    }
  });
}

export interface IconSet { url: Record<string, string>; }

/** Render all icons. Uses its own small GL context so it can run during boot. */
export async function forgeIcons(onProgress?: (k: number) => void): Promise<Record<string, string>> {
  const makers = makeIcons();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  r.setSize(SIZE, SIZE, false);
  r.toneMapping = THREE.NeutralToneMapping;
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6a5a7a, 1.6));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.4); key.position.set(-2, 3, 2.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd8ff, 1.4); rim.position.set(2.5, 1.5, -1.5); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
  const out: Record<string, string> = {};
  const ids = Object.keys(makers);
  const box = new THREE.Box3(), sph = new THREE.Sphere();
  const pad = 22;
  const comp = document.createElement('canvas'); comp.width = comp.height = SIZE;
  const cg = comp.getContext('2d')!;
  const sil = document.createElement('canvas'); sil.width = sil.height = SIZE;
  const sg = sil.getContext('2d')!;
  const final = document.createElement('canvas'); final.width = final.height = 128;
  const fg = final.getContext('2d')!;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const obj = makers[id]();
    const holder = new THREE.Group(); holder.add(obj);
    scene.add(holder);
    box.setFromObject(holder); box.getBoundingSphere(sph);
    const fr = obj.userData.frame as { y: number; r: number } | undefined;
    if (fr) { sph.center.set(0, fr.y, 0); sph.radius = fr.r; }
    const dir = new THREE.Vector3(0.55, 0.55, 1).normalize();
    const dist = sph.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.02;
    cam.position.copy(sph.center).addScaledVector(dir, dist);
    cam.lookAt(sph.center);
    r.render(scene, cam);
    scene.remove(holder);
    holder.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
    // ink silhouette
    sg.clearRect(0, 0, SIZE, SIZE);
    sg.globalCompositeOperation = 'source-over';
    sg.drawImage(canvas, pad / 2, pad / 2, SIZE - pad, SIZE - pad);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = INK; sg.fillRect(0, 0, SIZE, SIZE);
    cg.clearRect(0, 0, SIZE, SIZE);
    // soft drop shadow
    cg.globalAlpha = 0.28;
    cg.drawImage(sil, 0, 9);
    cg.globalAlpha = 1;
    const R = 6;
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; cg.drawImage(sil, Math.cos(a) * R, Math.sin(a) * R); }
    cg.drawImage(canvas, pad / 2, pad / 2, SIZE - pad, SIZE - pad);
    fg.clearRect(0, 0, 128, 128);
    fg.imageSmoothingQuality = 'high';
    fg.drawImage(comp, 0, 0, 128, 128);
    out[id] = final.toDataURL('image/png');
    onProgress?.((i + 1) / ids.length);
    if (i % 6 === 5) await new Promise((res) => setTimeout(res, 0));
  }
  r.dispose();
  r.forceContextLoss();
  return out;
}
