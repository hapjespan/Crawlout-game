// Synthetic XL map for the render demo (?xl), so the renderer can be measured at 384 x 384 m before the map agent's
// map-xl lands: the Rock Terrain 4 greybox tiled three times in x and z (every other tile mirrored, so the seams
// meet), a meandering river from north to south (6 to 10 m wide, three fords) in a valley that flattens the terrain
// around it, a dense forest border of 12 to 20 m round the map, groves and loose trees: 6000 trees, plus a few hundred
// rocks and bushes. The water mask uses the MapDef water convention (0 land, 1 water, 2 shallow or fordable).
// Render-demo code: floats and Math.sin are fine, nothing here reaches the sim.
import type { RenderProp } from '@crawlout/render';

export const XL_SIZE = 384;
export const XL_TREES = 6000;
const TREE_ASSETS = ['treehigh001', 'treemed001', 'treelow001'] as const;
const EXTRA_ASSETS = ['rock001', 'rock002', 'rock003', 'bush001', 'bush002'] as const;
const EXTRAS = 600;
/** Fords: centers along z and half length, meters. */
const FORDS = [70, 196, 302] as const;
const FORD_HALF = 4;

export interface XlWorld {
  size: number;
  /** Heights per 1 m cell (size x size, row by row), the bed already carved a little, as a map would. */
  heights: Float32Array;
  water: { w: number; h: number; data: Uint8Array };
  props: RenderProp[];
  trees: number;
}

/** Deterministic hash to 0..1, so the demo looks the same on every load. */
function rand(n: number): number {
  let h = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39);
  h ^= h >>> 15;
  h = Math.imul(h, 0x6c8e9cf5);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** River centerline x at z, its slope dx/dz, and half its width. */
export function riverAt(z: number): { x: number; slope: number; half: number } {
  const a = (2 * Math.PI * 1.1) / XL_SIZE;
  const x = 192 + 70 * Math.sin(z * a + 0.6) + 20 * Math.sin(z * 0.041 + 1.7);
  const slope = 70 * a * Math.cos(z * a + 0.6) + 20 * 0.041 * Math.cos(z * 0.041 + 1.7);
  const half = 4 + Math.sin(z * 0.029 + 0.3); // 3 to 5: 6 to 10 m wide
  return { x, slope, half };
}

/** Distance (meters, across the river) from (x, z) to the centerline. */
function acrossRiver(x: number, z: number): number {
  const r = riverAt(z);
  return Math.abs(x - r.x) / Math.sqrt(1 + r.slope * r.slope);
}

const isFord = (z: number): boolean => FORDS.some((f) => Math.abs(z - f) <= FORD_HALF);

/** The XL world from the 128 m base heights (rockTerrainHeights). */
export function xlWorld(base: { n: number; heights: Float32Array }): XlWorld {
  const size = XL_SIZE;
  const n = base.n;
  const heights = new Float32Array(size * size);
  const data = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    const z = j + 0.5;
    const r = riverAt(z);
    // The valley floor falls from 1.4 m in the north (upstream) to 0.4 m in the south.
    const floor = 1.4 - z / size;
    for (let i = 0; i < size; i++) {
      const x = i + 0.5;
      const ti = Math.floor(i / n);
      const tj = Math.floor(j / n);
      const li = ti % 2 === 1 ? n - 1 - (i % n) : i % n;
      const lj = tj % 2 === 1 ? n - 1 - (j % n) : j % n;
      let h = base.heights[lj * n + li]!;
      const d = acrossRiver(x, z);
      const t = Math.min(1, Math.max(0, (r.half + 16 - d) / 13));
      h = h + (floor - h) * (t * t * (3 - 2 * t));
      if (d < r.half) {
        const ford = isFord(z);
        data[j * size + i] = ford ? 2 : 1;
        h = floor - (ford ? 0.15 : 0.5);
      }
      heights[j * size + i] = h;
    }
  }

  const water = (x: number, z: number, margin: number): boolean =>
    acrossRiver(x, z) < riverAt(z).half + margin;
  const props: RenderProp[] = [];
  let seed = 1;
  const tree = (x: number, z: number, pick: number, scale: number): void => {
    if (x < 0.5 || z < 0.5 || x > size - 0.5 || z > size - 0.5 || water(x, z, 1.5)) return;
    props.push({
      asset: TREE_ASSETS[Math.min(2, Math.floor(pick * 3))]!,
      x,
      y: z,
      yaw: Math.floor(rand(seed++) * 65536),
      scale,
    });
  };
  // Forest border: a jittered 3 m grid within 12 to 20 m of the map edge.
  for (let gz = 1.5; gz < size; gz += 3)
    for (let gx = 1.5; gx < size; gx += 3) {
      const x = gx + (rand(seed++) - 0.5) * 2.4;
      const z = gz + (rand(seed++) - 0.5) * 2.4;
      const edge = Math.min(x, z, size - x, size - z);
      const band = 16 + 4 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.037 + 0.4);
      if (edge < band) tree(x, z, rand(seed++) * 0.9, 0.9 + rand(seed++) * 0.35);
    }
  // Groves: 50 clumps of 6 to 14 m radius away from the border.
  for (let g = 0; g < 50; g++) {
    const cx = 40 + rand(seed++) * (size - 80);
    const cz = 40 + rand(seed++) * (size - 80);
    const radius = 6 + rand(seed++) * 8;
    for (let gz = -radius; gz <= radius; gz += 2.7)
      for (let gx = -radius; gx <= radius; gx += 2.7) {
        const x = cx + gx + (rand(seed++) - 0.5) * 2;
        const z = cz + gz + (rand(seed++) - 0.5) * 2;
        const d = Math.hypot(x - cx, z - cz) / radius;
        if (d < 1 && rand(seed++) > d * d * 0.7)
          tree(x, z, rand(seed++), 0.85 + rand(seed++) * 0.4);
      }
  }
  // Loose trees until there are XL_TREES (or drop the last ones over it).
  while (props.length < XL_TREES)
    tree(
      20 + rand(seed++) * (size - 40),
      20 + rand(seed++) * (size - 40),
      0.3 + rand(seed++) * 0.7,
      0.8 + rand(seed++) * 0.45,
    );
  props.length = XL_TREES;
  for (let k = 0; k < EXTRAS; k++) {
    const x = 10 + rand(seed++) * (size - 20);
    const z = 10 + rand(seed++) * (size - 20);
    if (water(x, z, 1)) continue;
    props.push({
      asset: EXTRA_ASSETS[k % EXTRA_ASSETS.length]!,
      x,
      y: z,
      yaw: Math.floor(rand(seed++) * 65536),
      scale: 0.8 + rand(seed++) * 0.5,
    });
  }
  return { size, heights, water: { w: size, h: size, data }, props, trees: XL_TREES };
}
