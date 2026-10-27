// The ground's material layers as tiling textures, generated on the CPU at start (no asset to ship, no download).
// The terrain material (groundSplat.ts) samples them at a few meters per tile, so the ground carries real detail at
// RTS zoom (128 texels per meter at a 4 m tile) instead of the old photo albedo, which held about 4 texels per meter
// of real detail (2048 px upscaled from a 64 m crop) and smeared into blotches at the default camera.
//
// Four layers, one per channel, in two RGBA8 textures (data, NoColorSpace; the shader colours them):
//   relief   R = turf (grass blades), G = dirt (soil, specks, cracks), B = gravel (pebbles), A = rock (cracked plates)
//            0..1, the layer's height: it drives the height blend between layers, the cavity shading and the bump.
//   tone     R = blade hue (green to straw), G = soil tone (organic dark to dust), B = pebble tone, A = lichen on rock
//
// Every feature wraps at the tile edge (modular lattice and cell coordinates), so the tile repeats without seams; the
// shader breaks the repeat with rotated, offset second samples. The mip chain is built here (buildMipChain), so every
// level exists on WebGL2 and WebGPU alike.
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType,
} from 'three/webgpu';
import { buildMipChain, cellular, fractalNoise, hash2 } from './noiseTexture.js';

/** Edge of the generated tile, texels (a power of two). */
export const GROUND_LAYER_SIZE = 512;

export interface GroundLayerTexels {
  size: number;
  /** size * size * 4 bytes each, row 0 first. */
  relief: Uint8Array;
  tone: Uint8Array;
  /** Mean of each relief channel, 0..1: the blend of two samples keeps its contrast around it. */
  reliefMean: [number, number, number, number];
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Stretches a field to 0..1 in place (the features' ranges differ; the shader's gains then mean the same thing). */
function normalize(f: Float32Array): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of f) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const s = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < f.length; i++) f[i] = (f[i]! - lo) * s;
}

/**
 * Turf: short blades stamped as tapered strokes (dark at the root, light at the tip) over a clumpy base, with soil
 * showing where no blade stands. Seen from the RTS camera a blade is a stroke of 3 to 10 cm.
 */
function turf(n: number, seed: number, height: Float32Array, hue: Float32Array): void {
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const c = fractalNoise(x / n, y / n, 6, 3, seed);
      height[y * n + x] = 0.12 * c;
      hue[y * n + x] = c;
    }
  const blades = Math.round(n * n * 0.022);
  for (let b = 0; b < blades; b++) {
    const px = hash2(b, 1, seed) * n;
    const py = hash2(b, 2, seed) * n;
    const clump = fractalNoise(px / n, py / n, 6, 3, seed);
    // Fewer blades between the clumps: bare soil shows through there.
    if (hash2(b, 3, seed) > 0.35 + 0.75 * clump) continue;
    const angle = hash2(b, 4, seed) * Math.PI * 2;
    const len = 8 + 13 * hash2(b, 5, seed);
    const width = 0.9 + 1.0 * hash2(b, 6, seed);
    // Clumps stand taller and denser than the grass between them.
    const top = (0.45 + 0.55 * hash2(b, 7, seed)) * (0.55 + 0.45 * clump);
    const tone = Math.min(1, Math.max(0, clump * 0.6 + hash2(b, 8, seed) * 0.6 - 0.1));
    const dx = Math.cos(angle) * len;
    const dy = Math.sin(angle) * len;
    const x0 = Math.floor(Math.min(px, px + dx) - 2);
    const x1 = Math.ceil(Math.max(px, px + dx) + 2);
    const y0 = Math.floor(Math.min(py, py + dy) - 2);
    const y1 = Math.ceil(Math.max(py, py + dy) + 2);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        // Distance to the segment and the position t along it (0 root, 1 tip).
        const rx = x + 0.5 - px;
        const ry = y + 0.5 - py;
        const t = Math.min(1, Math.max(0, (rx * dx + ry * dy) / (len * len)));
        const d = Math.hypot(rx - dx * t, ry - dy * t);
        const w = width * (1 - 0.7 * t); // tapered
        const cover = 1 - smooth(w - 0.5, w + 0.5, d);
        if (cover <= 0) continue;
        const h = (0.35 + 0.65 * t) * top * cover;
        const k = (((y % n) + n) % n) * n + (((x % n) + n) % n);
        if (h > height[k]!) {
          height[k] = h;
          hue[k] = tone;
        }
      }
  }
}

/** Soil: fbm with small specks and a few patches of drying cracks. */
function dirt(n: number, seed: number, height: Float32Array, tone: Float32Array): void {
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const v = (y + 0.5) / n;
      const base = fractalNoise(u, v, 12, 5, seed);
      const speck = cellular(u, v, 70, seed + 11);
      const grain = speck.id > 0.6 ? 1 - smooth(0.12, 0.3, speck.f1) : 0;
      const crackCell = cellular(
        u + 0.06 * (fractalNoise(u, v, 5, 2, seed + 95) - 0.5),
        v + 0.06 * (fractalNoise(u, v, 5, 2, seed + 97) - 0.5),
        9,
        seed + 23,
      );
      const crackPatch = smooth(0.66, 0.76, fractalNoise(u, v, 3, 2, seed + 31));
      const crack = (1 - smooth(0.0, 0.04, crackCell.f2 - crackCell.f1)) * crackPatch;
      height[y * n + x] = base * 0.7 + grain * 0.3 - crack * 0.12;
      tone[y * n + x] =
        fractalNoise(u, v, 4, 3, seed + 41) * 0.8 + (grain ? (speck.id - 0.6) * 0.8 : 0);
    }
}

/** Gravel: dense pebbles (rounded tops, each its own tone) with a few larger stones among them. */
function gravel(n: number, seed: number, height: Float32Array, tone: Float32Array): void {
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const v = (y + 0.5) / n;
      const small = cellular(u, v, 48, seed + 51);
      const rs = 0.3 + 0.15 * small.id;
      let h = 0.15 * fractalNoise(u, v, 32, 2, seed + 53);
      let t = 0.5;
      const domeS = small.f1 < rs ? Math.sqrt(1 - (small.f1 / rs) ** 2) : 0;
      if (domeS > 0) {
        h = Math.max(h, 0.2 + 0.45 * domeS);
        t = small.id;
      }
      const big = cellular(u, v, 14, seed + 61);
      const rb = 0.2 + 0.1 * big.id;
      if (big.id > 0.62 && big.f1 < rb) {
        h = Math.max(h, 0.35 + 0.65 * Math.sqrt(1 - (big.f1 / rb) ** 2));
        t = hash2(Math.floor(big.id * 9973), 3, seed);
      }
      height[y * n + x] = h;
      tone[y * n + x] = t;
    }
}

/** Ridged fractal noise (tileable): sharp crests and creases, the look of weathered stone. 0..1. */
function ridged(u: number, v: number, cells: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let total = 0;
  let c = cells;
  for (let o = 0; o < octaves; o++) {
    const r = 1 - Math.abs(fractalNoise(u, v, c, 1, seed + o * 13) * 2 - 1);
    sum += r * r * amp;
    total += amp;
    amp *= 0.5;
    c *= 2;
  }
  return sum / total;
}

/** Rock: weathered, creased stone (ridged noise) with a few wandering cracks, lichen in patches on the high parts. */
function rock(n: number, seed: number, height: Float32Array, lichen: Float32Array): void {
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const v = (y + 0.5) / n;
      // Domain warp (tileable): cracks wander instead of running straight.
      const wu = u + 0.12 * (fractalNoise(u, v, 4, 3, seed + 91) - 0.5);
      const wv = v + 0.12 * (fractalNoise(u, v, 4, 3, seed + 93) - 0.5);
      const crackCell = cellular(wu, wv, 3, seed + 71);
      const crack =
        (1 - smooth(0.0, 0.05, crackCell.f2 - crackCell.f1)) *
        smooth(0.45, 0.6, fractalNoise(u, v, 4, 2, seed + 75));
      const body = ridged(wu, wv, 4, 5, seed + 77);
      const h = 0.25 + 0.75 * body - 0.35 * crack + 0.06 * fractalNoise(u, v, 64, 2, seed + 79);
      height[y * n + x] = h;
      lichen[y * n + x] =
        smooth(0.55, 0.72, fractalNoise(u, v, 8, 4, seed + 83)) *
        smooth(0.4, 0.7, body) *
        (1 - crack);
    }
}

/** The four layers' relief and tone, as two RGBA8 images. */
export function generateGroundLayers(
  size: number = GROUND_LAYER_SIZE,
  seed = 7,
): GroundLayerTexels {
  const n = size;
  const fields = Array.from({ length: 8 }, () => new Float32Array(n * n));
  const [hTurf, hDirt, hGravel, hRock, tTurf, tDirt, tGravel, tRock] = fields as [
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
  ];
  turf(n, seed, hTurf, tTurf);
  dirt(n, seed, hDirt, tDirt);
  gravel(n, seed, hGravel, tGravel);
  rock(n, seed, hRock, tRock);
  for (const f of fields) normalize(f);
  const relief = new Uint8Array(n * n * 4);
  const tone = new Uint8Array(n * n * 4);
  const to8 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  for (let i = 0; i < n * n; i++) {
    relief[i * 4] = to8(hTurf[i]!);
    relief[i * 4 + 1] = to8(hDirt[i]!);
    relief[i * 4 + 2] = to8(hGravel[i]!);
    relief[i * 4 + 3] = to8(hRock[i]!);
    tone[i * 4] = to8(tTurf[i]!);
    tone[i * 4 + 1] = to8(tDirt[i]!);
    tone[i * 4 + 2] = to8(tGravel[i]!);
    tone[i * 4 + 3] = to8(tRock[i]!);
  }
  const reliefMean = [hTurf, hDirt, hGravel, hRock].map(
    (f) => f.reduce((a, b) => a + b, 0) / f.length,
  ) as [number, number, number, number];
  return { size: n, relief, tone, reliefMean };
}

function layerTexture(size: number, data: Uint8Array): DataTexture {
  const levels = buildMipChain({ size, data });
  const t = new DataTexture(levels[0]!.data, size, size, RGBAFormat, UnsignedByteType);
  t.mipmaps = levels;
  t.generateMipmaps = false;
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/** Generated texels by size and seed: a new terrain material (a test, a remount) does not pay the half second again. */
const generated = new Map<string, GroundLayerTexels>();

/** The two layer textures (relief, tone): repeat wrap, trilinear over the CPU mip chain, anisotropic. */
export function createGroundLayerTextures(
  size: number = GROUND_LAYER_SIZE,
  seed = 7,
): { relief: DataTexture; tone: DataTexture; reliefMean: [number, number, number, number] } {
  const key = `${size}:${seed}`;
  let texels = generated.get(key);
  if (!texels) {
    texels = generateGroundLayers(size, seed);
    generated.set(key, texels);
  }
  return {
    relief: layerTexture(size, texels.relief),
    tone: layerTexture(size, texels.tone),
    reliefMean: texels.reliefMean,
  };
}
