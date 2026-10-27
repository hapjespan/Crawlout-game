// The map's water mask (MapDef `water`: a u8 grid, 0 land, 1 water, 2 shallow or fordable) turned into what the
// renderer draws: a water level per cell, a bed cut into the terrain, a flow direction and the shallows.
//   level  the lowest bank within bankRadius cells (banks are land cells next to water), smoothed along the water
//          and never above that raw minimum, minus a little freeboard: water never spills over its lowest bank.
//   bed    the drawn terrain under the water: level minus a depth (deep water deeper away from the shore, fords
//          shallow), blended to the untouched bank at the mask's shoreline. If the map already carved a deeper bed,
//          the bed keeps it (min).
//   flow   per connected body of water: from the border cells with the highest level (where a river enters the
//          map) along the water (breadth-first distance), smoothed; slower near the shore, faster over fords. A
//          body without border cells (a pond) stands still.
// Cells are 1 m by default and the grid sits on the terrain's bounds (placement); the renderer never reads the sim.

export const WATER_CELL = { land: 0, deep: 1, shallow: 2 } as const;

export interface WaterMaskInput {
  w: number;
  h: number;
  /** w * h cells, row by row (index = y * w + x, y along world z): 0 land, 1 water, 2 shallow or fordable. */
  data: ArrayLike<number>;
}

export interface WaterMask {
  w: number;
  h: number;
  data: Uint8Array;
}

export class WaterMaskError extends Error {}

/** Validates a mask: integer size, w * h cells, every cell 0, 1 or 2. Throws WaterMaskError otherwise. */
export function parseWaterMask(input: WaterMaskInput): WaterMask {
  const { w, h, data } = input;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0)
    throw new WaterMaskError(`water mask: invalid size ${w}x${h}`);
  if (data.length !== w * h)
    throw new WaterMaskError(`water mask: ${data.length} cells, expected ${w * h}`);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const v = data[i]!;
    if (v !== 0 && v !== 1 && v !== 2)
      throw new WaterMaskError(`water mask: cell ${i} is ${v}, expected 0, 1 or 2`);
    out[i] = v;
  }
  return { w, h, data: out };
}

/** Where the mask lies in the world: its cell (0, 0) starts at (minX, minZ), cells are `cell` meters. */
export interface WaterPlacement {
  minX: number;
  minZ: number;
  cell: number;
}

export interface WaterOptions {
  /** Cells around a water cell that count as its banks. Default 6 (a 10 m river sees both banks). */
  bankRadius?: number;
  /** Water stands this far below its lowest bank, meters. Default 0.15. */
  freeboard?: number;
  /** Depth of deep water away from the shore, meters. Default 1.1. */
  deepDepth?: number;
  /** Depth over a ford, meters. Default 0.3. */
  shallowDepth?: number;
  /** Flow speed in deep water away from the shore, m/s. Default 0.9. */
  flowSpeed?: number;
}

export interface WaterSurface {
  w: number;
  h: number;
  placement: WaterPlacement;
  /** The validated mask. */
  mask: Uint8Array;
  /** Water level per cell, meters: water cells and the land ring around them; NaN elsewhere. */
  level: Float32Array;
  /** Cells to the nearest land (4-connected): 1 next to land, 0 on land. */
  shore: Uint8Array;
  /** Flow per cell (x, z), meters per second; zero on land and in still water. */
  flow: Float32Array;
  /** Water cells (deep and shallow). */
  cells: number;
  shallowCells: number;
  /** The drawn terrain at (x, z) given its height there: the bed under the water, the bank as is. */
  bed(x: number, z: number, height: number): number;
}

const NEIGHBORS8: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

const NEIGHBORS4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** The cells around corner (x, y) of the grid: offsets from it to the cells it touches. */
export const CORNER_CELLS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [-1, 0],
  [0, 0],
];

/** Separable square min filter of radius r (Infinity stays where nothing finite is in reach). */
function minFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = Infinity;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++)
        m = Math.min(m, src[y * w + k]!);
      tmp[y * w + x] = m;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = Infinity;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++)
        m = Math.min(m, tmp[k * w + x]!);
      out[y * w + x] = m;
    }
  return out;
}

/**
 * Levels, bed and flow of a mask on a terrain. `groundAt` is the terrain as the map delivered it (before any bed).
 */
export function analyzeWater(
  mask: WaterMask,
  groundAt: (x: number, z: number) => number,
  placement: WaterPlacement,
  opts: WaterOptions = {},
): WaterSurface {
  const { w, h, data } = mask;
  const n = w * h;
  const R = opts.bankRadius ?? 6;
  const freeboard = opts.freeboard ?? 0.15;
  const deepDepth = opts.deepDepth ?? 1.1;
  const shallowDepth = opts.shallowDepth ?? 0.3;
  const speed = opts.flowSpeed ?? 0.9;
  const { minX, minZ, cell } = placement;
  const cx = (x: number): number => minX + (x + 0.5) * cell;
  const cz = (y: number): number => minZ + (y + 0.5) * cell;
  const wet = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && data[y * w + x]! !== 0;

  let cells = 0;
  let shallowCells = 0;
  for (let i = 0; i < n; i++) {
    if (data[i] !== 0) cells++;
    if (data[i] === WATER_CELL.shallow) shallowCells++;
  }

  // Banks: land next to water, with their ground height.
  const bank = new Float32Array(n).fill(Infinity);
  const ring = new Uint8Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (wet(x, y)) continue;
      if (NEIGHBORS8.some(([dx, dy]) => wet(x + dx, y + dy))) {
        bank[y * w + x] = groundAt(cx(x), cz(y));
        ring[y * w + x] = 1;
      }
    }
  const raw = minFilter(bank, w, h, R);

  // Level on water cells: the raw minimum, unreachable cells (the middle of a wide lake) from their neighbors.
  const level = new Float32Array(n).fill(NaN);
  const queue: number[] = [];
  for (let i = 0; i < n; i++)
    if (data[i] !== 0 && Number.isFinite(raw[i]!)) {
      level[i] = raw[i]!;
      queue.push(i);
    }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of NEIGHBORS8) {
      if (!wet(x + dx, y + dy)) continue;
      const j = (y + dy) * w + x + dx;
      if (!Number.isNaN(level[j]!)) continue;
      level[j] = level[i]!;
      queue.push(j);
    }
  }
  // A body of water with no bank at all (the whole map is water): the ground itself.
  for (let i = 0; i < n; i++)
    if (data[i] !== 0 && Number.isNaN(level[i]!))
      level[i] = groundAt(cx(i % w), cz(Math.floor(i / w)));
  const capped = level.slice();
  // Smooth along the water, never above the raw minimum.
  const next = new Float32Array(n);
  for (let it = 0; it < 8; it++) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (data[i] === 0) continue;
        let sum = level[i]!;
        let k = 1;
        for (const [dx, dy] of NEIGHBORS8)
          if (wet(x + dx, y + dy)) {
            sum += level[(y + dy) * w + x + dx]!;
            k++;
          }
        next[i] = Math.min(capped[i]!, sum / k);
      }
    for (let i = 0; i < n; i++) if (data[i] !== 0) level[i] = next[i]!;
  }
  for (let i = 0; i < n; i++) if (data[i] !== 0) level[i] = level[i]! - freeboard;

  // Shore distance (4-connected breadth-first from land).
  const shore = new Uint8Array(n);
  const dist = new Int32Array(n).fill(-1);
  const front: number[] = [];
  for (let i = 0; i < n; i++)
    if (data[i] === 0) {
      dist[i] = 0;
      front.push(i);
    }
  for (let q = 0; q < front.length; q++) {
    const i = front[q]!;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j] !== -1) continue;
      dist[j] = dist[i]! + 1;
      front.push(j);
    }
  }
  for (let i = 0; i < n; i++) shore[i] = Math.min(255, Math.max(0, dist[i]!));
  // A mask without land: everything is "far from shore".
  if (front.length === 0) shore.fill(255);

  const flow = computeFlow(mask, level, shore, speed);

  // The land ring takes the level and flow of its neighboring water (mean), so the surface runs under the bank.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!ring[i]) continue;
      let sum = 0;
      let k = 0;
      let fx = 0;
      let fz = 0;
      for (const [dx, dy] of NEIGHBORS8)
        if (wet(x + dx, y + dy)) {
          const j = (y + dy) * w + x + dx;
          sum += level[j]!;
          fx += flow[j * 2]!;
          fz += flow[j * 2 + 1]!;
          k++;
        }
      level[i] = sum / k;
      flow[i * 2] = fx / k;
      flow[i * 2 + 1] = fz / k;
    }

  // Depth per cell (0 on land), then per corner, so the bed blends to the bank right at the mask's shoreline.
  const depth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (data[i] === WATER_CELL.shallow) depth[i] = shallowDepth;
    else if (data[i] === WATER_CELL.deep)
      depth[i] = deepDepth * Math.min(1, Math.max(0.4, (shore[i]! - 0.5) / 2.5));
  }
  const cw = w + 1;
  const ch = h + 1;
  const cDepth = new Float32Array(cw * ch);
  const cWet = new Float32Array(cw * ch);
  const cLevel = new Float32Array(cw * ch).fill(NaN);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      let d = 0;
      let wt = 0;
      let k = 0;
      let lv = 0;
      let kl = 0;
      for (const [dx, dy] of CORNER_CELLS) {
        const ix = x + dx;
        const iy = y + dy;
        if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
        const i = iy * w + ix;
        k++;
        d += depth[i]!;
        if (data[i] !== 0) wt++;
        if (!Number.isNaN(level[i]!)) {
          lv += level[i]!;
          kl++;
        }
      }
      const c = y * cw + x;
      cDepth[c] = k ? d / k : 0;
      cWet[c] = k ? wt / k : 0;
      if (kl) cLevel[c] = lv / kl;
    }
  /** Bank shape: how far above the water the cut reaches at the shoreline, and how fast it gives up on land. */
  const SHORE_RISE = 0.6;
  const FADE = 20;
  const bed = (x: number, z: number, height: number): number => {
    const gx = (x - minX) / cell;
    const gz = (z - minZ) / cell;
    if (gx < 0 || gz < 0 || gx > w || gz > h) return height;
    const i = Math.min(w - 1, Math.floor(gx));
    const j = Math.min(h - 1, Math.floor(gz));
    const fx = gx - i;
    const fz = gz - j;
    const c = j * cw + i;
    const w00 = cWet[c]!;
    const w10 = cWet[c + 1]!;
    const w01 = cWet[c + cw]!;
    const w11 = cWet[c + cw + 1]!;
    if (w00 + w10 + w01 + w11 === 0) return height;
    const a0 = (1 - fx) * (1 - fz);
    const a1 = fx * (1 - fz);
    const a2 = (1 - fx) * fz;
    const a3 = fx * fz;
    const wetness = w00 * a0 + w10 * a1 + w01 * a2 + w11 * a3;
    const d =
      cDepth[c]! * a0 + cDepth[c + 1]! * a1 + cDepth[c + cw]! * a2 + cDepth[c + cw + 1]! * a3;
    let lv = 0;
    let lw = 0;
    const add = (l: number, a: number): void => {
      if (Number.isNaN(l)) return;
      lv += l * a;
      lw += a;
    };
    add(cLevel[c]!, a0);
    add(cLevel[c + 1]!, a1);
    add(cLevel[c + cw]!, a2);
    add(cLevel[c + cw + 1]!, a3);
    if (wetness <= 0 || lw === 0) return height;
    const lvl = lv / lw;
    const cut = lvl - d + SHORE_RISE * (1 - wetness) + FADE * Math.max(0, 0.3 - wetness);
    return Math.min(height, cut);
  };

  return { w, h, placement, mask: data, level, shore, flow, cells, shallowCells, bed };
}

/** Flow per connected body: away from its highest border cells along the water, smoothed, scaled by shore and fords. */
function computeFlow(
  mask: WaterMask,
  level: Float32Array,
  shore: Uint8Array,
  speed: number,
): Float32Array {
  const { w, h, data } = mask;
  const n = w * h;
  const flow = new Float32Array(n * 2);
  const comp = new Int32Array(n).fill(-1);
  const dist = new Float32Array(n).fill(-1);
  const isWater = (i: number): boolean => data[i] !== 0;
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (!isWater(s) || comp[s] !== -1) continue;
    // Label the body.
    const body: number[] = [s];
    comp[s] = id;
    for (let q = 0; q < body.length; q++) {
      const i = body[q]!;
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of NEIGHBORS8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!isWater(j) || comp[j] !== -1) continue;
        comp[j] = id;
        body.push(j);
      }
    }
    // Sources: border cells near the highest border cell.
    const border = body.filter((i) => {
      const x = i % w;
      const y = (i - x) / w;
      return x === 0 || y === 0 || x === w - 1 || y === h - 1;
    });
    if (border.length > 0) {
      let top = border[0]!;
      for (const i of border) if (level[i]! > level[top]! + 1e-6) top = i;
      const tx = top % w;
      const ty = (top - tx) / w;
      const front = border.filter(
        (i) => Math.max(Math.abs((i % w) - tx), Math.abs(Math.floor(i / w) - ty)) <= 16,
      );
      for (const i of front) dist[i] = 0;
      for (let q = 0; q < front.length; q++) {
        const i = front[q]!;
        const x = i % w;
        const y = (i - x) / w;
        for (const [dx, dy] of NEIGHBORS4) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (comp[j] !== id || dist[j]! >= 0) continue;
          dist[j] = dist[i]! + 1;
          front.push(j);
        }
      }
      // Downstream direction: the gradient of the distance.
      for (const i of body) {
        const x = i % w;
        const y = (i - x) / w;
        const d = (xx: number, yy: number): number => {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) return dist[i]!;
          const j = yy * w + xx;
          return comp[j] === id && dist[j]! >= 0 ? dist[j]! : dist[i]!;
        };
        flow[i * 2] = d(x + 1, y) - d(x - 1, y);
        flow[i * 2 + 1] = d(x, y + 1) - d(x, y - 1);
      }
      // Smooth within the body, then normalize and scale.
      const tmp = new Float32Array(body.length * 2);
      for (let it = 0; it < 4; it++) {
        body.forEach((i, k) => {
          const x = i % w;
          const y = (i - x) / w;
          let fx = flow[i * 2]!;
          let fz = flow[i * 2 + 1]!;
          for (const [dx, dy] of NEIGHBORS8) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (comp[j] !== id) continue;
            fx += flow[j * 2]!;
            fz += flow[j * 2 + 1]!;
          }
          tmp[k * 2] = fx;
          tmp[k * 2 + 1] = fz;
        });
        body.forEach((i, k) => {
          flow[i * 2] = tmp[k * 2]!;
          flow[i * 2 + 1] = tmp[k * 2 + 1]!;
        });
      }
      for (const i of body) {
        const fx = flow[i * 2]!;
        const fz = flow[i * 2 + 1]!;
        const len = Math.hypot(fx, fz);
        const nearShore = 0.35 + 0.65 * Math.min(1, (shore[i]! - 1) / 2);
        const s = len > 1e-6 ? (speed * nearShore * (data[i] === 2 ? 1.5 : 1)) / len : 0;
        flow[i * 2] = fx * s;
        flow[i * 2 + 1] = fz * s;
      }
    }
    id++;
  }
  return flow;
}
