/**
 * Camera behaviour under zoom / rotate / pan (pure math, no GPU):
 *  1. zooming all the way out and back in never turns the view (no hidden heading springs back)
 *  2. the world point under the cursor stays under the cursor while zooming
 *  3. no frame-to-frame jump in heading (no lookAt flip when looking straight down)
 *  4. "forward" (W) always moves the view toward the top of the screen, at every zoom level
 * Usage: npx tsx tools/cameratest.ts
 */
import * as THREE from 'three';
import { CameraRig } from '../src/render/cameraRig';

let fails = 0;
const check = (name: string, ok: boolean, info: string) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${info}`); if (!ok) fails++; };
const rig = new CameraRig(16 / 9);
rig.setMap(256, 256);
rig.ground = (x, z) => 2 + Math.sin(x * 0.1) * 1.5 + Math.cos(z * 0.13);
const dt = 1 / 60;
const heading = () => { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion); const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.camera.quaternion); const v = Math.abs(f.y) > 0.98 ? up : f; return Math.atan2(-v.x, -v.z); };
const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };
const settle = (n = 90) => { for (let i = 0; i < n; i++) rig.update(dt); };
// start close, rotated ~160 degrees
rig.focus.set(128, 0, 128); rig.tFocus.copy(rig.focus); rig.V = rig.tV = 12;
rig.tYaw = 2.8; settle(240);
const h0 = heading();
let maxJump = 0, last = h0;
const ndc = new THREE.Vector2(0.35, -0.25);
const worldUnder = () => rig.pick(ndc.x, ndc.y)!.clone();
let maxDrift = 0;
const zoomSeq = (factor: number, n: number) => {
  for (let i = 0; i < n; i++) {
    const before = worldUnder();
    rig.zoomAt(ndc.x, ndc.y, factor);
    for (let k = 0; k < 6; k++) { rig.update(dt); const h = heading(); maxJump = Math.max(maxJump, angDiff(h, last)); last = h; }
    const after = rig.pick(ndc.x, ndc.y);
    if (after) maxDrift = Math.max(maxDrift, Math.hypot(after.x - before.x, after.z - before.z) / rig.V);
  }
  settle(120);
};
zoomSeq(1.25, 40); // out to the map
const hMap = heading();
zoomSeq(0.8, 40);  // back in
const h1 = heading();
check('zoom out + in keeps the heading', angDiff(h1, h0) < 0.02 && angDiff(hMap, h0) < 0.02, `heading close ${(h0 * 57.3).toFixed(1)} deg, at map zoom ${(hMap * 57.3).toFixed(1)} deg, back in ${(h1 * 57.3).toFixed(1)} deg`);
check('no sudden heading jump between frames', maxJump < 0.05, `largest per-frame heading change ${(maxJump * 57.3).toFixed(2)} deg`);
check('cursor anchor holds while zooming', maxDrift < 0.03, `worst drift of the point under the cursor ${(maxDrift * 100).toFixed(2)}% of the view height`);
// forward key moves toward screen-up at several zoom levels and headings
let worst = 0;
for (const z of [0.05, 0.4, 0.7, 0.95]) for (const yaw of [0, 1.2, 2.8, -2.2]) {
  rig.V = rig.tV = rig.vFromZoom(z); rig.tYaw = yaw; settle(200);
  const f0 = rig.focus.clone();
  for (let i = 0; i < 30; i++) { rig.panBy(0, -rig.V * 0.01); rig.update(dt); }
  settle(60);
  const mv = rig.focus.clone().sub(f0); mv.y = 0;
  // project motion into screen space: screen-up vector on the ground plane
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.camera.quaternion);
  const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion);
  const sUp = (Math.abs(fw.y) > 0.98 ? up : fw).setY(0).normalize();
  const along = mv.dot(sUp) / mv.length();
  worst = Math.max(worst, Math.acos(Math.min(1, along)));
}
check('forward pans toward the top of the screen at every zoom and heading', worst < 0.05, `worst angle between key direction and screen-up ${(worst * 57.3).toFixed(2)} deg`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
