import { CameraRig } from './render/cameraRig';

/** Mouse + keyboard camera control. */
export class Input {
  keys = new Set<string>();
  private dragging = 0; // 0 none, 1 pan, 2 rotate
  private last = { x: 0, y: 0, t: 0 };
  constructor(private el: HTMLElement, private rig: CameraRig) {
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { x, y } = this.ndc(e);
      const f = Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
      rig.zoomAt(x, y, f);
    }, { passive: false });
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      if (e.button === 0 || e.button === 1) { this.dragging = 1; const { x, y } = this.ndc(e); rig.beginDrag(x, y); }
      else if (e.button === 2) this.dragging = 2;
      this.last = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (this.dragging === 1) { const { x, y } = this.ndc(e); rig.drag(x, y, (now - this.last.t) / 1000); }
      else if (this.dragging === 2) {
        rig.tYaw -= (e.clientX - this.last.x) * 0.006;
        rig.tTilt = Math.max(-14, Math.min(40, rig.tTilt + (e.clientY - this.last.y) * 0.15));
      }
      this.last = { x: e.clientX, y: e.clientY, t: now };
    });
    el.addEventListener('pointerup', () => { if (this.dragging === 1) rig.endDrag(); this.dragging = 0; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    const tick = () => { this.update(1 / 60); requestAnimationFrame(tick); };
    tick();
  }
  ndc(e: { clientX: number; clientY: number }) {
    const r = this.el.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
  }
  update(dt: number) {
    const k = this.keys, rig = this.rig;
    const sp = rig.V * 1.1 * dt;
    let dx = 0, dz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) dz -= sp;
    if (k.has('KeyS') || k.has('ArrowDown')) dz += sp;
    if (k.has('KeyA') || k.has('ArrowLeft')) dx -= sp;
    if (k.has('KeyD') || k.has('ArrowRight')) dx += sp;
    if (dx || dz) rig.panBy(dx, dz);
    if (k.has('KeyQ')) rig.tYaw += dt * 1.6;
    if (k.has('KeyE')) rig.tYaw -= dt * 1.6;
  }
}
