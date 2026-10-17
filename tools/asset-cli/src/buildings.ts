// Gebouwengenerator: bouwt uit het bron-huisje (assets/src/buildings/base_house.glb) en eenvoudige vormen de acht
// Dweller-gebouwen, volledig gestuurd door assets/src/buildings/variants.json. Per gebouw en LOD ontstaat een
// document met effen basiskleur plus diffuse textuur (geen PBR-extensies), een team-materiaal, de footprint exact in x
// en z, het midden op de oorsprong en de grond op y = 0. De LOD-GLB's krijgen meshopt-compressie zoals de rest van de buis.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, Logger, type Texture } from '@gltf-transform/core';
import { EXTMeshoptCompression, PBRSpecularGlossiness } from '@gltf-transform/extensions';
import { dedup, getBounds, prune, reorder, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { BUDGETS } from './budgets.js';
import {
  compact,
  componentsInside,
  dropSmallComponents,
  inverseTranspose3,
  largestComponents,
  makeBox,
  makeTransform,
  MeshAccumulator,
  selectTriangles,
  simplifyMesh,
  transformMesh,
  triangleCount,
  type Mesh,
  type Transform,
  type Vec3,
} from './geometry.js';
import { countTriangles, textureSizes } from './inspect.js';
import { expandParts } from './partExpand.js';
import {
  makeBevelBox,
  makeBoxOpen,
  makeCone,
  makeCorrugated,
  makeCylinderClean,
  makePrism,
  makeSphere,
  makeTrack,
  makeTube,
} from './shapes.js';
import { createIO } from './lods.js';
import type { AssetEntry } from './manifest.js';
import {
  parseVariants,
  type HousePart,
  type VariantDef,
  type VariantPart,
  type VariantsConfig,
} from './variants.js';

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
function transformFromMatrix4(matrix: ArrayLike<number>): Transform {
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
function selectSource(source: SourceHouse, part: HousePart): SourceHouse['meshes'] {
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

/** The mesh of a shape part in its own frame (foot at the origin), outward winding. */
export function shapeMeshes(part: Exclude<VariantPart, HousePart>): Mesh {
  switch (part.type) {
    case 'box':
      if (part.chamfer) return makeBevelBox(part.size, part.chamfer);
      return part.open ? makeBoxOpen(part.size) : makeBox(part.size);
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
function placeHouse(
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

/** Bouwt het document van een gebouw op een LOD, op basis van de config en de ingeladen bronnen. */
export async function generateBuilding(
  config: VariantsConfig,
  id: string,
  level: 0 | 1 | 2,
  sources: Map<string, SourceHouse>,
): Promise<GeneratedBuilding> {
  const variant = config.variants[id];
  if (!variant) throw new Error(`geen variant "${id}" in variants.json`);
  await MeshoptSimplifier.ready;
  const names = new Map(
    Object.entries(config.sourceMaterials).map(([source, m]) => [source, m.name]),
  );
  const target = buildingLodTargets(variant.lod0Triangles)[level];

  // Vormen blijven heel; het budget voor het huis is wat overblijft. Elk huisonderdeel krijgt een deel naar gewicht.
  const active = expandParts(variant.parts).filter(
    (p) => (p.minLod ?? 0) <= level && (p.maxLod ?? 2) >= level,
  );
  const shapes = active.filter((p): p is Exclude<VariantPart, HousePart> => p.type !== 'house');
  const shapeTriangles = shapes.reduce((sum, p) => sum + triangleCount(placeShape(p)), 0);
  const houses = active.filter((p): p is HousePart => p.type === 'house');
  const houseBudget = Math.max(houses.length * 12, target - shapeTriangles);
  const weights = houses.map((p) => p.weight ?? 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const accumulators = new Map<string, MeshAccumulator>();
  const accumulate = (material: string, mesh: Mesh): void => {
    let acc = accumulators.get(material);
    if (!acc) accumulators.set(material, (acc = new MeshAccumulator()));
    acc.add(mesh);
  };
  let sourceTriangles = 0;
  let houseIndex = 0;
  for (const part of active) {
    if (part.type === 'house') {
      const source = sources.get(part.source);
      if (!source) throw new Error(`bron "${part.source}" is niet geladen`);
      const selected = selectSource(source, part);
      if (selected.length === 0)
        throw new Error(`onderdeel met select ${JSON.stringify(part.select)} is leeg`);
      sourceTriangles += selected.reduce((sum, m) => sum + triangleCount(m.mesh), 0);
      // Verdeel het aandeel van dit onderdeel over zijn materiaalmeshes (kleine meshes houden naar verhouding meer).
      const share = (houseBudget * weights[houseIndex++]!) / totalWeight;
      const exponent = BUDGETS.buildingBudgetExponent;
      const parts = selected.map((m) => triangleCount(m.mesh) ** exponent);
      const partTotal = parts.reduce((a, b) => a + b, 0);
      const simplified = selected.map((m, i) => ({
        material: m.material,
        mesh: simplifyMesh(
          dropSmallComponents(
            m.mesh,
            BUDGETS.buildingMinComponentArea[level],
            BUDGETS.buildingWeldDistance,
          ),
          Math.max(4, (share * parts[i]!) / partTotal),
          BUDGETS.buildingSimplify,
        ),
      }));
      for (const m of placeHouse(simplified, part, names, source.meshes, source.metersPerUnit))
        accumulate(m.material, m.mesh);
    } else {
      accumulate(part.material, placeShape(part));
    }
  }

  return { ...assemble(config, variant, id, accumulators, sources), sourceTriangles };
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

function assemble(
  config: VariantsConfig,
  variant: VariantDef,
  id: string,
  accumulators: Map<string, MeshAccumulator>,
  sources: Map<string, SourceHouse>,
): Omit<GeneratedBuilding, 'sourceTriangles'> {
  const document = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  const buffer = document.createBuffer();
  const mesh = document.createMesh(id);
  const textures = new Map<string, Texture>();

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

export interface BuildingLod {
  level: 0 | 1 | 2;
  glb: Uint8Array;
  triangles: number;
  document: Document;
}

/** Textures op de maat van deze LOD (JPEG: de bronnen hebben geen alfa), meshopt-compressie, deduplicatie. */
export async function finishBuildingLod(
  document: Document,
  level: 0 | 1 | 2,
): Promise<BuildingLod> {
  const size = BUDGETS.buildingTextureSizes[level];
  await MeshoptEncoder.ready;
  await document.transform(
    textureCompress({ resize: [size, size], targetFormat: 'jpeg' }),
    dedup(),
    prune({ keepSolidTextures: true }),
    reorder({ encoder: MeshoptEncoder }),
  );
  document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const glb = await createIO().writeBinary(document);
  return { level, glb, triangles: countTriangles(document), document };
}

/**
 * Controleert footprint, midden en grond van een gebouw-document tegen w x h: het model staat binnen de footprint
 * (hooguit 5 procent erbuiten), vult minstens `buildingFootprintMinFill` van w en h, het midden ligt bij de oorsprong
 * en de grond op y = 0. Er is geen grondplaat die de footprint vult.
 */
export function checkBuildingDocument(
  document: Document,
  footprint: { w: number; h: number },
  level: 0 | 1 | 2,
): string[] {
  const errors: string[] = [];
  const label = `LOD${level}`;
  const scene = document.getRoot().listScenes()[0];
  if (!scene) return [`${label}: geen scene`];
  const { min, max } = getBounds(scene);
  const [sx, sy, sz] = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
  const tol = BUDGETS.buildingFootprintTolerance;
  const fill = BUDGETS.buildingFootprintMinFill[level];
  const dims = [
    { name: 'breedte (x)', size: sx, cells: footprint.w },
    { name: 'diepte (z)', size: sz, cells: footprint.h },
  ];
  for (const d of dims) {
    if (d.size > d.cells * (1 + tol))
      errors.push(
        `${label}: ${d.name} is ${d.size.toFixed(2)} m, footprint ${d.cells} m (hooguit ${tol * 100} procent erbuiten)`,
      );
    else if (d.size < d.cells * fill)
      errors.push(
        `${label}: ${d.name} is ${d.size.toFixed(2)} m, footprint ${d.cells} m (het model vult minstens ${fill * 100} procent)`,
      );
  }
  const cx = (min[0]! + max[0]!) / 2;
  const cz = (min[2]! + max[2]!) / 2;
  const ctol = BUDGETS.buildingCentreTolerance;
  if (Math.abs(cx) > footprint.w * ctol || Math.abs(cz) > footprint.h * ctol)
    errors.push(
      `${label}: het midden staat op (${cx.toFixed(2)}, ${cz.toFixed(2)}), verwacht (0, 0)`,
    );
  if (Math.abs(min[1]!) > BUDGETS.buildingGroundTolerance)
    errors.push(`${label}: de grond staat op y=${min[1]!.toFixed(3)}, verwacht 0`);
  if (sy <= 0) errors.push(`${label}: geen hoogte`);
  return errors;
}

/**
 * Algemene regels voor een gebouw-document: geen PBR, een team-materiaal, textuurmaat, UV, tris. Een handheld of
 * ander aanhangsel (robots.ts, `attachments`) heeft geen team-materiaal nodig: `requireTeam: false`.
 */
export function validateBuildingDocument(
  document: Document,
  level: 0 | 1 | 2,
  requireTeam = true,
): string[] {
  const errors: string[] = [];
  const label = `LOD${level}`;
  const root = document.getRoot();
  const pbr = root
    .listExtensionsUsed()
    .map((e) => e.extensionName)
    .filter((name) => name.startsWith('KHR_materials_') && name !== 'KHR_materials_unlit');
  if (pbr.length > 0)
    errors.push(`${label}: PBR-extensies gevonden (${pbr.join(', ')}); de brief eist geen PBR.`);
  for (const material of root.listMaterials()) {
    const extra = [
      material.getNormalTexture() && 'normaal',
      material.getOcclusionTexture() && 'occlusie',
      material.getEmissiveTexture() && 'emissive',
      material.getMetallicRoughnessTexture() && 'metallic-roughness',
    ].filter(Boolean);
    if (extra.length > 0)
      errors.push(
        `${label}: materiaal "${material.getName()}" heeft ${extra.join(', ')}-textuur; alleen diffuse is toegestaan.`,
      );
  }
  if (requireTeam && !root.listMaterials().some((m) => /team/i.test(m.getName())))
    errors.push(`${label}: geen team-materiaal (naam bevat "team").`);
  for (const size of textureSizes(document))
    if (size.width > BUDGETS.buildingMaxTextureSize || size.height > BUDGETS.buildingMaxTextureSize)
      errors.push(
        `${label}: textuur "${size.name}" is ${size.width}x${size.height}, maximaal ${BUDGETS.buildingMaxTextureSize}.`,
      );
  const tris = countTriangles(document);
  if (tris === 0) errors.push(`${label}: geen driehoeken.`);
  if (root.listSkins().length > 0) errors.push(`${label}: een gebouw heeft geen skin.`);
  return errors;
}

export interface BuildingsResult {
  /** Verslag per gebouw (id, bron, fouten en waarschuwingen). */
  reports: {
    id: string;
    source: string;
    errors: string[];
    warnings: string[];
    details?: BuildingDetails;
  }[];
  entries: AssetEntry[];
  /** Pad (relatief aan dist) naar bytes. */
  outputs: Map<string, Uint8Array>;
  /** Bronbestanden (relatief aan srcDir, met forward slashes) die geen eigen asset zijn. */
  sourceFiles: Set<string>;
}

export interface BuildingDetails {
  kind: 'building';
  sourceTriangles: number;
  lodTriangles: number[];
  materials: string[];
  textureSizes: number[];
}

export const EMPTY_BUILDINGS: BuildingsResult = {
  reports: [],
  entries: [],
  outputs: new Map(),
  sourceFiles: new Set(),
};

/** Leest variants.json (als hij bestaat) en geeft de bronbestanden terug die geen eigen asset zijn. */
export function loadVariantsConfig(path: string): VariantsConfig {
  return parseVariants(JSON.parse(readFileSync(path, 'utf8')));
}

/** Bouwt alle varianten uit `config`: validatie per LOD, GLB's, manifestregels. Fouten staan in het verslag. */
export async function buildBuildings(
  config: VariantsConfig,
  srcDir: string,
  configSource: string,
): Promise<BuildingsResult> {
  const result: BuildingsResult = {
    reports: [],
    entries: [],
    outputs: new Map(),
    sourceFiles: new Set(Object.values(config.sources).map((s) => s.file.split('\\').join('/'))),
  };
  const sources = new Map<string, SourceHouse>();
  for (const [key, source] of Object.entries(config.sources))
    sources.set(
      key,
      await loadSourceHouse(join(srcDir, source.file), {
        metersPerUnit: source.metersPerUnit,
        keep: source.keep,
      }),
    );

  for (const id of Object.keys(config.variants).sort()) {
    const variant = config.variants[id]!;
    const report: BuildingsResult['reports'][number] = {
      id,
      source: configSource,
      errors: [],
      warnings: [],
    };
    result.reports.push(report);
    try {
      if (variant.lod0Triangles > BUDGETS.buildingMaxTris[0])
        report.errors.push(
          `lod0Triangles ${variant.lod0Triangles} is boven het budget ${BUDGETS.buildingMaxTris[0]}.`,
        );
      const lods: BuildingLod[] = [];
      let sourceTriangles = 0;
      let materials: string[] = [];
      for (const level of [0, 1, 2] as const) {
        const generated = await generateBuilding(config, id, level, sources);
        sourceTriangles = generated.sourceTriangles;
        materials = generated.materials;
        report.errors.push(...checkBuildingDocument(generated.document, variant.footprint, level));
        const lod = await finishBuildingLod(generated.document, level);
        if (lod.triangles > BUDGETS.buildingMaxTris[level])
          report.errors.push(
            `LOD${level} heeft ${lod.triangles} driehoeken, budget ${BUDGETS.buildingMaxTris[level]}.`,
          );
        report.errors.push(...validateBuildingDocument(lod.document, level));
        lods.push(lod);
      }
      if (report.errors.length > 0) continue;
      const lod0 = lods[0]!;
      const scene = lod0.document.getRoot().listScenes()[0]!;
      const { min, max } = getBounds(scene);
      const round = (v: number[]): [number, number, number] =>
        [v[0]!, v[1]!, v[2]!].map((x) => Math.round(x * 1e6) / 1e6) as [number, number, number];
      for (const lod of lods) result.outputs.set(`${id}/lod${lod.level}.glb`, lod.glb);
      const teamMaterials = lod0.document
        .getRoot()
        .listMaterials()
        .map((m) => m.getName())
        .filter((name) => /team/i.test(name))
        .sort();
      report.details = {
        kind: 'building',
        sourceTriangles,
        lodTriangles: lods.map((l) => l.triangles),
        materials,
        textureSizes: BUDGETS.buildingTextureSizes.slice(),
      };
      result.entries.push({
        id,
        kind: 'building',
        bounds: { min: round(min), max: round(max) },
        lods: lods.map((lod) => ({
          level: lod.level,
          path: `${id}/lod${lod.level}.glb`,
          triangles: lod.triangles,
        })) as AssetEntry['lods'],
        sockets: {},
        animations: [],
        boneCount: 0,
        footprint: variant.footprint,
        teamMaterials,
        ...(variant.albedoGain !== undefined ? { albedoGain: variant.albedoGain } : {}),
      });
    } catch (error) {
      report.errors.push(
        `kan gebouw niet bouwen: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}
