// Split from buildings.ts to stay under the 5,000-token file limit; buildings.ts re-exports the public surface.
// Holds: SourceMaterial, SourceHouse, SourceOptions, transformFromMatrix4, loadSourceHouse, extent, +11 more.
import {
  type Mesh,
  type Vec3,
  type Transform,
  inverseTranspose3,
  transformMesh,
  componentsInside,
  selectTriangles,
  largestComponents,
  makeTransform,
  MeshAccumulator,
  compact,
} from './geometry.js';
import { createIO } from './lods.js';
import { readFileSync } from 'node:fs';
import { PBRSpecularGlossiness } from '@gltf-transform/extensions';
import { type Texture, Document, Logger } from '@gltf-transform/core';
import { BUDGETS } from './budgets.js';
import type { HousePart, VariantPart, VariantsConfig, VariantDef } from './variants.js';
import {
  makeBevelBox,
  makeBoxUv,
  makeBoxOpen,
  makeCylinderClean,
  makeCone,
  makePrism,
  makeTrack,
  makeCorrugated,
  makeTube,
  makeSphere,
} from './shapes.js';
import { withUv } from './uvmap.js';
import { surfaceKindOfName, surfaceMaps } from './surfaceTex.js';

/** Een materiaal van het bron-huisje, omgezet van spec-gloss naar basiskleur plus textuur. */
interface SourceMaterial {
  diffuse: [number, number, number];
  texture: { image: Uint8Array; mimeType: string; name: string } | null;
  doubleSided: boolean;
}

/** Het bron-huisje: platgeslagen (alle node-transformaties in de vertices) per bronmateriaal. */
export interface SourceHouse {
  meshes: { material: string; mesh: Mesh }[];
  materials: Map<string, SourceMaterial>;
  /** Wereldschaal: meters per bron-eenheid (variants.json `sources.<id>.metersPerUnit`). */
  metersPerUnit: number;
}

/** Hoe een bron geladen wordt: de wereldschaal en eventueel het blok waarbinnen de delen van het huis liggen. */
export interface SourceOptions {
  metersPerUnit: number;
  keep?: { min: Vec3; max: Vec3 } | undefined;
}

/** Transform uit een column-major 4x4 matrix (node-wereldmatrix van het bronmodel). */
export function transformFromMatrix4(matrix: ArrayLike<number>): Transform {
  const m = [
    matrix[0]!,
    matrix[4]!,
    matrix[8]!,
    matrix[1]!,
    matrix[5]!,
    matrix[9]!,
    matrix[2]!,
    matrix[6]!,
    matrix[10]!,
  ];
  const determinant =
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
  if (Math.abs(determinant) < 1e-12)
    throw new Error('bron-GLB bevat een ontaarde node-transformatie');
  return { m, n: inverseTranspose3(m), t: [matrix[12]!, matrix[13]!, matrix[14]!] };
}

/** Leest een bron-GLB en slaat alle node-transformaties plat in de vertices; spec-gloss wordt basiskleur plus textuur. */
export async function loadSourceHouse(file: string, options: SourceOptions): Promise<SourceHouse> {
  const io = createIO();
  const document = await io.readBinary(new Uint8Array(readFileSync(file)));
  const materials = new Map<string, SourceMaterial>();
  const meshes: SourceHouse['meshes'] = [];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const transform = transformFromMatrix4(node.getWorldMatrix());
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4) continue;
      const material = primitive.getMaterial();
      const position = primitive.getAttribute('POSITION');
      const normal = primitive.getAttribute('NORMAL');
      const uv = primitive.getAttribute('TEXCOORD_0');
      const indices = primitive.getIndices();
      if (!material || !position || !normal || !uv || !indices)
        throw new Error(
          `bron-primitive in "${mesh.getName()}" mist materiaal, POSITION, NORMAL, TEXCOORD_0 of indices`,
        );
      const name = material.getName();
      if (!materials.has(name)) {
        const specGloss = material.getExtension<PBRSpecularGlossiness>(
          'KHR_materials_pbrSpecularGlossiness',
        );
        const factor = specGloss?.getDiffuseFactor() ?? material.getBaseColorFactor();
        const texture: Texture | null =
          specGloss?.getDiffuseTexture() ?? material.getBaseColorTexture();
        const image = texture?.getImage();
        materials.set(name, {
          diffuse: [factor[0]!, factor[1]!, factor[2]!],
          texture:
            texture && image
              ? {
                  image,
                  mimeType: texture.getMimeType(),
                  name: texture.getName() || texture.getURI(),
                }
              : null,
          doubleSided: material.getDoubleSided(),
        });
      }
      const raw: Mesh = {
        positions: new Float32Array(position.getArray()!),
        normals: new Float32Array(normal.getArray()!),
        uvs: new Float32Array(uv.getArray()!),
        indices: new Uint32Array(indices.getArray()!),
      };
      let placed = transformMesh(raw, transform);
      if (options.keep)
        placed = componentsInside(
          placed,
          options.keep.min,
          options.keep.max,
          BUDGETS.buildingWeldDistance,
        );
      if (placed.indices.length > 0) meshes.push({ material: name, mesh: placed });
    }
  }
  if (meshes.length === 0) throw new Error(`geen meshes in bron-GLB ${file}`);
  return { meshes, materials, metersPerUnit: options.metersPerUnit };
}

function extent(positions: Float32Array): { min: Vec3; max: Vec3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, positions[i + k]!);
      max[k] = Math.max(max[k]!, positions[i + k]!);
    }
  return { min, max };
}

/** Selecteert uit het bron-huisje wat `part.select` vraagt, per bronmateriaal. */
export function selectSource(source: SourceHouse, part: HousePart): SourceHouse['meshes'] {
  const wanted = part.select?.materials ? new Set(part.select.materials) : null;
  const pool = source.meshes.filter((m) => !wanted || wanted.has(m.material));
  // Hoogtebereik als deel van de hoogte van het hele huis, zodat `yFrom` en `yTo` niet van de selectie afhangen.
  const full = extent(Float32Array.from(source.meshes.flatMap((m) => [...m.mesh.positions])));
  const lo = full.min[1] + (part.select?.yFrom ?? 0) * (full.max[1] - full.min[1]);
  const hi = full.min[1] + (part.select?.yTo ?? 1) * (full.max[1] - full.min[1]);
  const components = part.select?.components;
  return pool
    .map((m) => {
      const inRange = selectTriangles(m.mesh, (c) => c[1] >= lo && c[1] <= hi);
      if (!components || inRange.indices.length === 0)
        return { material: m.material, mesh: inRange };
      return {
        material: m.material,
        mesh: largestComponents(inRange, components, BUDGETS.buildingWeldDistance),
      };
    })
    .filter((m) => m.mesh.indices.length > 0);
}

interface PartMeshes {
  /** Uitvoermateriaalnaam en mesh (een per onderdeel en materiaal). */
  meshes: { material: string; mesh: Mesh }[];
}

/**
 * The mesh of a shape part in its own frame (foot at the origin), outward winding, with a uv set: its own where the
 * shape knows better (the round ones), box projection from uvmap.ts otherwise. Every procedural part is textured, so
 * the generated normal and metallic-roughness maps of surfaceTex.ts have somewhere to land.
 */
export function shapeMeshes(part: Exclude<VariantPart, HousePart>): Mesh {
  return withUv(rawShapeMesh(part));
}

function rawShapeMesh(part: Exclude<VariantPart, HousePart>): Mesh {
  switch (part.type) {
    case 'box':
      if (part.chamfer) return makeBevelBox(part.size, part.chamfer);
      return part.open ? makeBoxOpen(part.size) : makeBoxUv(part.size);
    case 'cylinder': {
      const top = part.radiusTop ?? part.radius;
      return makeCylinderClean(part.radius, top, part.height, part.segments, part.open ?? false);
    }
    case 'cone':
      return makeCone(part.radius, part.height, part.segments, part.open ?? false);
    case 'prism':
      return makePrism(part.profile, part.height, {
        axis: part.axis ?? 'y',
        taper: typeof part.taper === 'number' ? [part.taper, part.taper] : part.taper,
        caps: part.caps,
      });
    case 'track':
      return makeTrack(part);
    case 'corrugated':
      return makeCorrugated(part.length, part.height, part.period, part.depth);
    case 'tube':
      return makeTube(part.points, part.radius, part.sides);
    case 'sphere':
      return makeSphere(part.radius, part.segments, part.rings, part.half ?? 'full');
  }
}

/** Hoekpunten van alle meshes in een lijst. */
function allPositions(meshes: readonly { mesh: Mesh }[]): Float32Array {
  return Float32Array.from(meshes.flatMap((m) => [...m.mesh.positions]));
}

/**
 * Het huisonderdeel in meters, op de wereldschaal van de bron (uniform, `metersPerUnit`): de voet van het hele bronhuis
 * (`whole`: midden van de bounds in x en z, onderkant op y) komt op `position`, daarna de rotatie om die voet. Een
 * geselecteerd deel (het dak) blijft zo op zijn plek in het huis staan en alle LODs krijgen dezelfde schaal en plaats.
 */
export function placeHouse(
  meshes: SourceHouse['meshes'],
  part: HousePart,
  names: Map<string, string>,
  whole: SourceHouse['meshes'],
  metersPerUnit: number,
): PartMeshes['meshes'] {
  const { min, max } = extent(allPositions(whole));
  const toLocal = makeTransform({
    translation: [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2],
  });
  const place = makeTransform({
    scale: [metersPerUnit, metersPerUnit, metersPerUnit],
    ...(part.rotation ? { rotation: part.rotation } : {}),
    translation: part.position,
  });
  return meshes.map((m) => {
    const material = names.get(m.material);
    if (!material) throw new Error(`bronmateriaal "${m.material}" staat niet in sourceMaterials`);
    return { material, mesh: transformMesh(transformMesh(m.mesh, toLocal), place) };
  });
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** `#rrggbb` (sRGB) naar lineaire rgb voor glTF. */
export function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => srgbToLinear(c / 255)) as [
    number,
    number,
    number,
  ];
}

export interface GeneratedBuilding {
  document: Document;
  sourceTriangles: number;
  /** Uitvoermaterialen op naam. */
  materials: string[];
}

/** Driehoekdoel per LOD: het LOD0-doel van het gebouw maal de verhouding van het budget, begrensd door het budget. */
export function buildingLodTargets(lod0Triangles: number): [number, number, number] {
  return [0, 1, 2].map((level) =>
    Math.min(
      BUDGETS.buildingMaxTris[level]!,
      Math.round(lod0Triangles * BUDGETS.buildingLodRatios[level]!),
    ),
  ) as [number, number, number];
}

export function placeShape(part: Exclude<VariantPart, HousePart>): Mesh {
  return transformMesh(
    shapeMeshes(part),
    makeTransform({
      ...(part.rotation ? { rotation: part.rotation } : {}),
      translation: part.position,
    }),
  );
}

/**
 * Generated tile size per LOD for a flat material (0 = no generated maps). LOD2 stays flat colour: it is the far
 * silhouette, render reads a material without a map as flat (uvl layer -1, see structures/buildingGeometry.ts), and
 * three maps per material would be most of a 10 kB LOD2 GLB for relief nobody can resolve at that distance.
 *
 * 256 px over the 2 m tile of uvmap.ts is 128 texels/m, inside render's DENSITY_BAND, so uvScaleForDensity leaves
 * the uv alone and a panel stays the metre it was authored as. At 128 the density falls to 64, render rescales the
 * uv by 1.56 and the panels shrink to 64 cm: fine at LOD1 distance, wrong up close. The price is that every asset
 * carries its own copy of the same tile (+12.6 MB over assets/dist); a shared tile file referenced from the
 * manifest would cut that to one copy, but that is a manifest and render contract change.
 */
export const GENERATED_TILE_SIZES = [256, 128, 0] as const;

/**
 * Hangs the generated tiling maps of the material's surface kind on a flat material: a weathering map on the base
 * colour (the palette colour stays in baseColorFactor and multiplies through), a normal map and a
 * metallic-roughness map. All three share one uv set and one size, which is the contract validateBuildingDocument
 * checks and the one render needs to put them on a single texture-array layer.
 */
function addGeneratedMaps(
  document: Document,
  material: ReturnType<Document['createMaterial']>,
  name: string,
  size: number,
  cache: Map<string, Texture>,
): void {
  const kind = surfaceKindOfName(name);
  const maps = surfaceMaps(kind, size);
  const texture = (slot: 'base' | 'normal' | 'mr', image: Uint8Array): Texture => {
    const key = `${kind}_${slot}`;
    let found = cache.get(key);
    if (!found)
      cache.set(
        key,
        (found = document.createTexture(key).setImage(image).setMimeType('image/png')),
      );
    return found;
  };
  material
    .setBaseColorTexture(texture('base', maps.base))
    .setNormalTexture(texture('normal', maps.normal))
    .setMetallicRoughnessTexture(texture('mr', maps.mr))
    // The map drives both; the factors must not scale it down (glTF multiplies factor by texture).
    .setMetallicFactor(1)
    .setRoughnessFactor(1);
}

export function assemble(
  config: VariantsConfig,
  variant: VariantDef,
  id: string,
  accumulators: Map<string, MeshAccumulator>,
  sources: Map<string, SourceHouse>,
  level: 0 | 1 | 2 = 0,
): Omit<GeneratedBuilding, 'sourceTriangles'> {
  const document = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  const buffer = document.createBuffer();
  const mesh = document.createMesh(id);
  const textures = new Map<string, Texture>();
  const generated = new Map<string, Texture>();
  const tileSize = GENERATED_TILE_SIZES[level];

  // Bronmateriaal per uitvoernaam, voor kleur en textuur; dubbele namen moeten gelijk zijn.
  const sourceByOutput = new Map<string, SourceMaterial>();
  for (const [sourceName, def] of Object.entries(config.sourceMaterials)) {
    const original = [...sources.values()]
      .map((s) => s.materials.get(sourceName))
      .find((m) => m !== undefined);
    if (!original) continue;
    const found: SourceMaterial = def.color
      ? { ...original, diffuse: hexToLinear(def.color) }
      : original;
    const earlier = sourceByOutput.get(def.name);
    if (earlier) {
      const same =
        earlier.texture?.image === found.texture?.image &&
        earlier.diffuse.every((v, i) => Math.abs(v - found.diffuse[i]!) < 1e-6);
      if (!same)
        throw new Error(
          `bronmaterialen met uitvoernaam "${def.name}" hebben niet dezelfde textuur en kleur; geef ze een eigen naam`,
        );
    } else sourceByOutput.set(def.name, found);
  }

  for (const name of [...accumulators.keys()].sort()) {
    const geometry: Mesh = accumulators.get(name)!.build();
    const compacted = compact(geometry, geometry.indices);
    const material = document.createMaterial(name).setMetallicFactor(0).setRoughnessFactor(1);
    const flat = config.flatMaterials[name];
    const fromSource = sourceByOutput.get(name);
    if (flat) {
      const color = variant.colors?.[name] ?? flat.color;
      material.setBaseColorFactor([...hexToLinear(color), 1]);
      if (tileSize > 0 && compacted.uvs)
        addGeneratedMaps(document, material, name, tileSize, generated);
    } else if (fromSource) {
      const tint = hexToLinear(variant.tints?.[name] ?? '#ffffff');
      material
        .setBaseColorFactor([
          fromSource.diffuse[0] * tint[0],
          fromSource.diffuse[1] * tint[1],
          fromSource.diffuse[2] * tint[2],
          1,
        ])
        .setDoubleSided(fromSource.doubleSided);
      if (fromSource.texture) {
        const key = fromSource.texture.name + fromSource.texture.image.byteLength;
        let texture = textures.get(key);
        if (!texture) {
          texture = document
            .createTexture(`${name}_diffuse`)
            .setImage(fromSource.texture.image)
            .setMimeType(fromSource.texture.mimeType);
          textures.set(key, texture);
        }
        material.setBaseColorTexture(texture);
      }
    } else throw new Error(`materiaal "${name}" is noch effen noch bronmateriaal`);

    const small = compacted.positions.length / 3 < 65536;
    const primitive = document
      .createPrimitive()
      .setMaterial(material)
      .setAttribute(
        'POSITION',
        document.createAccessor().setType('VEC3').setArray(compacted.positions).setBuffer(buffer),
      )
      .setAttribute(
        'NORMAL',
        document.createAccessor().setType('VEC3').setArray(compacted.normals).setBuffer(buffer),
      )
      .setIndices(
        document
          .createAccessor()
          .setType('SCALAR')
          .setArray(small ? Uint16Array.from(compacted.indices) : compacted.indices)
          .setBuffer(buffer),
      );
    if (compacted.uvs)
      primitive.setAttribute(
        'TEXCOORD_0',
        document.createAccessor().setType('VEC2').setArray(compacted.uvs).setBuffer(buffer),
      );
    mesh.addPrimitive(primitive);
  }
  // Naamsvermelding (CC-BY) van de gebruikte bronnen mee in het GLB zelf.
  const credits = [
    ...new Set(
      variant.parts.flatMap((part) =>
        part.type === 'house' && config.sources[part.source]?.attribution
          ? [config.sources[part.source]!.attribution!]
          : [],
      ),
    ),
  ];
  if (credits.length > 0) document.getRoot().getAsset().copyright = credits.join('; ');
  const node = document.createNode(id).setMesh(mesh);
  document.createScene(id).addChild(node);
  return { document, materials: [...accumulators.keys()].sort() };
}
