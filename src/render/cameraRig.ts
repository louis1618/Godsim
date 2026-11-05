import * as THREE from 'three';
import { clamp, clamp01, damp, dampAngle, lerp, smoothstep } from '../core/math';

/**
 * The signature camera: one continuous rig from a straight-down living map to a low,
 * tilted, free-roaming 3D view. Everything (pitch, FOV, terrain pop-up, map styling,
 * territory overlay, cloud layer) is a function of a single zoom parameter z01.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  focus = new THREE.Vector3();
  tFocus = new THREE.Vector3();
  V = 60; tV = 60;               // vertical extent of the view at the focus distance
  yaw = 0; tYaw = 0;
  tilt = 0; tTilt = 0;           // user pitch offset (degrees) in near view
  vMin = 5.5;
  vMax = 220;
  mapW = 192; mapH = 192;
  /** damping rate; lowered temporarily for cinematic fly-tos */
  rate = 9;
  private flyRate = 0;
  follow: (() => THREE.Vector3 | null) | null = null;
  ground: (x: number, z: number) => number = () => 0;
  private anchor: { ndc: THREE.Vector2; world: THREE.Vector3 } | null = null;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmp = new THREE.Vector3();
  private euler = new THREE.Euler();
  vel = new THREE.Vector2();
  // derived
  z01 = 1;
  pitch = 90;
  heightScale = 0.3;
  mapMode = 1;
  territory = 1;
  shake = 0;
  /** title-screen orbit blend (0 = normal rig, 1 = slow cinematic orbit around the diorama) */
  orbit = 0; tOrbit = 0; spin = 0.6;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 4000);
  }

  setMap(W: number, H: number) {
    this.mapW = W; this.mapH = H;
    this.vMax = Math.max(W, H) * 1.18;
    this.focus.set(W / 2, 0, H / 2); this.tFocus.copy(this.focus);
    this.V = this.tV = this.vMax;
  }

  zoomFrom(V: number) { return clamp01(Math.log(V / this.vMin) / Math.log(this.vMax / this.vMin)); }
  vFromZoom(z: number) { return this.vMin * Math.pow(this.vMax / this.vMin, clamp01(z)); }

  /**
   * Zoom by factor keeping the world point under the cursor fixed. A cursor near (or above) the
   * horizon of a tilted view would anchor on a point far away and fling the view: those zooms
   * centre on the screen middle instead.
   */
  zoomAt(ndcX: number, ndcY: number, factor: number) {
    this.tV = clamp(this.tV * factor, this.vMin, this.vMax);
    const hit = this.pick(ndcX, ndcY);
    const ok = hit && Math.hypot(hit.x - this.focus.x, hit.z - this.focus.z) < this.V * 2.2;
    // keep the anchor of an ongoing zoom gesture (re-anchoring every wheel tick drifts)
    if (ok && (!this.anchor || this.anchor.ndc.distanceTo(new THREE.Vector2(ndcX, ndcY)) > 0.02)) this.anchor = { ndc: new THREE.Vector2(ndcX, ndcY), world: hit!.clone() };
    else if (!ok) this.anchor = null;
    this.flyRate = 0;
  }

  /** The heading the camera actually looks along (title orbit included). */
  viewYaw = 0;
  /** Turn back to north-up. */
  resetYaw() { this.tYaw = Math.round(this.yaw / (Math.PI * 2)) * Math.PI * 2; }

  /** Ray-cast the screen point against the horizontal plane through the focus. */
  pick(ndcX: number, ndcY: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    this.plane.constant = -this.focus.y;
    return this.ray.ray.intersectPlane(this.plane, out);
  }

  dragStart: THREE.Vector3 | null = null;
  beginDrag(ndcX: number, ndcY: number) {
    this.dragStart = this.pick(ndcX, ndcY);
    this.anchor = null; this.follow = null; this.flyRate = 0;
    this.vel.set(0, 0);
  }
  drag(ndcX: number, ndcY: number, dt: number) {
    if (!this.dragStart) return;
    const p = this.pick(ndcX, ndcY, this.tmp);
    if (!p) return;
    let dx = this.dragStart.x - p.x, dz = this.dragStart.z - p.z;
    // grazing rays near the horizon turn a pixel of mouse travel into miles: cap one step
    const lim = this.V * 0.6, m = Math.hypot(dx, dz);
    if (m > lim) { dx *= lim / m; dz *= lim / m; }
    this.focus.x += dx; this.focus.z += dz;
    this.tFocus.x = this.focus.x; this.tFocus.z = this.focus.z;
    if (dt > 0) this.vel.set(dx / dt, dz / dt).multiplyScalar(0.5).add(this.vel.clone().multiplyScalar(0.5));
    this.clampFocus();
    this.apply();
  }
  endDrag() {
    this.dragStart = null;
    if (this.vel.length() > this.V * 4) this.vel.setLength(this.V * 4);
  }

  panBy(dx: number, dz: number) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    this.tFocus.x += dx * c + dz * s;
    this.tFocus.z += -dx * s + dz * c;
    this.follow = null; this.flyRate = 0; this.anchor = null;
  }

  flyTo(x: number, z: number, V?: number, rate = 2.6) {
    this.tFocus.x = x; this.tFocus.z = z;
    if (V !== undefined) this.tV = clamp(V, this.vMin, this.vMax);
    this.anchor = null;
    this.flyRate = rate;
  }

  private clampFocus() {
    const m = 4;
    this.focus.x = clamp(this.focus.x, -m, this.mapW + m);
    this.focus.z = clamp(this.focus.z, -m, this.mapH + m);
    this.tFocus.x = clamp(this.tFocus.x, -m, this.mapW + m);
    this.tFocus.z = clamp(this.tFocus.z, -m, this.mapH + m);
  }

  update(dt: number) {
    this.orbit = damp(this.orbit, this.tOrbit, 1.4, dt);
    if (Math.abs(this.orbit - this.tOrbit) < 0.001) this.orbit = this.tOrbit;
    this.spin += dt * 0.045 * this.orbit;
    const rate = this.flyRate > 0 ? this.flyRate : this.rate;
    if (this.follow) {
      const p = this.follow();
      if (p) { this.tFocus.x = p.x; this.tFocus.z = p.z; } else this.follow = null;
    }
    // inertia
    if (!this.dragStart && this.vel.lengthSq() > 1e-4) {
      this.tFocus.x += this.vel.x * dt; this.tFocus.z += this.vel.y * dt;
      this.focus.x += this.vel.x * dt; this.focus.z += this.vel.y * dt;
      this.vel.multiplyScalar(Math.exp(-dt * 5));
    }
    this.clampFocus();
    this.V = Math.exp(damp(Math.log(this.V), Math.log(this.tV), rate * 0.9, dt));
    if (Math.abs(this.V - this.tV) < this.tV * 0.002) this.V = this.tV;
    this.focus.x = damp(this.focus.x, this.tFocus.x, rate, dt);
    this.focus.z = damp(this.focus.z, this.tFocus.z, rate, dt);
    // keep both angles in one turn of each other so damping never takes the long way round
    while (this.tYaw - this.yaw > Math.PI) this.tYaw -= Math.PI * 2;
    while (this.tYaw - this.yaw < -Math.PI) this.tYaw += Math.PI * 2;
    this.yaw = dampAngle(this.yaw, this.tYaw, 10, dt);
    this.tilt = damp(this.tilt, this.tTilt, 10, dt);
    if (this.flyRate > 0 && Math.abs(this.V - this.tV) < this.tV * 0.01 && this.focus.distanceTo(this.tFocus) < 0.5) this.flyRate = 0;
    this.apply();
    // keep the cursor-anchored world point fixed while zoom animates
    if (this.anchor) {
      const hit = this.pick(this.anchor.ndc.x, this.anchor.ndc.y, this.tmp);
      if (hit) {
        const dx = this.anchor.world.x - hit.x, dz = this.anchor.world.z - hit.z;
        this.focus.x += dx; this.focus.z += dz;
        this.tFocus.x += dx; this.tFocus.z += dz;
        this.clampFocus();
        this.apply();
      }
      if (this.V === this.tV) this.anchor = null;
    }
    if (this.shake > 0) {
      const s = this.shake * this.V * 0.012;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
  }

  /** Derive the full camera state from (focus, V, yaw, tilt). */
  apply() {
    const z = this.zoomFrom(this.V);
    this.z01 = z;
    this.heightScale = lerp(1, 0.3, smoothstep(0.32, 0.9, z));
    this.mapMode = smoothstep(0.66, 0.93, z);
    this.territory = lerp(0.06, 1, smoothstep(0.42, 0.88, z));
    const nearPitch = clamp(24 + this.tilt, 8, 70);
    const tp = smoothstep(0.0, 0.86, z);
    this.pitch = lerp(nearPitch, 90, tp * tp * (2 - tp));
    let fov = lerp(52, 30, smoothstep(0.15, 0.9, z));
    const cam = this.camera;
    // The heading is never hidden: the map view keeps the user's rotation, so zooming out and back
    // in can not spring a forgotten turn on them, and WASD / drag / audio always match the screen.
    let yaw = this.yaw;
    let V = this.V;
    const ob = this.orbit;
    if (ob > 0) {
      const e = ob * ob * (3 - 2 * ob);
      this.pitch = lerp(this.pitch, 36, e);
      yaw = lerp(yaw, this.spin, e);
      fov = lerp(fov, 30, e);
      V = lerp(V, Math.max(this.mapW, this.mapH) * 0.95, e);
      this.heightScale = lerp(this.heightScale, 1, e);
      this.mapMode = lerp(this.mapMode, 0, e);
      this.territory = lerp(this.territory, 0.2, e);
      this.focus.x = lerp(this.focus.x, this.mapW / 2, e * 0.08);
      this.focus.z = lerp(this.focus.z, this.mapH / 2, e * 0.08);
    }
    cam.fov = fov;
    const dist = V / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    // focus height follows the ground smoothly
    const gy = Math.max(this.ground(this.focus.x, this.focus.z), 0) * this.heightScale;
    this.focus.y = Math.abs(this.focus.y - gy) > 50 ? gy : this.focus.y + (gy - this.focus.y) * 0.15;
    const pr = THREE.MathUtils.degToRad(this.pitch);
    const ox = Math.sin(yaw) * Math.cos(pr) * dist;
    const oz = Math.cos(yaw) * Math.cos(pr) * dist;
    const oy = Math.sin(pr) * dist;
    cam.position.set(this.focus.x + ox, this.focus.y + oy, this.focus.z + oz);
    // never clip into hills
    const under = Math.max(this.ground(cam.position.x, cam.position.z), 0) * this.heightScale + 0.9;
    if (cam.position.y < under) cam.position.y = under;
    // orientation straight from (yaw, pitch): no lookAt, so no flip when the view is top-down
    this.euler.set(-pr, yaw, 0, 'YXZ');
    cam.quaternion.setFromEuler(this.euler);
    this.viewYaw = yaw;
    cam.near = Math.max(0.05, dist * 0.02);
    cam.far = Math.max(600, dist * 8);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
}
