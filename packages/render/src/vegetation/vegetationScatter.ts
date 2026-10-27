// Where the ground vegetation grows: a pure, seeded scatter over the ground map (terrain/groundMap.ts), the water and,
// when the caller has it, the passability grid. Render only: nothing here reaches the sim, and the same input always
// gives the same plants (hash noise, no Math.random), so a reload or a replay shows the same landscape.
//
//   grass   tufts on a jittered 0.55 m grid wherever the ground map has cover, thinning on slopes and off the shore
//   weeds   small flowering clumps in the lushest meadow, in patches
//   shrubs  in clumps: along the edges of impassable ground (rock outcrops, forest strips) where a unit does not
//           fight in the open, by the water, a few on dry ridges; rarely in the open meadow
//   reeds   in clumps along the bank on both sides of the waterline, never near a ford
//   trees   groves on and right against impassable ground (needs the passability grid), spaced from each other and
//           from the map's own trees, so the forest strips read as copses instead of lines
import { distanceField, type GroundMap } from '../terrain/groundMap.js';
import { fractalNoise, hash2 } from '../terrain/noiseTexture.js';
import { WATER_CELL } from '../water/waterMask.js';

/** What grows: each species is one mesh (vegetationMeshes.ts) and one palette in the layer. */
export const SPECIES = [
  'grass',
  'weedYellow',
  'weedPale',
  'shrubRound',
  'shrubLow',
  'shrubTall',
  'reed',
] as const;
export type Species = (typeof SPECIES)[number];

/** Floats per instance: x, z (m), yaw (rad), scale across, scale up, variation 0..1, wind phase (rad). */
export const INSTANCE_STRIDE = 7;

export interface ScatterInput {
  ground: GroundMap;
  heightAt: (x: number, z: number) => number;
  /** Water cells over the ground map's rectangle (WATER_CELL values), row 0 at its min z. */
  water?: { w: number; h: number; data: ArrayLike<number> } | null;
  /** Passability over the same rectangle (1 passable), row 0 at its min z. Without it there are no groves. */
  passable?: { w: number; h: number; data: ArrayLike<number> } | null;
  /** Trees already standing (the map's props), world x and z: groves keep their distance. */
  trees?: readonly { x: number; z: number }[];
  seed?: number;
}

export interface GroveTree {
  asset: string;
  x: number;
  z: number;
  yaw: number;
  scale: number;
}

export interface ScatterResult {
  instances: Record<Species, Float32Array>;
  trees: GroveTree[];
}

/** Grass tufts at most per jitter cell (0.55 m), and the cells of the other kinds (m). */
export const GRASS_CELL_M = 0.55;
export const WEED_CELL_M = 2.2;
export const SHRUB_CELL_M = 2.6;
export const REED_CELL_M = 0.8;
export const GROVE_CELL_M = 7;
/** Least spacing (m) between two grove trees, and between a grove tree and a map tree. */
export const TREE_SPACING_M = 3.4;
/** Fords stay open: no reeds or shrubs within this distance (m) of shallow water. */
export const FORD_CLEAR_M = 6;
/** Most grove trees a map gets. */
export const MAX_GROVE_TREES = 420;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A grid that lies over the map's own rectangle (`inner`), resampled to the ground map's texels (nearest); texels
 * outside the map read `outside`.
 */
function resample(
  src: { w: number; h: number; data: ArrayLike<number> },
  g: GroundMap,
  test: (v: number) => boolean,
  outside: boolean,
): Uint8Array {
  const { w, h, inner } = g;
  const out = new Uint8Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = g.minX + ((i + 0.5) / w) * g.sizeX;
      const z = g.minZ + ((j + 0.5) / h) * g.sizeZ;
      const si = Math.floor(((x - inner.minX) / inner.sizeX) * src.w);
      const sj = Math.floor(((z - inner.minZ) / inner.sizeZ) * src.h);
      const inside = si >= 0 && sj >= 0 && si < src.w && sj < src.h;
      if (inside ? test(src.data[sj * src.w + si]!) : outside) out[j * w + i] = 1;
    }
  return out;
}

export function scatterVegetation(input: ScatterInput): ScatterResult {
  const g = input.ground;
  const seed = input.seed ?? 11;
  const { w, h } = g;
  const cellX = g.sizeX / w;
  const cellZ = g.sizeZ / h;
  const texel = (x: number, z: number): number => {
    const i = Math.min(w - 1, Math.max(0, Math.floor((x - g.minX) / cellX)));
    const j = Math.min(h - 1, Math.max(0, Math.floor((z - g.minZ) / cellZ)));
    return j * w + i;
  };
  const field = (k: number, c: number): number => g.data[k * 4 + c]! / 255;

  // Slope (m per m) per texel, from the heights.
  const slope = new Float32Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = g.minX + (i + 0.5) * cellX;
      const z = g.minZ + (j + 0.5) * cellZ;
      const dx = input.heightAt(x + 0.5, z) - input.heightAt(x - 0.5, z);
      const dz = input.heightAt(x, z + 0.5) - input.heightAt(x, z - 0.5);
      slope[j * w + i] = Math.hypot(dx, dz);
    }
  const water = input.water
    ? resample(input.water, g, (v) => v !== WATER_CELL.land, false)
    : new Uint8Array(w * h);
  const shallow = input.water
    ? resample(input.water, g, (v) => v === WATER_CELL.shallow, false)
    : new Uint8Array(w * h);
  const land = water.map((v) => 1 - v);
  const toWater = distanceField(water, w, h);
  const toLand = distanceField(land, w, h);
  const toFord = distanceField(shallow, w, h);
  const blocked = input.passable
    ? resample(input.passable, g, (v) => v !== 1, false).map((v, k) => (water[k] ? 0 : v))
    : null;
  const toBlocked = blocked ? distanceField(blocked, w, h) : null;
  const cell = (cellX + cellZ) / 2;

  const out: Record<Species, number[]> = Object.fromEntries(SPECIES.map((s) => [s, []])) as never;
  const push = (
    s: Species,
    x: number,
    z: number,
    n: number,
    sxz: number,
    sy: number,
    v: number,
  ): void => {
    out[s].push(
      x,
      z,
      hash2(n, 91, seed) * Math.PI * 2,
      sxz,
      sy,
      v,
      hash2(n, 92, seed) * Math.PI * 2,
    );
  };
  /** Jittered grid over the map: calls fn with a point, its texel and a running id. */
  const grid = (
    step: number,
    salt: number,
    fn: (x: number, z: number, k: number, n: number) => void,
  ): void => {
    // Plants grow on the map only: the margin beyond it is the skirt, whose own hills the heights here do not know.
    const nx = Math.floor(g.inner.sizeX / step);
    const nz = Math.floor(g.inner.sizeZ / step);
    for (let b = 0; b < nz; b++)
      for (let a = 0; a < nx; a++) {
        const n = (b * nx + a) * 7 + salt;
        const x = g.inner.minX + (a + hash2(n, 1, seed)) * step;
        const z = g.inner.minZ + (b + hash2(n, 2, seed)) * step;
        fn(x, z, texel(x, z), n);
      }
  };
  const clumps = (x: number, z: number, cells: number, salt: number): number =>
    fractalNoise((x - g.minX) / g.sizeX, (z - g.minZ) / g.sizeZ, cells, 3, seed + salt);
  const span = Math.max(g.sizeX, g.sizeZ);

  // Grass.
  grid(GRASS_CELL_M, 0, (x, z, k, n) => {
    if (water[k] || toWater[k]! * cell < 0.6) return;
    const cover = field(k, 1);
    const p = smooth(0.28, 0.7, cover) * (1 - smooth(0.45, 0.85, slope[k]!));
    if (hash2(n, 3, seed) >= p * 0.9) return;
    const size = 0.75 + 0.55 * hash2(n, 4, seed);
    const v = Math.min(
      1,
      Math.max(0, cover * 0.8 + field(k, 0) * 0.4 + (hash2(n, 5, seed) - 0.5) * 0.35),
    );
    push('grass', x, z, n, size * (0.9 + 0.2 * hash2(n, 6, seed)), size, v);
  });

  // Weeds.
  grid(WEED_CELL_M, 1, (x, z, k, n) => {
    if (water[k] || toWater[k]! * cell < 1) return;
    const p =
      smooth(0.55, 0.9, field(k, 1)) * smooth(0.5, 0.75, clumps(x, z, Math.round(span / 18), 5));
    if (hash2(n, 3, seed) >= p * 0.6) return;
    const size = 0.8 + 0.5 * hash2(n, 4, seed);
    push(
      hash2(n, 7, seed) < 0.6 ? 'weedYellow' : 'weedPale',
      x,
      z,
      n,
      size,
      size,
      hash2(n, 5, seed),
    );
  });

  // Shrubs, in clumps of one to three.
  grid(SHRUB_CELL_M, 2, (x, z, k, n) => {
    if (water[k] || toFord[k]! * cell < FORD_CLEAR_M || slope[k]! > 0.9) return;
    const moist = field(k, 0);
    const edge = toBlocked ? smooth(5, 1, toBlocked[k]! * cell) : 0;
    const shore = smooth(0.3, 0.7, moist) * (1 - smooth(0.88, 1, moist));
    const ridge = smooth(0.62, 0.85, field(k, 2)) * 0.3;
    const meadow = 0.05 * field(k, 1);
    const clump = smooth(0.42, 0.68, clumps(x, z, Math.round(span / 14), 9));
    const p = clump * (0.9 * edge + 0.55 * shore + ridge + meadow);
    if (hash2(n, 3, seed) >= p) return;
    const count = 1 + Math.floor(hash2(n, 8, seed) * 3);
    for (let c = 0; c < count; c++) {
      const m = n * 5 + c;
      const a = hash2(m, 11, seed) * Math.PI * 2;
      const r = c === 0 ? 0 : 0.7 + 0.7 * hash2(m, 12, seed);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const pk = texel(px, pz);
      if (water[pk]) continue;
      const pick = hash2(m, 13, seed);
      const species: Species =
        moist > 0.45 && pick < 0.45 ? 'shrubTall' : pick < 0.55 ? 'shrubRound' : 'shrubLow';
      const size = 0.75 + 0.5 * hash2(m, 14, seed);
      push(
        species,
        px,
        pz,
        m,
        size,
        size * (0.85 + 0.3 * hash2(m, 15, seed)),
        moist * 0.6 + hash2(m, 16, seed) * 0.4,
      );
    }
  });

  // Reeds along the bank, both sides of the waterline.
  grid(REED_CELL_M, 3, (x, z, k, n) => {
    if (toFord[k]! * cell < FORD_CLEAR_M) return;
    const bank = water[k]
      ? smooth(1.4, 0.3, toLand[k]! * cell)
      : smooth(2.4, 0.6, toWater[k]! * cell);
    const p = bank * smooth(0.35, 0.6, clumps(x, z, Math.round(span / 10), 13));
    if (hash2(n, 3, seed) >= p * 0.85) return;
    const size = 0.8 + 0.45 * hash2(n, 4, seed);
    push('reed', x, z, n, size, size, hash2(n, 5, seed));
  });

  const trees = blocked && toBlocked ? groves() : [];

  function groves(): GroveTree[] {
    const placed: { x: number; z: number }[] = [];
    const bucket = new Map<number, { x: number; z: number }[]>();
    const keyOf = (x: number, z: number): number => Math.floor(x / 8) * 65536 + Math.floor(z / 8);
    const add = (p: { x: number; z: number }): void => {
      const key = keyOf(p.x, p.z);
      const list = bucket.get(key);
      if (list) list.push(p);
      else bucket.set(key, [p]);
    };
    for (const t of input.trees ?? []) add(t);
    const free = (x: number, z: number): boolean => {
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const p of bucket.get(keyOf(x + a * 8, z + b * 8)) ?? [])
            if (Math.hypot(p.x - x, p.z - z) < TREE_SPACING_M) return false;
      return true;
    };
    const out: GroveTree[] = [];
    grid(GROVE_CELL_M, 4, (x, z, k, n) => {
      if (out.length >= MAX_GROVE_TREES) return;
      if (toBlocked![k]! * cell > 1.5 || water[k]) return;
      if (smooth(0.48, 0.66, clumps(x, z, Math.round(span / 40), 17)) <= hash2(n, 3, seed)) return;
      const count = 2 + Math.floor(hash2(n, 8, seed) * 4);
      for (let c = 0; c < count && out.length < MAX_GROVE_TREES; c++) {
        const m = n * 7 + c;
        const a = hash2(m, 21, seed) * Math.PI * 2;
        const r = c === 0 ? 0 : 2.5 + 3.5 * hash2(m, 22, seed);
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        const pk = texel(px, pz);
        if (water[pk] || toBlocked![pk]! * cell > 1.5 || slope[pk]! > 1.2 || !free(px, pz))
          continue;
        const moist = field(pk, 0);
        const dry = smooth(0.55, 0.85, field(pk, 2));
        const pick = hash2(m, 23, seed);
        const kind = pick < dry * 0.6 ? 'bare' : moist > 0.35 || pick < 0.6 ? 'oak' : 'pine';
        const asset = `tree_${kind}_0${1 + Math.floor(hash2(m, 24, seed) * 3)}`;
        const p = { x: px, z: pz };
        add(p);
        placed.push(p);
        out.push({
          asset,
          x: px,
          z: pz,
          yaw: hash2(m, 25, seed) * Math.PI * 2,
          scale: 0.8 + 0.35 * hash2(m, 26, seed),
        });
      }
    });
    return out;
  }

  const instances = Object.fromEntries(
    SPECIES.map((s) => [s, Float32Array.from(out[s])]),
  ) as Record<Species, Float32Array>;
  return { instances, trees };
}
