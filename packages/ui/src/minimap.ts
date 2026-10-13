import type { MinimapData } from './types.js';

const OWN = [102, 187, 106];
const ENEMY = [239, 83, 80];
const PASS = [74, 80, 86];
const WALL = [30, 33, 36];
const FOG = 0.45;

/** Tekent de minimap in `canvas`: passability, fog, claims en blips. Doet niets zonder 2D-context (bijvoorbeeld in tests). */
export function drawMinimap(canvas: HTMLCanvasElement, m: MinimapData, me: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || m.w <= 0 || m.h <= 0) return;
  const doc = canvas.ownerDocument;
  const base = doc.createElement('canvas');
  base.width = m.w;
  base.height = m.h;
  const bctx = base.getContext('2d');
  if (!bctx) return;
  const img = bctx.createImageData(m.w, m.h);
  const d = img.data;
  for (let i = 0, n = m.w * m.h; i < n; i++) {
    const c = m.passable[i] ? PASS : WALL;
    const k = m.visible && !m.visible[i] ? FOG : 1;
    const o = i * 4;
    d[o] = c[0]! * k;
    d[o + 1] = c[1]! * k;
    d[o + 2] = c[2]! * k;
    d[o + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

  const cell = m.cellU ?? 256;
  const sx = canvas.width / (m.w * cell);
  const sy = canvas.height / (m.h * cell);
  const seen = (x: number, y: number): boolean => {
    if (!m.visible) return true;
    const cx = Math.min(m.w - 1, Math.max(0, Math.floor(x / cell)));
    const cy = Math.min(m.h - 1, Math.max(0, Math.floor(y / cell)));
    return m.visible[cy * m.w + cx] === 1;
  };
  for (const c of m.claims) {
    ctx.strokeStyle = c.owner === null ? '#ffd54f' : c.owner === me ? rgb(OWN) : rgb(ENEMY);
    ctx.lineWidth = 2;
    ctx.strokeRect(c.x * sx - 3, c.y * sy - 3, 6, 6);
  }
  for (const b of m.blips) {
    if (b.owner !== me && b.kind !== 'node' && !seen(b.x, b.y)) continue;
    ctx.fillStyle = b.kind === 'node' ? '#ffd54f' : b.owner === me ? rgb(OWN) : rgb(ENEMY);
    const size = b.kind === 'building' ? 4 : b.kind === 'hero' ? 5 : 2;
    ctx.fillRect(b.x * sx - size / 2, b.y * sy - size / 2, size, size);
  }
}

const rgb = (c: number[]): string => `rgb(${c[0]},${c[1]},${c[2]})`;
