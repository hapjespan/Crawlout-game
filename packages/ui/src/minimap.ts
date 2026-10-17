import type { MinimapData, MinimapFog } from './types.js';

const OWN = [102, 187, 106];
const ENEMY = [239, 83, 80];
const PASS = [74, 80, 86];
const WALL = [30, 33, 36];
const FOG = 0.45;
/** Fog of war overlay (RGBA): unexplored near-black, explored dim, visible clear. */
const FOG_UNEXPLORED = [5, 7, 10, 236] as const;
const FOG_EXPLORED = [8, 11, 16, 120] as const;
/** A ghost building (seen before, out of sight now) is the enemy color at this opacity. */
const GHOST_ALPHA = 0.45;

const WATER = [38, 110, 200];
const SHALLOW = [128, 196, 238];
const FOREST = [46, 112, 58];
const CLIFF = [78, 78, 84];

/** Kleur van een cel in de statische laag: water, dan terrein, dan passability. Zonder water of terrein: passable of muur. */
export function minimapCellColor(m: MinimapData, i: number): readonly number[] {
  const wt = m.water?.[i];
  if (wt === 1) return WATER;
  if (wt === 2) return SHALLOW;
  const tr = m.terrain?.[i];
  if (tr === 1) return FOREST;
  if (tr === 2) return CLIFF;
  return m.passable[i] ? PASS : WALL;
}

/** RGBA-pixels van de statische laag (passability, water, terrein; zonder fog). */
export function buildStaticPixels(m: MinimapData): Uint8ClampedArray {
  const n = m.w * m.h;
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const c = minimapCellColor(m, i);
    const o = i * 4;
    d[o] = c[0]!;
    d[o + 1] = c[1]!;
    d[o + 2] = c[2]!;
    d[o + 3] = 255;
  }
  return d;
}

/** Fog als zwarte overlay: alpha 1 - FOG op onzichtbare cellen. */
export function buildFogPixels(m: MinimapData, visible: Uint8Array): Uint8ClampedArray {
  const n = m.w * m.h;
  const d = new Uint8ClampedArray(n * 4);
  const a = Math.round((1 - FOG) * 255);
  for (let i = 0; i < n; i++) if (!visible[i]) d[i * 4 + 3] = a;
  return d;
}

/**
 * Fog of war as an overlay on the fog grid (fog.w x fog.h pixels, drawn smoothed over the whole minimap so the edges are
 * soft): clear where visible now, dim where only explored, near-black where unexplored.
 */
export function buildFogLayerPixels(fog: MinimapFog): Uint8ClampedArray {
  const n = fog.w * fog.h;
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    if (fog.visible[i]) continue;
    const c = fog.explored[i] ? FOG_EXPLORED : FOG_UNEXPLORED;
    d[i * 4] = c[0];
    d[i * 4 + 1] = c[1];
    d[i * 4 + 2] = c[2];
    d[i * 4 + 3] = c[3];
  }
  return d;
}

interface Layer {
  /** Sleutel: de arrays waarop de pixels gebaseerd zijn (referentie-identiteit). */
  key: readonly unknown[];
  canvas: HTMLCanvasElement;
}
interface Cache {
  base: Layer | null;
  fog: Layer | null;
}
const caches = new WeakMap<HTMLCanvasElement, Cache>();
/** Teller voor tests: hoe vaak de statische laag en de fog-laag zijn opgebouwd. */
export const minimapBuildCount = { base: 0, fog: 0 };

const sameKey = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function layer(
  doc: Document,
  prev: Layer | null,
  key: readonly unknown[],
  w: number,
  h: number,
  pixels: () => Uint8ClampedArray,
  counter: 'base' | 'fog',
): Layer | null {
  if (prev && sameKey(prev.key, key)) return prev;
  const canvas = doc.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d');
  if (!c) return null;
  c.putImageData(new ImageData(pixels() as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  minimapBuildCount[counter]++;
  return { key, canvas };
}

/**
 * Tekent de minimap in `canvas`: statische laag (passability, water, terrein) en fog uit een offscreen cache,
 * daarna claims en blips. De lagen worden alleen opnieuw opgebouwd als `passable`, `water`, `terrain`, `visible`
 * of de afmetingen van referentie veranderen: lever een nieuwe array als de inhoud verandert.
 * Doet niets zonder 2D-context (bijvoorbeeld in tests).
 */
export function drawMinimap(canvas: HTMLCanvasElement, m: MinimapData, me: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || m.w <= 0 || m.h <= 0) return;
  const doc = canvas.ownerDocument;
  const cache = caches.get(canvas) ?? { base: null, fog: null };
  caches.set(canvas, cache);
  const dims = [m.w, m.h];
  cache.base = layer(
    doc,
    cache.base,
    [...dims, m.passable, m.water, m.terrain],
    m.w,
    m.h,
    () => buildStaticPixels(m),
    'base',
  );
  const vis = m.visible;
  const fog = m.fog;
  cache.fog = fog
    ? layer(
        doc,
        cache.fog,
        [fog.w, fog.h, fog.visible, fog.explored],
        fog.w,
        fog.h,
        () => buildFogLayerPixels(fog),
        'fog',
      )
    : vis
      ? layer(doc, cache.fog, [...dims, vis], m.w, m.h, () => buildFogPixels(m, vis), 'fog')
      : null;
  if (!cache.base) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cache.base.canvas, 0, 0, canvas.width, canvas.height);
  if (cache.fog) {
    // The fog grid is coarser than the minimap's cells: smoothing softens its edges (the legacy layer stays crisp).
    ctx.imageSmoothingEnabled = fog !== undefined;
    ctx.drawImage(cache.fog.canvas, 0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
  }

  const cell = m.cellU ?? 256;
  const sx = canvas.width / (m.w * cell);
  const sy = canvas.height / (m.h * cell);
  const seen = (x: number, y: number): boolean => {
    if (fog) return fogVisibleAt(fog, x / (m.w * cell), y / (m.h * cell));
    if (!m.visible) return true;
    const cx = Math.min(m.w - 1, Math.max(0, Math.floor(x / cell)));
    const cy = Math.min(m.h - 1, Math.max(0, Math.floor(y / cell)));
    return m.visible[cy * m.w + cx] === 1;
  };
  for (const c of m.claims) {
    ctx.strokeStyle = c.owner === null ? '#ffd54f' : c.owner === me ? rgb(OWN) : rgb(ENEMY);
    ctx.lineWidth = 2;
    ctx.strokeRect(c.x * sx - 3, c.y * sy - 3, 6, 6);
    if (c.progress !== undefined && c.progress > 0) {
      ctx.strokeStyle = c.claimer === me ? rgb(OWN) : rgb(ENEMY);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x * sx, c.y * sy, 6, -Math.PI / 2, -Math.PI / 2 + c.progress * Math.PI * 2);
      ctx.stroke();
    }
  }
  for (const b of m.blips) {
    // A ghost is remembered, not seen: it stays on the map, dimmed. Anything else of the enemy shows only in sight.
    if (!b.ghost && b.owner !== me && b.kind !== 'node' && !seen(b.x, b.y)) continue;
    ctx.fillStyle = b.ghost
      ? `rgba(${ENEMY[0]},${ENEMY[1]},${ENEMY[2]},${GHOST_ALPHA})`
      : b.kind === 'node'
        ? '#ffd54f'
        : b.owner === me
          ? rgb(OWN)
          : rgb(ENEMY);
    const size = b.kind === 'building' ? 4 : b.kind === 'hero' ? 5 : 2;
    ctx.fillRect(b.x * sx - size / 2, b.y * sy - size / 2, size, size);
  }
}

/** Whether the point (u, v), 0..1 over the whole map, lies in a cell visible now. */
export function fogVisibleAt(fog: MinimapFog, u: number, v: number): boolean {
  const cx = Math.min(fog.w - 1, Math.max(0, Math.floor(u * fog.w)));
  const cy = Math.min(fog.h - 1, Math.max(0, Math.floor(v * fog.h)));
  return fog.visible[cy * fog.w + cx] === 1;
}

const rgb = (c: number[]): string => `rgb(${c[0]},${c[1]},${c[2]})`;
