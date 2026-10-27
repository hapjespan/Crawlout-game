// Split from terrain.ts to stay under the 5,000-token file limit; terrain.ts re-exports the public surface.
// Holds: TerrainMaterial, TerrainMesh, SampleGrid, TopSurface, BARY_EPS, rasterizeTopSurface, +13 more.
import { type Heightfield, HEIGHTFIELD_FORMAT } from './heightfield.js';

/** Een bronmateriaal: lineaire basiskleur-factor (glTF) en eventueel een sRGB-diffuse. */
export interface TerrainMaterial {
  factor: [number, number, number];
  texture?: {
    width: number;
    height: number;
    /** RGB, 3 bytes per pixel, sRGB. */ data: Uint8Array;
  };
}

/**
 * Driehoekssoep in wereldruimte, Y omhoog (de Z-up-naar-Y-up-omzetting is al toegepast). `positions` is xyz per
 * vertex, `uvs` uv per vertex (glTF-conventie, v naar beneden), `triMaterial` een index in `materials` per driehoek.
 */
export interface TerrainMesh {
  positions: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array | undefined;
  triMaterial?: Uint16Array | undefined;
  materials?: TerrainMaterial[] | undefined;
}

/** Vierkant bemonsteringsgebied in bronmeters (x en z) met `resolution` x `resolution` monsters. */
export interface SampleGrid {
  minX: number;
  minZ: number;
  sizeM: number;
  resolution: number;
}

/** Bovenste oppervlak per monster: de hoogste y van alle driehoeken onder het monster. */
export interface TopSurface extends SampleGrid {
  /** Hoogte (bronmeters), NaN waar geen driehoek ligt. */
  height: Float32Array;
  /** Index van de bovenste driehoek, -1 waar geen driehoek ligt. */
  tri: Int32Array;
  /** Interpolatie-uv van de bovenste driehoek (alleen gevuld als de mesh uvs heeft). */
  u: Float32Array;
  v: Float32Array;
}

const BARY_EPS = 1e-9;

/**
 * Rasteriseert alle driehoeken van boven (naar -y) op een regelmatig raster en houdt per monster de hoogste y.
 * Dit is hetzelfde als een raycast van boven op de monsterpunten (middens van de fijne cellen), maar zonder BVH.
 * Verticale driehoeken (geen oppervlak in xz) tellen niet mee. Deterministisch: vaste driehoekvolgorde, strikt `>`.
 */
export function rasterizeTopSurface(mesh: TerrainMesh, grid: SampleGrid): TopSurface {
  const n = grid.resolution;
  const step = grid.sizeM / n;
  const height = new Float32Array(n * n).fill(NaN);
  const tri = new Int32Array(n * n).fill(-1);
  const u = new Float32Array(n * n);
  const v = new Float32Array(n * n);
  const { positions, indices, uvs } = mesh;
  const triCount = indices.length / 3;

  for (let t = 0; t < triCount; t++) {
    const i0 = (indices[t * 3] as number) * 3;
    const i1 = (indices[t * 3 + 1] as number) * 3;
    const i2 = (indices[t * 3 + 2] as number) * 3;
    const x0 = positions[i0] as number;
    const y0 = positions[i0 + 1] as number;
    const z0 = positions[i0 + 2] as number;
    const x1 = positions[i1] as number;
    const y1 = positions[i1 + 1] as number;
    const z1 = positions[i1 + 2] as number;
    const x2 = positions[i2] as number;
    const y2 = positions[i2 + 1] as number;
    const z2 = positions[i2 + 2] as number;

    const det = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(det) < 1e-12) continue;

    const aMin = Math.max(0, Math.ceil((Math.min(x0, x1, x2) - grid.minX) / step - 0.5));
    const aMax = Math.min(n - 1, Math.floor((Math.max(x0, x1, x2) - grid.minX) / step - 0.5));
    const bMin = Math.max(0, Math.ceil((Math.min(z0, z1, z2) - grid.minZ) / step - 0.5));
    const bMax = Math.min(n - 1, Math.floor((Math.max(z0, z1, z2) - grid.minZ) / step - 0.5));
    if (aMin > aMax || bMin > bMax) continue;

    for (let b = bMin; b <= bMax; b++) {
      const pz = grid.minZ + (b + 0.5) * step;
      for (let a = aMin; a <= aMax; a++) {
        const px = grid.minX + (a + 0.5) * step;
        const l0 = ((z1 - z2) * (px - x2) + (x2 - x1) * (pz - z2)) / det;
        const l1 = ((z2 - z0) * (px - x2) + (x0 - x2) * (pz - z2)) / det;
        const l2 = 1 - l0 - l1;
        if (l0 < -BARY_EPS || l1 < -BARY_EPS || l2 < -BARY_EPS) continue;
        const y = l0 * y0 + l1 * y1 + l2 * y2;
        const index = b * n + a;
        const current = height[index] as number;
        if (!Number.isNaN(current) && y <= current) continue;
        height[index] = y;
        tri[index] = t;
        if (uvs) {
          const j0 = (indices[t * 3] as number) * 2;
          const j1 = (indices[t * 3 + 1] as number) * 2;
          const j2 = (indices[t * 3 + 2] as number) * 2;
          u[index] = l0 * (uvs[j0] as number) + l1 * (uvs[j1] as number) + l2 * (uvs[j2] as number);
          v[index] =
            l0 * (uvs[j0 + 1] as number) +
            l1 * (uvs[j1 + 1] as number) +
            l2 * (uvs[j2 + 1] as number);
        }
      }
    }
  }
  return { ...grid, height, tri, u, v };
}

export interface FieldOptions {
  /** Aantal cellen per zijde (128). */
  cells: number;
  /** Veldmeters per cel (1); samen met `cells` bepaalt dit de schaal t.o.v. de uitsnede. */
  metersPerCell: number;
}

export interface FieldResult {
  field: Heightfield;
  /** Vergroting van bron naar veld (uniform, ook verticaal). */
  scale: number;
  /** Bronhoogte die is afgetrokken zodat het laagste punt op 0 ligt. */
  heightOffsetM: number;
  /** Aantal cellen zonder dekking dat is opgevuld uit buurcellen. */
  filledCells: number;
}

/**
 * Middelt de monsters per cel (elk monster is de hoogste y op dat punt) tot een hoogteveld in veldmeters. De
 * resolutie van het oppervlak moet een geheel veelvoud van `cells` zijn. Cellen zonder dekking worden iteratief
 * opgevuld met het gemiddelde van hun gedekte buren. Het laagste punt gaat naar 0; waarden op twee decimalen.
 */
export function heightfieldFromSurface(surface: TopSurface, options: FieldOptions): FieldResult {
  const { cells, metersPerCell } = options;
  const n = surface.resolution;
  if (n % cells !== 0) throw new Error(`resolutie ${n} is geen veelvoud van ${cells} cellen`);
  const sub = n / cells;
  const scale = (cells * metersPerCell) / surface.sizeM;

  let mean = new Float64Array(cells * cells).fill(NaN);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      let sum = 0;
      let count = 0;
      for (let b = 0; b < sub; b++) {
        for (let a = 0; a < sub; a++) {
          const value = surface.height[(j * sub + b) * n + i * sub + a] as number;
          if (!Number.isNaN(value)) {
            sum += value;
            count++;
          }
        }
      }
      if (count > 0) mean[j * cells + i] = sum / count;
    }
  }

  let filledCells = 0;
  for (let guard = 0; guard < cells; guard++) {
    const next = Float64Array.from(mean);
    let remaining = 0;
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        if (!Number.isNaN(mean[j * cells + i] as number)) continue;
        let sum = 0;
        let count = 0;
        for (const [di, dj] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= cells || nj >= cells) continue;
          const value = mean[nj * cells + ni] as number;
          if (!Number.isNaN(value)) {
            sum += value;
            count++;
          }
        }
        if (count > 0) {
          next[j * cells + i] = sum / count;
          filledCells++;
        } else remaining++;
      }
    }
    mean = next;
    if (remaining === 0) break;
  }
  if (mean.some((value) => Number.isNaN(value)))
    throw new Error('het terrein dekt de uitsnede niet (geen enkele cel)');

  let low = Infinity;
  for (const value of mean) if (value < low) low = value;
  const heights: number[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (const value of mean) {
    const rounded = Math.round((value - low) * scale * 100) / 100;
    heights.push(rounded);
    if (rounded < min) min = rounded;
    if (rounded > max) max = rounded;
  }
  const field: Heightfield = {
    format: HEIGHTFIELD_FORMAT,
    w: cells,
    h: cells,
    metersPerCell,
    minM: min,
    maxM: max,
    heights,
  };
  return { field, scale, heightOffsetM: low, filledCells };
}

// sRGB <-> lineair, met tabel voor de bytes.
const SRGB_TO_LINEAR = new Float64Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

export function linearToSrgbByte(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

export function hexOfLinear(rgb: readonly [number, number, number]): string {
  return '#' + rgb.map((c) => linearToSrgbByte(c).toString(16).padStart(2, '0')).join('');
}

function sampleBilinearLinear(
  texture: NonNullable<TerrainMaterial['texture']>,
  u: number,
  v: number,
  out: [number, number, number],
): void {
  const { width, height, data } = texture;
  const fx = Math.min(Math.max(u * width - 0.5, 0), width - 1);
  const fy = Math.min(Math.max(v * height - 0.5, 0), height - 1);
  const x0 = Math.min(Math.floor(fx), width - 2 < 0 ? 0 : width - 2);
  const y0 = Math.min(Math.floor(fy), height - 2 < 0 ? 0 : height - 2);
  const tx = width > 1 ? fx - x0 : 0;
  const ty = height > 1 ? fy - y0 : 0;
  for (let c = 0; c < 3; c++) {
    const px = (x: number, y: number): number =>
      SRGB_TO_LINEAR[
        data[(Math.min(y, height - 1) * width + Math.min(x, width - 1)) * 3 + c] as number
      ] as number;
    const top = px(x0, y0) * (1 - tx) + px(x0 + 1, y0) * tx;
    const bottom = px(x0, y0 + 1) * (1 - tx) + px(x0 + 1, y0 + 1) * tx;
    out[c] = top * (1 - ty) + bottom * ty;
  }
}

export interface AlbedoResult {
  /** RGB, 3 bytes per pixel, sRGB, `resolution` x `resolution`, rij 0 is de kleinste z. */
  rgb: Uint8Array;
  /** Gemiddelde kleur van de gedekte pixels, lineair. */
  meanLinear: [number, number, number];
  coveredFraction: number;
}

/**
 * Bakt de kleur van het bovenste oppervlak naar een bovenaanzicht: per monster de diffuse (sRGB naar lineair,
 * maal de basiskleur-factor, terug naar sRGB). Monsters zonder dekking (gaten, bijvoorbeeld waar een zwevend deel is
 * weggehaald) worden opgevuld met pull-push (fillHolesPullPush): een zachte overgang tussen de gedekte randen, zonder
 * de kruis- en streepvormen van ring-voor-ring opvullen met vier buren. Zonder enige dekking: de gemiddelde kleur.
 */
export function bakeAlbedo(mesh: TerrainMesh, surface: TopSurface): AlbedoResult {
  const n = surface.resolution;
  const count = n * n;
  const linear = new Float32Array(count * 3);
  const known = new Uint8Array(count);
  const colour: [number, number, number] = [0, 0, 0];
  const sum = [0, 0, 0];
  let covered = 0;
  for (let index = 0; index < count; index++) {
    const t = surface.tri[index] as number;
    if (t < 0) continue;
    const material = mesh.materials?.[mesh.triMaterial?.[t] ?? 0];
    const factor = material?.factor ?? [1, 1, 1];
    if (material?.texture && mesh.uvs)
      sampleBilinearLinear(
        material.texture,
        surface.u[index] as number,
        surface.v[index] as number,
        colour,
      );
    else colour.fill(1);
    for (let c = 0; c < 3; c++) {
      const value = (colour[c] as number) * (factor[c] as number);
      linear[index * 3 + c] = value;
      sum[c] = (sum[c] as number) + value;
    }
    known[index] = 1;
    covered++;
  }
  const mean: [number, number, number] = [
    covered ? (sum[0] as number) / covered : 0,
    covered ? (sum[1] as number) / covered : 0,
    covered ? (sum[2] as number) / covered : 0,
  ];

  if (covered > 0 && covered < count) {
    fillHolesPullPush(linear, known, n);
    known.fill(1);
  }

  const rgb = new Uint8Array(count * 3);
  for (let index = 0; index < count; index++) {
    for (let c = 0; c < 3; c++) {
      rgb[index * 3 + c] = linearToSrgbByte(
        known[index] ? (linear[index * 3 + c] as number) : (mean[c] as number),
      );
    }
  }
  return { rgb, meanLinear: mean, coveredFraction: covered / count };
}

/**
 * Vult de gaten (known 0) van een n x n RGB-raster (lineair, 3 floats per pixel) met pull-push: een piramide van
 * gemiddelden van de gedekte pixels (pull), daarna van grof naar fijn elk gat bilineair uit het niveau erboven (push).
 * Gedekte pixels blijven exact gelijk. Vraagt minstens één gedekte pixel.
 */
export function fillHolesPullPush(linear: Float32Array, known: Uint8Array, n: number): void {
  const levels: { size: number; rgb: Float32Array; w: Float32Array }[] = [];
  const w0 = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) w0[i] = known[i] ? 1 : 0;
  levels.push({ size: n, rgb: linear, w: w0 });
  // Pull: elk niveau het gewogen gemiddelde van 2 x 2 pixels van het niveau eronder.
  while ((levels[levels.length - 1] as { size: number }).size > 1) {
    const fine = levels[levels.length - 1] as { size: number; rgb: Float32Array; w: Float32Array };
    const size = Math.ceil(fine.size / 2);
    const rgb = new Float32Array(size * size * 3);
    const w = new Float32Array(size * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let sw = 0;
        const acc = [0, 0, 0];
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const fx = 2 * x + dx;
            const fy = 2 * y + dy;
            if (fx >= fine.size || fy >= fine.size) continue;
            const fi = fy * fine.size + fx;
            const fw = fine.w[fi] as number;
            if (fw <= 0) continue;
            sw += fw;
            for (let c = 0; c < 3; c++)
              acc[c] = (acc[c] as number) + (fine.rgb[fi * 3 + c] as number) * fw;
          }
        const i = y * size + x;
        if (sw > 0) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = (acc[c] as number) / sw;
        w[i] = Math.min(1, sw);
      }
    levels.push({ size, rgb, w });
  }
  // Push: van grof naar fijn; een gat krijgt het bilineaire monster van het (al gevulde) niveau erboven.
  for (let l = levels.length - 2; l >= 0; l--) {
    const fine = levels[l] as { size: number; rgb: Float32Array; w: Float32Array };
    const coarse = levels[l + 1] as { size: number; rgb: Float32Array; w: Float32Array };
    const at = (x: number, y: number, c: number): number => {
      const cx = Math.min(coarse.size - 1, Math.max(0, x));
      const cy = Math.min(coarse.size - 1, Math.max(0, y));
      return coarse.rgb[(cy * coarse.size + cx) * 3 + c] as number;
    };
    for (let y = 0; y < fine.size; y++)
      for (let x = 0; x < fine.size; x++) {
        const i = y * fine.size + x;
        if ((fine.w[i] as number) >= 1) continue;
        const gx = (x + 0.5) / 2 - 0.5;
        const gy = (y + 0.5) / 2 - 0.5;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const tx = gx - x0;
        const ty = gy - y0;
        const own = fine.w[i] as number;
        for (let c = 0; c < 3; c++) {
          const up =
            (at(x0, y0, c) * (1 - tx) + at(x0 + 1, y0, c) * tx) * (1 - ty) +
            (at(x0, y0 + 1, c) * (1 - tx) + at(x0 + 1, y0 + 1, c) * tx) * ty;
          fine.rgb[i * 3 + c] =
            own > 0 ? (fine.rgb[i * 3 + c] as number) * own + up * (1 - own) : up;
        }
        fine.w[i] = 1;
      }
  }
}

/**
 * Houdt alleen driehoeken met een diffuse-textuur: het terreinoppervlak zelf. De driehoeken van het Base-materiaal
 * (effen kleur) zijn de platte voet en rand van het diorama en horen niet bij het speelveld.
 */
export function texturedOnly(mesh: TerrainMesh): TerrainMesh {
  if (!mesh.materials || !mesh.triMaterial) return mesh;
  const keep: number[] = [];
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    if (mesh.materials[mesh.triMaterial[t] as number]?.texture) keep.push(t);
  }
  return selectTriangles(mesh, keep);
}

export function selectTriangles(mesh: TerrainMesh, keep: number[]): TerrainMesh {
  const indices = new Uint32Array(keep.length * 3);
  const triMaterial = mesh.triMaterial ? new Uint16Array(keep.length) : undefined;
  keep.forEach((t, k) => {
    indices[k * 3] = mesh.indices[t * 3] as number;
    indices[k * 3 + 1] = mesh.indices[t * 3 + 1] as number;
    indices[k * 3 + 2] = mesh.indices[t * 3 + 2] as number;
    if (triMaterial && mesh.triMaterial) triMaterial[k] = mesh.triMaterial[t] as number;
  });
  return { ...mesh, indices, triMaterial };
}

export interface FloaterOptions {
  /** Cel van het controleraster in bronmeters. */
  cellM: number;
  /** Straal (bronmeters) van de opening: alles dat smaller is dan 2 * radius en hoger uitsteekt dan de drempel gaat weg. */
  radiusM: number;
  /** Hoogte (bronmeters) boven de opening vanaf waar een vertex als zwevend deel geldt. */
  thresholdM: number;
}
