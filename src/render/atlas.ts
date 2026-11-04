import * as THREE from 'three';

/** Procedurally painted textures for particles and emote bubbles (no external assets). */
const CELL = 128;

export const enum PF { Dot = 0, Smoke = 1, Flame = 2, Spark = 3, Heart = 4, Leaf = 5, Chip = 6, Ring = 7, Drop = 8, Soul = 9 }
export const PARTICLE_CELLS = 10;

export function makeParticleAtlas(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = CELL * PARTICLE_CELLS; cv.height = CELL;
  const g = cv.getContext('2d')!;
  const cx = (i: number) => i * CELL + CELL / 2, cy = CELL / 2;
  // dot
  let grd = g.createRadialGradient(cx(0), cy, 0, cx(0), cy, 60);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, CELL, CELL);
  // smoke: cluster of soft blobs
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2, r = k === 0 ? 0 : 22;
    const x = cx(1) + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    grd = g.createRadialGradient(x, y, 0, x, y, 34);
    grd.addColorStop(0, 'rgba(255,255,255,0.75)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, 34, 0, Math.PI * 2); g.fill();
  }
  // flame: teardrop
  g.save(); g.translate(cx(2), cy + 18);
  grd = g.createRadialGradient(0, 0, 0, 0, -10, 60);
  grd.addColorStop(0, 'rgba(255,255,230,1)'); grd.addColorStop(0.35, 'rgba(255,220,120,0.95)'); grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd; g.beginPath(); g.moveTo(0, -62); g.bezierCurveTo(30, -20, 40, 20, 0, 40); g.bezierCurveTo(-40, 20, -30, -20, 0, -62); g.fill(); g.restore();
  // spark: 4-point star
  g.save(); g.translate(cx(3), cy); g.fillStyle = '#fff';
  g.beginPath();
  for (let k = 0; k < 8; k++) { const r = k % 2 ? 9 : 58; const a = (k / 8) * Math.PI * 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  g.closePath(); g.fill(); g.restore();
  // heart
  g.save(); g.translate(cx(4), cy + 6); g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(0, 38); g.bezierCurveTo(-60, -5, -30, -55, 0, -22); g.bezierCurveTo(30, -55, 60, -5, 0, 38); g.fill(); g.restore();
  // leaf
  g.save(); g.translate(cx(5), cy); g.rotate(0.6); g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(0, -50); g.quadraticCurveTo(34, 0, 0, 50); g.quadraticCurveTo(-34, 0, 0, -50); g.fill(); g.restore();
  // chip
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(cx(6) - 30, cy - 20); g.lineTo(cx(6) + 34, cy - 30); g.lineTo(cx(6) + 24, cy + 30); g.lineTo(cx(6) - 36, cy + 22); g.closePath(); g.fill();
  // ring
  g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(cx(7), cy, 50, 0, Math.PI * 2); g.stroke();
  // drop (rain streak)
  grd = g.createLinearGradient(cx(8), cy - 60, cx(8), cy + 60);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grd; g.fillRect(cx(8) - 4, cy - 60, 8, 120);
  // soul: little ghost
  g.save(); g.translate(cx(9), cy);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath(); g.arc(0, -10, 34, Math.PI, 0); g.lineTo(34, 40);
  for (let k = 0; k < 4; k++) g.quadraticCurveTo(34 - k * 17 - 8, 28, 34 - (k + 1) * 17, 40);
  g.closePath(); g.fill();
  g.fillStyle = '#2a2238'; g.beginPath(); g.ellipse(-12, -12, 6, 9, 0, 0, Math.PI * 2); g.ellipse(12, -12, 6, 9, 0, 0, Math.PI * 2); g.fill();
  g.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const enum EM { Heart = 1, Angry = 2, Alert = 3, Sad = 4, Zzz = 5, Music = 6, Skull = 7, Crown = 8, Sick = 9, Star = 10, Food = 11, Swords = 12 }
export const EMOTE_CELLS = 13;

/** Speech-bubble emotes drawn with chunky ink outlines to match the UI style. */
export function makeEmoteAtlas(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = CELL * EMOTE_CELLS; cv.height = CELL;
  const g = cv.getContext('2d')!;
  const INK = '#2a2238';
  for (let i = 1; i < EMOTE_CELLS; i++) {
    const ox = i * CELL;
    g.save(); g.translate(ox + CELL / 2, CELL / 2 - 6);
    // bubble
    g.fillStyle = '#fffaf0'; g.strokeStyle = INK; g.lineWidth = 7;
    g.beginPath(); g.arc(0, 0, 46, 0, Math.PI * 2); g.moveTo(-12, 42); g.lineTo(0, 62); g.lineTo(10, 42);
    g.fill(); g.stroke();
    g.fillStyle = '#fffaf0'; g.beginPath(); g.arc(0, 0, 42, 0, Math.PI * 2); g.fill();
    g.lineJoin = 'round'; g.lineCap = 'round';
    const fillStroke = (fill: string) => { g.fillStyle = fill; g.fill(); g.lineWidth = 5; g.strokeStyle = INK; g.stroke(); };
    switch (i) {
      case EM.Heart: g.beginPath(); g.moveTo(0, 26); g.bezierCurveTo(-42, -2, -22, -38, 0, -14); g.bezierCurveTo(22, -38, 42, -2, 0, 26); fillStroke('#ff5a7a'); break;
      case EM.Angry: {
        g.strokeStyle = '#e8333f'; g.lineWidth = 9;
        for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { g.beginPath(); g.moveTo(sx * 6, sy * 24); g.quadraticCurveTo(sx * 8, sy * 8, sx * 24, sy * 6); g.stroke(); }
        break;
      }
      case EM.Alert: g.fillStyle = '#ffb020'; g.strokeStyle = INK; g.lineWidth = 5; g.beginPath(); g.roundRect(-8, -30, 16, 38, 6); g.fill(); g.stroke(); g.beginPath(); g.arc(0, 22, 8, 0, Math.PI * 2); g.fill(); g.stroke(); break;
      case EM.Sad: g.beginPath(); g.moveTo(0, -28); g.bezierCurveTo(20, 0, 22, 26, 0, 26); g.bezierCurveTo(-22, 26, -20, 0, 0, -28); fillStroke('#5ab4ff'); break;
      case EM.Zzz: g.fillStyle = INK; g.font = 'bold 38px sans-serif'; g.textAlign = 'center'; g.fillText('z', -10, 18); g.font = 'bold 28px sans-serif'; g.fillText('z', 14, -4); break;
      case EM.Music: g.fillStyle = INK; g.beginPath(); g.ellipse(-12, 18, 12, 9, -0.4, 0, Math.PI * 2); g.ellipse(18, 10, 12, 9, -0.4, 0, Math.PI * 2); g.fill(); g.fillRect(-2, -26, 6, 44); g.fillRect(28, -32, 6, 44); g.beginPath(); g.moveTo(-2, -26); g.lineTo(34, -32); g.lineTo(34, -20); g.lineTo(-2, -14); g.fill(); break;
      case EM.Skull: g.beginPath(); g.arc(0, -4, 24, Math.PI * 0.85, Math.PI * 0.15); g.lineTo(14, 26); g.lineTo(-14, 26); g.closePath(); fillStroke('#f4efe2'); g.fillStyle = INK; g.beginPath(); g.arc(-9, -2, 7, 0, Math.PI * 2); g.arc(9, -2, 7, 0, Math.PI * 2); g.fill(); break;
      case EM.Crown: g.beginPath(); g.moveTo(-28, 18); g.lineTo(-30, -18); g.lineTo(-14, -2); g.lineTo(0, -26); g.lineTo(14, -2); g.lineTo(30, -18); g.lineTo(28, 18); g.closePath(); fillStroke('#ffcf3a'); break;
      case EM.Sick: g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); fillStroke('#8fd14f'); g.fillStyle = INK; g.fillRect(-14, -8, 8, 4); g.fillRect(6, -8, 8, 4); g.beginPath(); g.arc(0, 14, 8, Math.PI, 0); g.fill(); break;
      case EM.Star: g.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 13 : 30; const a = (k / 10) * Math.PI * 2 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); fillStroke('#ffd53a'); break;
      case EM.Food: g.beginPath(); g.arc(0, 4, 24, 0, Math.PI * 2); fillStroke('#ff6a4a'); g.fillStyle = '#5aa34a'; g.beginPath(); g.ellipse(8, -22, 10, 5, -0.5, 0, Math.PI * 2); g.fill(); break;
      case EM.Swords: {
        for (const s of [-1, 1]) {
          g.save(); g.rotate(s * Math.PI / 4);
          g.fillStyle = '#dfe6ee'; g.strokeStyle = INK; g.lineWidth = 4; g.beginPath(); g.roundRect(-4, -32, 8, 46, 3); g.fill(); g.stroke();
          g.fillStyle = '#c8a23c'; g.beginPath(); g.roundRect(-12, 12, 24, 6, 3); g.fill(); g.stroke();
          g.restore();
        }
        break;
      }
    }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
