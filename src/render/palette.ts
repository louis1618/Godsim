import * as THREE from 'three';
import { MAT_COUNT } from '../sim/defs';

/** Hand-tuned stylised surface colours [light, dark] per material, in sRGB hex. */
const MAT_COLORS: [number, number][] = [
  [0xf2dca0, 0xd9bf7e], // sand
  [0x8fd052, 0x67b03c], // grass
  [0x4f9a3a, 0x3a7d2e], // lush
  [0xbfc35e, 0xa3a447], // savanna
  [0xf0c27b, 0xd9a35c], // desert
  [0xf4f7fb, 0xd6e1ee], // snow
  [0x9a948c, 0x726c66], // rock
  [0x9b7650, 0x7d5b3b], // soil
  [0x4a4442, 0x2f2b2a], // ash
  [0x6c8a45, 0x4d6a34], // swamp
  [0xff6a1c, 0xb8260b], // lava
  [0xb0864e, 0x8f6a3a], // farmland
];

export function matPaletteUniform(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < MAT_COUNT; i++) {
    c.setHex(MAT_COLORS[i][0], THREE.SRGBColorSpace); out.push(new THREE.Vector3(c.r, c.g, c.b));
  }
  for (let i = 0; i < MAT_COUNT; i++) {
    c.setHex(MAT_COLORS[i][1], THREE.SRGBColorSpace); out.push(new THREE.Vector3(c.r, c.g, c.b));
  }
  return out;
}

export function hexToLinear(hex: number) { return new THREE.Color().setHex(hex, THREE.SRGBColorSpace); }
