// Split from terrain.ts to stay under the 5,000-token file limit; terrain.ts re-exports the public surface.
// Holds: FloaterResult, removeFloaters, rotateMeshY, CropChoice, CropSearch, chooseCrop, +5 more.
import { NodeIO, type Material } from '@gltf-transform/core';
import sharp from 'sharp';
import type { TerrainManifest, Heightfield } from './heightfield.js';
import { rasterizeTopSurface, selectTriangles } from './terrain.part1.js';
import type { FloaterOptions, TerrainMaterial, TerrainMesh } from './terrain.part1.js';

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
  const top = rasterizeTopSurface(mesh, {
    minX,
    minZ,
    sizeM: Math.max(nx, nz) * cellM,
    resolution: Math.max(nx, nz),
  });
  const n = top.resolution;
  const r = Math.max(1, Math.round(radiusM / cellM));

  const windowFilter = (
    input: Float32Array,
    pick: (a: number, b: number) => number,
  ): Float32Array => {
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
    if (Number.isNaN(reference) || (mesh.positions[v * 3 + 1] as number) <= reference + thresholdM)
      continue;
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
    if (
      flagged[cell] &&
      (mesh.positions[v * 3 + 1] as number) > (opened[cell] as number) + thresholdM / 4
    )
      floating[v] = 1;
  }
  const keep: number[] = [];
  const triCount = mesh.indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    if (
      floating[mesh.indices[t * 3] as number] ||
      floating[mesh.indices[t * 3 + 1] as number] ||
      floating[mesh.indices[t * 3 + 2] as number]
    )
      continue;
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
export function chooseCrop(
  mesh: TerrainMesh,
  search: CropSearch,
  footprint: TerrainMesh = mesh,
): CropChoice {
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
    const outline =
      rotatedFootprint === rotated
        ? overview
        : rasterizeTopSurface(rotatedFootprint, { minX: x0, minZ: z0, sizeM: n, resolution: n });
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
        cover[at] =
          (cover[up] as number) + (cover[left] as number) - (cover[diagonal] as number) + inside;
        valid[at] =
          (valid[up] as number) + (valid[left] as number) - (valid[diagonal] as number) + ok;
        sum[at] =
          (sum[up] as number) +
          (sum[left] as number) -
          (sum[diagonal] as number) +
          (ok ? value : 0);
        sumSq[at] =
          (sumSq[up] as number) +
          (sumSq[left] as number) -
          (sumSq[diagonal] as number) +
          (ok ? value * value : 0);
      }
    }
    const box = (table: Float64Array, ox: number, oz: number): number =>
      (table[(oz + size) * stride + ox + size] as number) -
      (table[oz * stride + ox + size] as number) -
      (table[(oz + size) * stride + ox] as number) +
      (table[oz * stride + ox] as number);
    for (let oz = 0; oz + size <= n; oz++) {
      for (let ox = 0; ox + size <= n; ox++) {
        const covered = box(cover, ox, oz);
        if (covered < search.minCoverage * size * size) continue;
        const count = box(valid, ox, oz);
        if (count === 0) continue;
        const mean = box(sum, ox, oz) / count;
        const score = Math.sqrt(Math.max(0, box(sumSq, ox, oz) / count - mean * mean));
        if (!best || score > best.score + 1e-9)
          best = { rotationDeg, minX: x0 + ox, minZ: z0 + oz, sizeM: size, score };
      }
    }
  }
  if (!best)
    throw new Error(
      `geen vierkant van ${size} m dat de mesh voor ${search.minCoverage * 100}% dekt`,
    );
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
    const entry: TerrainMaterial = {
      factor: [factor[0] as number, factor[1] as number, factor[2] as number],
    };
    const image = primitiveMaterial?.getBaseColorTexture()?.getImage();
    if (image) {
      const decoded = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      entry.texture = {
        width: decoded.info.width,
        height: decoded.info.height,
        data: new Uint8Array(decoded.data),
      };
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
        for (let k = 0; k < 3; k++) indices.push(base + index.getScalar(t * 3 + k));
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
  /**
   * Zijde van het albedo in pixels, los van het hoogteveld (standaard cells * sub, 1024). De kleur wordt dan op een
   * eigen raster van die maat gebakken; het hoogteveld blijft gelijk. 2048 geeft 16 px per meter op de map.
   */
  albedoSize?: number | undefined;
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

/** JSON met één rij per regel: klein en leesbaar in diffs. */
export function formatHeightfield(field: Heightfield): string {
  const rows: string[] = [];
  for (let j = 0; j < field.h; j++) {
    rows.push(
      '    ' +
        field.heights
          .slice(j * field.w, (j + 1) * field.w)
          .map((value) => String(value))
          .join(','),
    );
  }
  return (
    `{"format":"${field.format}","w":${field.w},"h":${field.h},"metersPerCell":${field.metersPerCell},` +
    `"minM":${field.minM},"maxM":${field.maxM},\n  "heights":[\n${rows.join(',\n')}\n  ]}\n`
  );
}
