/// <reference types="vite/client" />
// Demo terrain on Rock Terrain 4, without a map: the heightfield of the asset-cli (assets/dist/terrain) turned into a
// greybox the way the map agent's generator does it (packages/map gen/terrain.ts on the map-terrain branch): the
// source turned 90 degrees (orientation 5), the northern half kept and point-mirrored over the southern half with a
// blended seam, a piecewise height curve (lowland 0.17, cliff wall 0.4, plateau 0.18), then one quad per 1 m cell with
// its own four vertices and a flat color per cell (sand, darker cliff cells, a little brighter with height). That is
// the coarse mesh the renderer has to make look good; floats are fine here, this is render-demo code, not the sim.
import type { TerrainGeometry } from '@crawlout/render';

interface HeightfieldJson {
  w: number;
  h: number;
  heights: number[];
}

const fields = import.meta.glob('../../../../assets/dist/terrain/*.height.json', {
  eager: true,
  import: 'default',
}) as Record<string, HeightfieldJson>;

const CURVE: readonly (readonly [number, number])[] = [
  [0, 0.17],
  [6, 0.4],
  [16, 0.18],
];
const SEAM_HALF = 8;
/** tan 32 degrees: steeper is a cliff cell (map rule). */
const MAX_SLOPE = 0.625;
const SAND = [150, 128, 94] as const;
const CLIFF = [78, 72, 68] as const;

function curve(h: number): number {
  let out = 0;
  for (let k = 0; k < CURVE.length; k++) {
    const [from, gain] = CURVE[k]!;
    const to = CURVE[k + 1]?.[0] ?? Infinity;
    if (h <= from) break;
    out += (Math.min(h, to) - from) * gain;
  }
  return out;
}

/** Heights per 1 m cell of the demo's Rock Terrain 4 map (n x n, row by row), or null without a heightfield. */
export function rockTerrainHeights(): { n: number; heights: Float32Array } | null {
  const field = Object.values(fields)[0];
  if (!field || field.w !== field.h) return null;
  const n = field.w;
  const m = n - 1;
  // One 1-2-1 smoothing pass in x and y.
  const tmp = new Float32Array(n * n);
  const base = new Float32Array(n * n);
  const src = field.heights;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      tmp[y * n + x] =
        (src[y * n + Math.max(0, x - 1)]! +
          2 * src[y * n + x]! +
          src[y * n + Math.min(m, x + 1)]!) /
        4;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      base[y * n + x] =
        (tmp[Math.max(0, y - 1) * n + x]! +
          2 * tmp[y * n + x]! +
          tmp[Math.min(m, y + 1) * n + x]!) /
        4;
  // Orientation 5: target (i, j) reads source (m - j, i).
  const oriented = (i: number, j: number): number => base[i * n + (m - j)]!;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const d = j - (n - 1) / 2; // negative on the kept (northern) half
      const t = Math.min(1, Math.max(0, (d + SEAM_HALF) / (2 * SEAM_HALF)));
      const s = t * t * (3 - 2 * t);
      const h = oriented(i, j) * (1 - s) + oriented(m - i, m - j) * s;
      heights[j * n + i] = curve(h);
    }
  }
  return { n, heights };
}

/**
 * A greybox like the map agent's: one quad per 1 m cell with its own four vertices (corner height = mean of the
 * cells around it), a flat color per cell: sand, darker cliff cells (steeper than 32 degrees), a little brighter with
 * height, or `cellColor` where it returns one (the demo's river bed).
 */
export function greyboxFromHeights(
  w: number,
  h: number,
  heights: Float32Array,
  cellColor?: (x: number, y: number) => readonly [number, number, number] | null,
): TerrainGeometry {
  const at = (i: number, j: number): number =>
    heights[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))]!;
  const corner = (cx: number, cy: number): number => {
    let sum = 0;
    let k = 0;
    for (const [dx, dy] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ] as const) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      sum += heights[y * w + x]!;
      k++;
    }
    return sum / k;
  };

  const cells = w * h;
  const positions = new Float32Array(cells * 12);
  const colors = new Uint8Array(cells * 12);
  const indices = new Uint32Array(cells * 6);
  let v = 0;
  let ii = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hc = at(x, y);
      let steep = 0;
      for (const [dx, dy, dist] of [
        [1, 0, 1],
        [-1, 0, 1],
        [0, 1, 1],
        [0, -1, 1],
        [1, 1, Math.SQRT2],
        [-1, -1, Math.SQRT2],
        [1, -1, Math.SQRT2],
        [-1, 1, Math.SQRT2],
      ] as const)
        steep = Math.max(steep, Math.abs(at(x + dx, y + dy) - hc) / dist);
      const rgb = cellColor?.(x, y) ?? (steep > MAX_SLOPE ? CLIFF : SAND);
      const shade = Math.min(31, Math.max(0, Math.round(hc * 16)));
      const first = v;
      for (const [qx, qy] of [
        [x, y],
        [x + 1, y],
        [x, y + 1],
        [x + 1, y + 1],
      ] as const) {
        const o = v * 3;
        positions[o] = qx;
        positions[o + 1] = corner(qx, qy);
        positions[o + 2] = qy;
        colors[o] = Math.min(255, rgb[0] + shade);
        colors[o + 1] = Math.min(255, rgb[1] + shade);
        colors[o + 2] = Math.min(255, rgb[2] + shade);
        v++;
      }
      indices[ii++] = first;
      indices[ii++] = first + 2;
      indices[ii++] = first + 1;
      indices[ii++] = first + 1;
      indices[ii++] = first + 2;
      indices[ii++] = first + 3;
    }
  }
  return { positions, colors, indices };
}

/** The demo's Rock Terrain 4 greybox, or null when assets/dist/terrain has no heightfield. */
export function rockTerrainGreybox(): TerrainGeometry | null {
  const base = rockTerrainHeights();
  return base ? greyboxFromHeights(base.n, base.n, base.heights) : null;
}
