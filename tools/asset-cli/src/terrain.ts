// Terrein-buis: bronmesh (GLB, bijvoorbeeld Rock Terrain 4) naar een hoogteveld en een bovenaanzicht-albedo.
// De kern (rasterizeTopSurface, heightfieldFromSurface, bakeAlbedo) werkt op platte arrays en heeft geen IO,
// zodat hij met synthetische terreinen te testen is. Alleen buildTerrain leest en schrijft bestanden.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO, type Material } from '@gltf-transform/core';
import sharp from 'sharp';
import {
  HEIGHTFIELD_FORMAT,
  TERRAIN_MANIFEST_FORMAT,
  heightfieldSchema,
  terrainManifestSchema,
  type Heightfield,
  type TerrainManifest,
} from './heightfield.js';

/** Een bronmateriaal: lineaire basiskleur-factor (glTF) en eventueel een sRGB-diffuse. */
export interface TerrainMaterial {
  factor: [number, number, number];
  texture?: { width: number; height: number; /** RGB, 3 bytes per pixel, sRGB. */ data: Uint8Array };
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
          v[index] = l0 * (uvs[j0 + 1] as number) + l1 * (uvs[j1 + 1] as number) + l2 * (uvs[j2 + 1] as number);
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
        for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
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
  if (mean.some((value) => Number.isNaN(value))) throw new Error('het terrein dekt de uitsnede niet (geen enkele cel)');

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
  const field: Heightfield = { format: HEIGHTFIELD_FORMAT, w: cells, h: cells, metersPerCell, minM: min, maxM: max, heights };
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
    const px = (x: number, y: number): number => SRGB_TO_LINEAR[data[(Math.min(y, height - 1) * width + Math.min(x, width - 1)) * 3 + c] as number] as number;
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
 * weggehaald) worden ring voor ring opgevuld met het gemiddelde van hun gedekte buren; wat dan nog overblijft
 * (geen enkel gedekt monster in de buurt) krijgt de gemiddelde kleur.
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
    if (material?.texture && mesh.uvs) sampleBilinearLinear(material.texture, surface.u[index] as number, surface.v[index] as number, colour);
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

  let open = count - covered;
  for (let pass = 0; open > 0 && pass < 256; pass++) {
    const grown: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const index = j * n + i;
        if (known[index]) continue;
        let found = 0;
        const acc = [0, 0, 0];
        for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= n || nj >= n || !known[nj * n + ni]) continue;
          found++;
          for (let c = 0; c < 3; c++) acc[c] = (acc[c] as number) + (linear[(nj * n + ni) * 3 + c] as number);
        }
        if (found === 0) continue;
        for (let c = 0; c < 3; c++) linear[index * 3 + c] = (acc[c] as number) / found;
        grown.push(index);
      }
    }
    for (const index of grown) known[index] = 1;
    open -= grown.length;
    if (grown.length === 0) break;
  }

  const rgb = new Uint8Array(count * 3);
  for (let index = 0; index < count; index++) {
    for (let c = 0; c < 3; c++) {
      rgb[index * 3 + c] = linearToSrgbByte(known[index] ? (linear[index * 3 + c] as number) : (mean[c] as number));
    }
  }
  return { rgb, meanLinear: mean, coveredFraction: covered / count };
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

function selectTriangles(mesh: TerrainMesh, keep: number[]): TerrainMesh {
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

export interface FloaterResult {
  mesh: TerrainMesh;
  removedTriangles: number;
}

/**
 * Fotogrammetrie laat zwevende schijfjes achter (een paar meter breed, tot 10 m boven de grond); het "hoogste z per
 * cel" zou daar op blijven steken. Dit haalt ze weg met een morfologische opening (erosie en dan dilatatie, op een
 * raster van `cellM`) van het bovenste oppervlak: een driehoek met een vertex meer dan `thresholdM` boven die opening
 * valt weg, waarna de grond eronder zichtbaar wordt. Brede vormen (kliffen, heuvels) blijven staan.
 */
export function removeFloaters(mesh: TerrainMesh, options: FloaterOptions): FloaterResult {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minX = Math.min(minX, mesh.positions[i] as number);
    maxX = Math.max(maxX, mesh.positions[i] as number);
    minZ = Math.min(minZ, mesh.positions[i + 2] as number);
    maxZ = Math.max(maxZ, mesh.positions[i + 2] as number);
  }
  const { cellM, radiusM, thresholdM } = options;
  const nx = Math.ceil((maxX - minX) / cellM) + 1;
  const nz = Math.ceil((maxZ - minZ) / cellM) + 1;
  const top = rasterizeTopSurface(mesh, { minX, minZ, sizeM: Math.max(nx, nz) * cellM, resolution: Math.max(nx, nz) });
  const n = top.resolution;
  const r = Math.max(1, Math.round(radiusM / cellM));

  const windowFilter = (input: Float32Array, pick: (a: number, b: number) => number): Float32Array => {
    const horizontal = new Float32Array(n * n).fill(NaN);
    const output = new Float32Array(n * n).fill(NaN);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let acc = NaN;
        for (let d = -r; d <= r; d++) {
          const x = i + d;
          if (x < 0 || x >= n) continue;
          const value = input[j * n + x] as number;
          if (!Number.isNaN(value)) acc = Number.isNaN(acc) ? value : pick(acc, value);
        }
        horizontal[j * n + i] = acc;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let acc = NaN;
        for (let d = -r; d <= r; d++) {
          const z = j + d;
          if (z < 0 || z >= n) continue;
          const value = horizontal[z * n + i] as number;
          if (!Number.isNaN(value)) acc = Number.isNaN(acc) ? value : pick(acc, value);
        }
        output[j * n + i] = acc;
      }
    }
    return output;
  };
  const opened = windowFilter(windowFilter(top.height, Math.min), Math.max);

  const cellOf = (x: number, z: number): number => {
    const i = Math.min(n - 1, Math.max(0, Math.floor((x - minX) / cellM)));
    const j = Math.min(n - 1, Math.max(0, Math.floor((z - minZ) / cellM)));
    return j * n + i;
  };
  // Cellen met een zwevende vertex, plus één cel rondom: daar valt ook de uitloper van de rand (meer dan een kwart
  // van de drempel boven de opening) weg, maar de grond zelf (op of vlak boven de opening) niet.
  const flagged = new Uint8Array(n * n);
  const floating = new Uint8Array(mesh.positions.length / 3);
  for (let v = 0; v < floating.length; v++) {
    const cell = cellOf(mesh.positions[v * 3] as number, mesh.positions[v * 3 + 2] as number);
    const reference = opened[cell] as number;
    if (Number.isNaN(reference) || (mesh.positions[v * 3 + 1] as number) <= reference + thresholdM) continue;
    floating[v] = 1;
    const ci = cell % n;
    const cj = (cell - ci) / n;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni >= 0 && nj >= 0 && ni < n && nj < n) flagged[nj * n + ni] = 1;
      }
    }
  }
  for (let v = 0; v < floating.length; v++) {
    if (floating[v]) continue;
    const cell = cellOf(mesh.positions[v * 3] as number, mesh.positions[v * 3 + 2] as number);
    if (flagged[cell] && (mesh.positions[v * 3 + 1] as number) > (opened[cell] as number) + thresholdM / 4) floating[v] = 1;
  }
  const keep: number[] = [];
  const triCount = mesh.indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    if (floating[mesh.indices[t * 3] as number] || floating[mesh.indices[t * 3 + 1] as number] || floating[mesh.indices[t * 3 + 2] as number]) continue;
    keep.push(t);
  }
  return { mesh: selectTriangles(mesh, keep), removedTriangles: triCount - keep.length };
}

/** Draait de mesh om de y-as (graden); x' = cos * x - sin * z, z' = sin * x + cos * z. */
export function rotateMeshY(mesh: TerrainMesh, degrees: number): TerrainMesh {
  if (degrees === 0) return mesh;
  const angle = (degrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const positions = Float32Array.from(mesh.positions);
  for (let i = 0; i < positions.length; i += 3) {
    const x = mesh.positions[i] as number;
    const z = mesh.positions[i + 2] as number;
    positions[i] = c * x - s * z;
    positions[i + 2] = s * x + c * z;
  }
  return { ...mesh, positions };
}

export interface CropChoice {
  /** Draaiing van de bron om de y-as (graden) vóór de uitsnede; zie rotateMeshY. */
  rotationDeg: number;
  /** Linker-achterhoek van de uitsnede in de gedraaide bronruimte (meters). */
  minX: number;
  minZ: number;
  /** Zijde van het vierkant in bronmeters. */
  sizeM: number;
  /** Reliefscore (standaardafwijking van de hoogte op 1 m-raster) van de gekozen uitsnede. */
  score: number;
}

export interface CropSearch {
  sizeM: number;
  /** Te proberen draaihoeken (graden). */
  rotationsDeg: number[];
  /** Minimale dekking (0 tot 1) van de uitsnede door de mesh. */
  minCoverage: number;
}

/**
 * Kiest het vierkant met de meeste reliëfvariatie (standaardafwijking van de bovenste oppervlakte-hoogte, op een
 * raster van 1 m) over alle draaihoeken en posities (stappen van 1 m) die voor minstens `minCoverage` door de mesh
 * gedekt zijn. Met sommatabellen, dus een kandidaat kost O(1). Bij gelijke score wint de eerste (kleinste hoek, dan z, dan x).
 * De dekking wordt gemeten op `footprint` (standaard dezelfde mesh): gaten die later worden opgevuld, zoals waar een
 * zwevend deel is weggehaald, tellen dan niet als "buiten het terrein".
 */
export function chooseCrop(mesh: TerrainMesh, search: CropSearch, footprint: TerrainMesh = mesh): CropChoice {
  const size = Math.round(search.sizeM);
  let best: CropChoice | undefined;
  for (const rotationDeg of search.rotationsDeg) {
    const rotated = rotateMeshY(mesh, rotationDeg);
    const rotatedFootprint = footprint === mesh ? rotated : rotateMeshY(footprint, rotationDeg);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < rotated.positions.length; i += 3) {
      minX = Math.min(minX, rotated.positions[i] as number);
      maxX = Math.max(maxX, rotated.positions[i] as number);
      minZ = Math.min(minZ, rotated.positions[i + 2] as number);
      maxZ = Math.max(maxZ, rotated.positions[i + 2] as number);
    }
    const x0 = Math.floor(minX);
    const z0 = Math.floor(minZ);
    const n = Math.ceil(Math.max(maxX - x0, maxZ - z0));
    const overview = rasterizeTopSurface(rotated, { minX: x0, minZ: z0, sizeM: n, resolution: n });
    const outline = rotatedFootprint === rotated ? overview : rasterizeTopSurface(rotatedFootprint, { minX: x0, minZ: z0, sizeM: n, resolution: n });
    const stride = n + 1;
    const cover = new Float64Array(stride * stride);
    const valid = new Float64Array(stride * stride);
    const sum = new Float64Array(stride * stride);
    const sumSq = new Float64Array(stride * stride);
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const value = overview.height[b * n + a] as number;
        const ok = Number.isNaN(value) ? 0 : 1;
        const inside = Number.isNaN(outline.height[b * n + a] as number) ? 0 : 1;
        const at = (b + 1) * stride + a + 1;
        const up = b * stride + a + 1;
        const left = (b + 1) * stride + a;
        const diagonal = b * stride + a;
        cover[at] = (cover[up] as number) + (cover[left] as number) - (cover[diagonal] as number) + inside;
        valid[at] = (valid[up] as number) + (valid[left] as number) - (valid[diagonal] as number) + ok;
        sum[at] = (sum[up] as number) + (sum[left] as number) - (sum[diagonal] as number) + (ok ? value : 0);
        sumSq[at] = (sumSq[up] as number) + (sumSq[left] as number) - (sumSq[diagonal] as number) + (ok ? value * value : 0);
      }
    }
    const box = (table: Float64Array, ox: number, oz: number): number =>
      (table[(oz + size) * stride + ox + size] as number) - (table[oz * stride + ox + size] as number) - (table[(oz + size) * stride + ox] as number) + (table[oz * stride + ox] as number);
    for (let oz = 0; oz + size <= n; oz++) {
      for (let ox = 0; ox + size <= n; ox++) {
        const covered = box(cover, ox, oz);
        if (covered < search.minCoverage * size * size) continue;
        const count = box(valid, ox, oz);
        if (count === 0) continue;
        const mean = box(sum, ox, oz) / count;
        const score = Math.sqrt(Math.max(0, box(sumSq, ox, oz) / count - mean * mean));
        if (!best || score > best.score + 1e-9) best = { rotationDeg, minX: x0 + ox, minZ: z0 + oz, sizeM: size, score };
      }
    }
  }
  if (!best) throw new Error(`geen vierkant van ${size} m dat de mesh voor ${search.minCoverage * 100}% dekt`);
  return best;
}

/** Leest alle driehoeksmeshes uit een GLB met node-transformaties toegepast (wereldmatrix, dus ook Z-up naar Y-up). */
export async function readTerrainMesh(glbPath: string): Promise<TerrainMesh> {
  const document = await new NodeIO().read(glbPath);
  const materials: TerrainMaterial[] = [];
  const materialIndex = new Map<unknown, number>();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const triMaterial: number[] = [];
  let hasUvs = true;

  async function materialOf(primitiveMaterial: Material | null): Promise<number> {
    if (materialIndex.has(primitiveMaterial)) return materialIndex.get(primitiveMaterial) as number;
    const factor = primitiveMaterial ? primitiveMaterial.getBaseColorFactor() : [1, 1, 1, 1];
    const entry: TerrainMaterial = { factor: [factor[0] as number, factor[1] as number, factor[2] as number] };
    const image = primitiveMaterial?.getBaseColorTexture()?.getImage();
    if (image) {
      const decoded = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      entry.texture = { width: decoded.info.width, height: decoded.info.height, data: new Uint8Array(decoded.data) };
    }
    materials.push(entry);
    materialIndex.set(primitiveMaterial, materials.length - 1);
    return materials.length - 1;
  }

  const nodes = document.getRoot().listNodes();
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4) continue;
      const position = primitive.getAttribute('POSITION');
      const index = primitive.getIndices();
      if (!position || !index) continue;
      const uv = primitive.getAttribute('TEXCOORD_0');
      if (!uv) hasUvs = false;
      const base = positions.length / 3;
      const p: number[] = [0, 0, 0];
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, p);
        const x = p[0] as number;
        const y = p[1] as number;
        const z = p[2] as number;
        positions.push(
          (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
          (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
          (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
        );
        if (uv) {
          const q: number[] = [0, 0];
          uv.getElement(i, q);
          uvs.push(q[0] as number, q[1] as number);
        } else uvs.push(0, 0);
      }
      const material = await materialOf(primitive.getMaterial());
      const triangles = index.getCount() / 3;
      for (let t = 0; t < triangles; t++) {
        for (let k = 0; k < 3; k++) indices.push(base + (index.getScalar(t * 3 + k)));
        triMaterial.push(material);
      }
    }
  }
  if (indices.length === 0) throw new Error(`${glbPath}: geen driehoeken gevonden`);
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    uvs: hasUvs ? Float32Array.from(uvs) : undefined,
    triMaterial: Uint16Array.from(triMaterial),
    materials,
  };
}

export interface BuildTerrainOptions {
  /** Pad naar de bron-GLB (staat buiten git). */
  source: string;
  /** Doelmap, bijvoorbeeld assets/dist/terrain. */
  outDir: string;
  /** Bestandsnaam zonder extensie; ook het id in het terrein-manifest. */
  id: string;
  attribution: string;
  /** Zijde van de uitsnede in bronmeters (standaard 64: schaal precies 2 naar 128 m). */
  cropSizeM?: number | undefined;
  /** Alleen deze draaihoeken proberen (graden); standaard 0 tot 89 in stappen van 1. */
  rotationsDeg?: number[] | undefined;
  cells?: number;
  metersPerCell?: number;
  /** Monsters per cel per zijde (hoogte wordt het gemiddelde van sub x sub monsters; het albedo is cells * sub pixels). */
  sub?: number;
  jpegQuality?: number;
}

export interface BuildTerrainResult {
  manifest: TerrainManifest;
  crop: CropChoice;
  field: Heightfield;
  filledCells: number;
  removedTriangles: number;
  coveredFraction: number;
  files: { path: string; bytes: number }[];
}

/** Zwevende delen: opening met straal 3 m, drempel 4 m (zie removeFloaters). */
export const FLOATER_DEFAULTS: FloaterOptions = { cellM: 0.5, radiusM: 3, thresholdM: 4 };

export async function buildTerrain(options: BuildTerrainOptions): Promise<BuildTerrainResult> {
  const cells = options.cells ?? 128;
  const metersPerCell = options.metersPerCell ?? 1;
  const sub = options.sub ?? 8;
  const raw = await readTerrainMesh(options.source);
  const groundMaterial = raw.materials?.find((m) => !m.texture) ?? { factor: [0.05, 0.05, 0.05] as [number, number, number] };

  const surfaceMesh = texturedOnly(raw);
  const cleaned = removeFloaters(surfaceMesh, FLOATER_DEFAULTS);
  const crop = chooseCrop(
    cleaned.mesh,
    {
      sizeM: options.cropSizeM ?? 64,
      rotationsDeg: options.rotationsDeg ?? Array.from({ length: 90 }, (_, i) => i),
      minCoverage: 0.99,
    },
    surfaceMesh,
  );
  const mesh = rotateMeshY(cleaned.mesh, crop.rotationDeg);

  const surface = rasterizeTopSurface(mesh, { minX: crop.minX, minZ: crop.minZ, sizeM: crop.sizeM, resolution: cells * sub });
  const { field, scale, heightOffsetM, filledCells } = heightfieldFromSurface(surface, { cells, metersPerCell });
  heightfieldSchema.parse(field);

  const albedo = bakeAlbedo(mesh, surface);
  const albedoBytes = await sharp(albedo.rgb, { raw: { width: surface.resolution, height: surface.resolution, channels: 3 } })
    .jpeg({ quality: options.jpegQuality ?? 85, chromaSubsampling: '4:4:4', mozjpeg: false })
    .toBuffer();

  const heightPath = `${options.id}.height.json`;
  const albedoPath = `${options.id}.albedo.jpg`;
  const manifest: TerrainManifest = terrainManifestSchema.parse({
    format: TERRAIN_MANIFEST_FORMAT,
    id: options.id,
    attribution: options.attribution,
    heightfield: { path: heightPath, w: field.w, h: field.h, metersPerCell, minM: field.minM, maxM: field.maxM },
    albedo: { path: albedoPath, width: surface.resolution, height: surface.resolution, mime: 'image/jpeg' },
    rockTint: hexOfLinear(albedo.meanLinear),
    groundTint: hexOfLinear(groundMaterial.factor),
    crop: {
      rotationDeg: crop.rotationDeg,
      minX: crop.minX,
      minZ: crop.minZ,
      sizeM: crop.sizeM,
      scale: Math.round(scale * 1e6) / 1e6,
      heightOffsetM: Math.round(heightOffsetM * 1e4) / 1e4,
    },
  });

  mkdirSync(options.outDir, { recursive: true });
  const outputs: [string, Uint8Array | string][] = [
    [heightPath, formatHeightfield(field)],
    [albedoPath, albedoBytes],
    ['terrain.json', JSON.stringify(manifest, null, 2) + '\n'],
  ];
  const files = outputs.map(([name, data]) => {
    writeFileSync(join(options.outDir, name), data);
    return { path: name, bytes: typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength };
  });
  return { manifest, crop, field, filledCells, removedTriangles: cleaned.removedTriangles, coveredFraction: albedo.coveredFraction, files };
}

/** JSON met één rij per regel: klein en leesbaar in diffs. */
export function formatHeightfield(field: Heightfield): string {
  const rows: string[] = [];
  for (let j = 0; j < field.h; j++) {
    rows.push('    ' + field.heights.slice(j * field.w, (j + 1) * field.w).map((value) => String(value)).join(','));
  }
  return (
    `{"format":"${field.format}","w":${field.w},"h":${field.h},"metersPerCell":${field.metersPerCell},` +
    `"minM":${field.minM},"maxM":${field.maxM},\n  "heights":[\n${rows.join(',\n')}\n  ]}\n`
  );
}
