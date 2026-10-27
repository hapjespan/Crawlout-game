import type { MapGrid } from './types.js';

export function inBounds(map: Pick<MapGrid, 'w' | 'h'>, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}

/** Buiten de map telt als onbegaanbaar. */
export function isPassable(map: MapGrid, x: number, y: number): boolean {
  return inBounds(map, x, y) && map.passable[y * map.w + x] === 1;
}

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/** Flood fill (4-verbonden) vanaf een cel. w*h bytes terug: 1 = bereikbaar. Vaste volgorde, geen recursie. */
export function floodReachable(map: MapGrid, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(map.w * map.h);
  if (!isPassable(map, sx, sy)) return seen;
  const qx = new Int32Array(map.w * map.h);
  const qy = new Int32Array(map.w * map.h);
  let head = 0;
  let tail = 0;
  seen[sy * map.w + sx] = 1;
  qx[tail] = sx;
  qy[tail++] = sy;
  while (head < tail) {
    const cx = qx[head] as number;
    const cy = qy[head++] as number;
    for (let d = 0; d < 4; d++) {
      const nx = cx + (DX[d] as number);
      const ny = cy + (DY[d] as number);
      if (!isPassable(map, nx, ny)) continue;
      const idx = ny * map.w + nx;
      if (seen[idx] === 1) continue;
      seen[idx] = 1;
      qx[tail] = nx;
      qy[tail++] = ny;
    }
  }
  return seen;
}

/** True als alle opgegeven cellen in dezelfde begaanbare component liggen als de eerste. */
export function allConnected(
  map: MapGrid,
  cells: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  const first = cells[0];
  if (!first) return true;
  const seen = floodReachable(map, first.x, first.y);
  return cells.every((c) => inBounds(map, c.x, c.y) && seen[c.y * map.w + c.x] === 1);
}
