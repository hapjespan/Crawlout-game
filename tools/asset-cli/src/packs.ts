// Prop-packs (Sketchfab-FBX-exports van DJMaesen, CC-BY-4.0): elk pack-GLB wordt volgens assets/src/packs.json in losse
// props gesplitst, op echte schaal gebracht (meters, poppetje 1,8 m, voet op y=0, gecentreerd op x en z), tot een atlas
// samengevoegd, met alfa-test (MASK) voor bladeren en gras, en tot drie LOD's gereduceerd. Alles wat Martien wil
// bijsturen (splitsregel, categorie, maat, budgetten) staat in packs.json, niet in code.
//
// Uitvoer per prop: <id>/lod0..2.glb (meshopt, JPEG-atlas of WebP-atlas met alfa) plus een manifest-entry `kind: 'prop'`
// met `category` en `alpha`. De bronnen (assets/src/packs, 80 MB) staan niet in git: ontbreekt een bron, dan blijft de
// gecommitte uitvoer van de props uit die bron staan (`preserved`), zodat `pnpm assets` in CI groen blijft.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  Document,
  Logger,
  type Material,
  type Node,
  type Primitive,
  type Texture,
} from '@gltf-transform/core';
import {
  EXTMeshoptCompression,
  EXTTextureWebP,
  PBRSpecularGlossiness,
} from '@gltf-transform/extensions';
import { dedup, getBounds, prune, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { z } from 'zod';
import { BUDGETS } from './budgets.js';
import {
  compact,
  MeshAccumulator,
  simplifyMesh,
  splitComponents,
  transformMesh,
  triangleCount,
  type Mesh,
  type Transform,
} from './geometry.js';
import { countTriangles } from './inspect.js';
import { createIO } from './lods.js';
import {
  manifestSchema,
  PROP_CATEGORIES,
  albedoGainSchema,
  propCategorySchema,
  type AssetEntry,
} from './manifest.js';
import { invertAffine, multiply } from './math.js';
import { buildAtlas, type AtlasInfo } from './textures.js';

export const PACKS_VERSION = 1 as const;

const triple = z.tuple([
  z.number().int().positive(),
  z.number().int().positive(),
  z.number().int().positive(),
]);
const range = z
  .tuple([z.number().positive(), z.number().positive()])
  .refine(([a, b]) => a < b, 'min < max');
const atlasMax = z.union([z.literal(512), z.literal(1024)]);

export const categorySchema = z.object({
  /** Redelijke hoogte in meter (min, max) voor deze categorie, naast een poppetje van 1,8 m. De test en de buis dwingen het af. */
  heightRangeM: range,
  /** Driehoeken per LOD (LOD0, LOD1, LOD2): plafond; een prop eronder blijft ongewijzigd. */
  tris: triple,
  /** Maximale zijde van de textuur-atlas (LOD0); LOD1 en LOD2 halveren steeds. 512 voor kleine props. */
  atlas: atlasMax,
  /** Hoe het prop op x en z gecentreerd wordt: midden van de bounds, of zwaartepunt van de voet (bomen). */
  centre: z.enum(['bounds', 'base']).default('bounds'),
});

export const propSchema = z.object({
  /** Naam van het top-level-object (kind van `split.parent`) in de pack-GLB. */
  node: z.string().min(1),
  category: propCategorySchema,
  /** Echte hoogte in meter na schalen (uniform). Zonder: de bron-eenheden maal `unit`. */
  heightM: z.number().positive().optional(),
  /** Alternatief voor heightM: de langste afmeting (x, y of z) in meter, voor lage brede props zoals een pallet. */
  longestM: z.number().positive().optional(),
  /** Tighter maat-check voor dit prop dan de categorie (min, max hoogte in meter). */
  heightRangeM: range.optional(),
  /** LOD0-doel van dit prop in plaats van de categorie. */
  lod0Triangles: z.number().int().positive().optional(),
  atlas: atlasMax.optional(),
  centre: z.enum(['bounds', 'base']).optional(),
  /** Verwacht alfagedrag: 'mask' (bladkaarten, gras) of 'none'. Wijkt de bron af, dan faalt de build. */
  alpha: z.enum(['mask', 'none']).optional(),
  /** Helderheidsfactor op de albedo (0,5 tot 2); komt als `albedoGain` in het manifest. Standaard 1. */
  albedoGain: albedoGainSchema.optional(),
  /** Vrije toelichting (waarom deze maat), voor wie de config bijstuurt. */
  note: z.string().optional(),
});

export const sourceSchema = z.object({
  /** Bestand relatief aan assets/src/packs. */
  file: z.string().min(1),
  /** Meter per bron-eenheid, in de ruimte van de RootNode. De FBX-exports zijn in centimeters: 0.01. */
  unit: z.number().positive().default(0.01),
  /** De kinderen van deze node zijn de props (de splitsregel). Ieder kind moet in `props` of `skip` staan. */
  split: z.object({ parent: z.string().min(1) }),
  /** Kinderen die geen prop worden, met de reden. */
  skip: z.record(z.string().min(1)).default({}),
  props: z.record(propSchema),
});

export const packsSchema = z
  .object({
    version: z.literal(PACKS_VERSION),
    attribution: z.string().min(1),
    categories: z.record(categorySchema),
    /** Simplify-gedrag van de LOD-bouw (meshopt, uv en normaal gewogen). */
    simplify: z
      .object({
        flags: z.array(z.enum(['Prune', 'Permissive', 'LockBorder', 'Sparse'])).default(['Prune']),
        uvWeight: z.number().nonnegative().default(4),
        normalWeight: z.number().nonnegative().default(0.5),
      })
      .default({}),
    /** Kwaliteit van de atlas per LOD: JPEG voor ondoorzichtig, WebP (met alfa) voor bladeren en gras. */
    textureQuality: z.object({
      jpeg: z.number().int().min(1).max(100),
      webp: z.number().int().min(1).max(100),
    }),
    sources: z.record(sourceSchema),
  })
  .superRefine((config, ctx) => {
    const issue = (message: string): void => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    for (const category of PROP_CATEGORIES)
      if (!config.categories[category]) issue(`categorie "${category}" ontbreekt in categories`);
    for (const name of Object.keys(config.categories))
      if (!(PROP_CATEGORIES as readonly string[]).includes(name))
        issue(`onbekende categorie "${name}" (toegestaan: ${PROP_CATEGORIES.join(', ')})`);
    for (const [name, category] of Object.entries(config.categories)) {
      const [a, b, c] = category.tris;
      if (!(a >= b && b >= c))
        issue(`categorie "${name}": tris moeten aflopen (${category.tris.join(', ')})`);
      if (a > BUDGETS.propMaxTris[0])
        issue(`categorie "${name}": LOD0 ${a} is boven het propplafond ${BUDGETS.propMaxTris[0]}`);
    }
    const seen = new Map<string, string>();
    for (const [sourceName, source] of Object.entries(config.sources)) {
      const nodes = new Set<string>();
      for (const [id, prop] of Object.entries(source.props)) {
        if (!/^[a-z0-9_]+$/.test(id)) issue(`id "${id}" mag alleen a-z, 0-9 en _ bevatten`);
        if (seen.has(id)) issue(`id "${id}" staat in "${seen.get(id)}" en in "${sourceName}"`);
        seen.set(id, sourceName);
        if (nodes.has(prop.node))
          issue(`node "${prop.node}" is in "${sourceName}" aan twee props gekoppeld`);
        nodes.add(prop.node);
        if (prop.node in source.skip)
          issue(`node "${prop.node}" staat in "${sourceName}" zowel in props als in skip`);
        if (prop.heightM !== undefined && prop.longestM !== undefined)
          issue(`prop "${id}": heightM en longestM samen kan niet`);
      }
    }
  });

export type PacksConfig = z.infer<typeof packsSchema>;
export type PackProp = z.infer<typeof propSchema>;
export type PackCategory = z.infer<typeof categorySchema>;

export function parsePacksConfig(json: unknown): PacksConfig {
  const result = packsSchema.safeParse(json);
  if (!result.success)
    throw new Error(
      result.error.issues
        .map((i) => `${i.path.join('.') || 'packs.json'}: ${i.message}`)
        .join('; '),
    );
  return result.data;
}

export function loadPacksConfig(path: string): PacksConfig {
  return parsePacksConfig(JSON.parse(readFileSync(path, 'utf8')));
}

/** Alle props uit de config, met hun bronnaam en bron. */
export function listConfiguredProps(
  config: PacksConfig,
): { id: string; source: string; prop: PackProp }[] {
  return Object.entries(config.sources).flatMap(([source, def]) =>
    Object.entries(def.props).map(([id, prop]) => ({ id, source, prop })),
  );
}

/** De effectieve instellingen van een prop: categorie met de overrides van het prop eroverheen. */
export function resolveProp(config: PacksConfig, prop: PackProp) {
  const category = config.categories[prop.category]!;
  return {
    heightRangeM: prop.heightRangeM ?? category.heightRangeM,
    tris: [prop.lod0Triangles ?? category.tris[0], category.tris[1], category.tris[2]] as [
      number,
      number,
      number,
    ],
    atlas: prop.atlas ?? category.atlas,
    centre: prop.centre ?? category.centre,
  };
}

// --- bron inlezen -------------------------------------------------------------------------------------------------

interface SourceTexture {
  /** PNG, met de kleur onder volledig transparante texels gevuld (geen donkere randen bij verkleinen). */
  image: Uint8Array;
  hasAlpha: boolean;
  /** Aandeel texels met alfa < 128. */
  transparentFraction: number;
  /** Gemiddelde sRGB-kleur van de dekkende texels (alfa >= 128), 0 tot 255. */
  opaqueMean: [number, number, number];
}

interface SourceMaterial {
  name: string;
  texture: SourceTexture | null;
  wrap: [number, number];
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
  cutoff: number;
  doubleSided: boolean;
  factor: [number, number, number, number];
}

type Sharp = (typeof import('sharp'))['default'];
let sharpModule: Promise<Sharp> | null = null;
const loadSharp = (): Promise<Sharp> => (sharpModule ??= import('sharp').then((m) => m.default));

async function analyseTexture(bytes: Uint8Array): Promise<SourceTexture> {
  const sharp = await loadSharp();
  const { data, info } = await sharp(Buffer.from(bytes))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sourceChannels = (await sharp(Buffer.from(bytes)).metadata()).hasAlpha === true;
  let transparent = 0;
  const sum = [0, 0, 0];
  let opaque = 0;
  const all = [0, 0, 0];
  const pixels = info.width * info.height;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    all[0]! += data[i]!;
    all[1]! += data[i + 1]!;
    all[2]! += data[i + 2]!;
    if (a < 128) transparent++;
    else {
      opaque++;
      sum[0]! += data[i]!;
      sum[1]! += data[i + 1]!;
      sum[2]! += data[i + 2]!;
    }
  }
  const mean = (opaque > 0 ? sum.map((s) => s / opaque) : all.map((s) => s / pixels)) as [
    number,
    number,
    number,
  ];
  const hasAlpha = sourceChannels && transparent > 0;
  if (hasAlpha) {
    const fill = mean.map(Math.round);
    for (let i = 0; i < data.length; i += 4)
      if (data[i + 3]! < 8) {
        data[i] = fill[0]!;
        data[i + 1] = fill[1]!;
        data[i + 2] = fill[2]!;
      }
  }
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
  return {
    image: new Uint8Array(png),
    hasAlpha,
    transparentFraction: transparent / pixels,
    opaqueMean: mean,
  };
}

/** Materiaal van de bron (spec-gloss of metallic-roughness) als diffuse textuur plus alfagedrag. */
async function readMaterial(
  material: Material,
  cache: Map<Texture, Promise<SourceTexture>>,
): Promise<SourceMaterial> {
  const sg = material.getExtension<PBRSpecularGlossiness>('KHR_materials_pbrSpecularGlossiness');
  const texture = sg ? sg.getDiffuseTexture() : material.getBaseColorTexture();
  const info = sg ? sg.getDiffuseTextureInfo() : material.getBaseColorTextureInfo();
  const factor = (sg ? sg.getDiffuseFactor() : material.getBaseColorFactor()) as [
    number,
    number,
    number,
    number,
  ];
  let analysed: SourceTexture | null = null;
  if (texture) {
    if (!cache.has(texture)) cache.set(texture, analyseTexture(texture.getImage()!));
    analysed = await cache.get(texture)!;
  }
  return {
    name: material.getName() || 'material',
    texture: analysed,
    wrap: [info?.getWrapS() ?? 10497, info?.getWrapT() ?? 10497],
    alphaMode: material.getAlphaMode() as SourceMaterial['alphaMode'],
    cutoff: material.getAlphaCutoff(),
    doubleSided: material.getDoubleSided(),
    factor,
  };
}

export interface PackSource {
  document: Document;
  materials: Map<Material, SourceMaterial>;
}

export async function loadPackSource(file: string): Promise<PackSource> {
  const document = await createIO().readBinary(new Uint8Array(readFileSync(file)));
  const cache = new Map<Texture, Promise<SourceTexture>>();
  const materials = new Map<Material, SourceMaterial>();
  for (const material of document.getRoot().listMaterials())
    materials.set(material, await readMaterial(material, cache));
  return { document, materials };
}

function findNode(document: Document, name: string): Node | null {
  return (
    document
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === name) ?? null
  );
}

// --- geometrie ----------------------------------------------------------------------------------------------------

/** Transform (kolom-major 4x4 plus schaal) naar de rij-major vorm van geometry.ts; `flip` bij een spiegeling. */
function toTransform(
  matrix: ArrayLike<number>,
  scale: number,
): { transform: Transform; flip: boolean } {
  const e = (i: number): number => matrix[i]! * scale;
  const m = [e(0), e(4), e(8), e(1), e(5), e(9), e(2), e(6), e(10)];
  const det =
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
  if (Math.abs(det) < 1e-18) throw new Error('ontaarde node-transformatie in de bron');
  // Normaal: inverse transpose van een rotatie maal uniforme schaal is de rotatie zelf; deel de schaal weg.
  const s = Math.cbrt(Math.abs(det));
  const n = m.map((v) => v / s);
  return {
    transform: { m, n, t: [e(12), e(13), e(14)] as [number, number, number] },
    flip: det < 0,
  };
}

interface Extracted {
  /** Meshes per bronmateriaal (in volgorde van eerste gebruik), in meters, nog niet op de grond gezet. */
  groups: Map<Material, MeshAccumulator>;
  sourceTriangles: number;
}

function* subtree(node: Node): Generator<Node> {
  yield node;
  for (const child of node.listChildren()) yield* subtree(child);
}

/**
 * Alle meshes onder `prop`, in het assenstelsel van het prop-node zelf (de plaatsing in het pack valt weg: positie,
 * draaiing, en alles boven het prop), maal `scale`. De FBX-draaiing van Sketchfab (-90 en +90 graden om X) valt zo weg
 * omdat de wereldmatrices van het prop en zijn meshes dezelfde voorouders hebben.
 */
function extract(prop: Node, scale: number): Extracted {
  const inverse = invertAffine(prop.getWorldMatrix());
  const groups = new Map<Material, MeshAccumulator>();
  let sourceTriangles = 0;
  for (const node of subtree(prop)) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const { transform, flip } = toTransform(multiply(inverse, node.getWorldMatrix()), scale);
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4) continue;
      const position = primitive.getAttribute('POSITION');
      const normal = primitive.getAttribute('NORMAL');
      const uv = primitive.getAttribute('TEXCOORD_0');
      const material = primitive.getMaterial();
      if (!position || !material) continue;
      if (!normal) throw new Error(`mesh "${mesh.getName()}" heeft geen normalen`);
      const count = position.getCount();
      const positions = new Float32Array(count * 3);
      const normals = new Float32Array(count * 3);
      const uvs = uv ? new Float32Array(count * 2) : null;
      const tmp = [0, 0, 0];
      for (let i = 0; i < count; i++) {
        positions.set(position.getElement(i, tmp), i * 3);
        normals.set(normal.getElement(i, tmp), i * 3);
        if (uvs && uv) uvs.set(uv.getElement(i, tmp).slice(0, 2), i * 2);
      }
      const index = primitive.getIndices();
      const indices = new Uint32Array(index ? index.getCount() : count);
      for (let i = 0; i < indices.length; i++) indices[i] = index ? index.getScalar(i) : i;
      if (flip)
        for (let i = 0; i + 2 < indices.length; i += 3)
          [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
      sourceTriangles += indices.length / 3;
      let group = groups.get(material);
      if (!group) groups.set(material, (group = new MeshAccumulator()));
      group.add(transformMesh({ positions, normals, uvs, indices }, transform));
    }
  }
  return { groups, sourceTriangles };
}

interface BoundsBox {
  min: [number, number, number];
  max: [number, number, number];
}

function meshBounds(meshes: Iterable<Mesh>): BoundsBox {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes)
    for (let i = 0; i < mesh.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, mesh.positions[i + k]!);
        max[k] = Math.max(max[k]!, mesh.positions[i + k]!);
      }
  return { min, max };
}

/** Zwaartepunt (x, z) van de voet: de vertices binnen de onderste 5 procent van de hoogte (minstens 10 cm). */
function baseCentre(meshes: readonly Mesh[], box: BoundsBox): [number, number] {
  const limit = box.min[1] + Math.max(0.1, (box.max[1] - box.min[1]) * 0.05);
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (const mesh of meshes)
    for (let i = 0; i < mesh.positions.length; i += 3)
      if (mesh.positions[i + 1]! <= limit) {
        sx += mesh.positions[i]!;
        sz += mesh.positions[i + 2]!;
        n++;
      }
  return n > 0 ? [sx / n, sz / n] : [(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2];
}

// --- document, atlas en LOD's -------------------------------------------------------------------------------------

function addMeshPrimitive(document: Document, mesh: Mesh, material: Material) {
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();
  const accessor = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: Float32Array | Uint32Array) =>
    document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', mesh.positions))
    .setAttribute('NORMAL', accessor('VEC3', mesh.normals))
    .setIndices(accessor('SCALAR', mesh.indices))
    .setMaterial(material);
  if (mesh.uvs) primitive.setAttribute('TEXCOORD_0', accessor('VEC2', mesh.uvs));
  return primitive;
}

function primitiveMesh(primitive: Primitive): Mesh {
  const position = primitive.getAttribute('POSITION')!;
  const normal = primitive.getAttribute('NORMAL')!;
  const uv = primitive.getAttribute('TEXCOORD_0')!;
  const index = primitive.getIndices()!;
  const count = position.getCount();
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const tmp = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    positions.set(position.getElement(i, tmp), i * 3);
    normals.set(normal.getElement(i, tmp), i * 3);
    uvs.set(uv.getElement(i, tmp).slice(0, 2), i * 2);
  }
  const indices = new Uint32Array(index.getCount());
  for (let i = 0; i < indices.length; i++) indices[i] = index.getScalar(i);
  return { positions, normals, uvs, indices };
}

/** De enige primitive van een prop-document (na `mergePrimitives`) als Mesh. */
export function readPrimitive(document: Document): Mesh {
  return primitiveMesh(document.getRoot().listMeshes()[0]!.listPrimitives()[0]!);
}

function writePrimitive(document: Document, mesh: Mesh): void {
  const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  primitive.getAttribute('POSITION')!.setArray(mesh.positions);
  primitive.getAttribute('NORMAL')!.setArray(mesh.normals);
  primitive.getAttribute('TEXCOORD_0')!.setArray(mesh.uvs!);
  primitive.getIndices()!.setArray(mesh.indices);
}

/** Na de atlas hebben alle primitives hetzelfde materiaal: voeg ze samen tot een, zodat een LOD een mesh heeft. */
async function mergePrimitives(document: Document): Promise<void> {
  const mesh = document.getRoot().listMeshes()[0]!;
  const primitives = mesh.listPrimitives();
  const material = primitives[0]!.getMaterial()!;
  const accumulator = new MeshAccumulator();
  for (const primitive of primitives) accumulator.add(primitiveMesh(primitive));
  for (const primitive of primitives) {
    mesh.removePrimitive(primitive);
    primitive.dispose();
  }
  mesh.addPrimitive(addMeshPrimitive(document, accumulator.build(), material));
  await document.transform(prune({ keepAttributes: true, keepSolidTextures: true }));
}

export interface PropAlpha {
  /** Aandeel driehoeken met een transparant materiaal. */
  triangleShare: number;
  /** Gemiddelde kleur (sRGB) van de dekkende texels van de transparante textures, gewogen naar driehoeken. */
  meanRgb: [number, number, number];
  /** Tint in graden en verzadiging van die kleur. */
  hue: number;
  saturation: number;
  /** 'leafy': groen of geelgroen blad of naalden; 'bare': bruin of grijs twijgwerk; 'none': geen transparant materiaal. */
  foliage: 'leafy' | 'bare' | 'none';
  cutoff: number;
}

function hueSaturation([r, g, b]: [number, number, number]): { hue: number; saturation: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { hue, saturation: max === 0 ? 0 : d / max };
}

/** Of de transparante delen blad (groen tot geelgroen, verzadigd) of twijgwerk (bruin, grijs) zijn. */
export function classifyFoliage(hue: number, saturation: number): 'leafy' | 'bare' {
  return hue >= 30 && hue <= 170 && saturation >= 0.3 ? 'leafy' : 'bare';
}

/**
 * Reduceert tot hooguit `target` driehoeken. Probeert eerst de flags uit de config, dan zonder `Prune` (dat bij een
 * krap budget een heel klein object kan weghalen) en over naden heen (`Permissive`), en neemt het resultaat dat het
 * doel het dichtst benadert zonder erover te gaan; lukt dat niet, dan een sloppy-reductie op alleen de posities.
 */
export function reduceMesh(mesh: Mesh, target: number, options: PacksConfig['simplify']): Mesh {
  const base = options.flags.filter((flag) => flag !== 'Prune' && flag !== 'Permissive');
  const attempts: PacksConfig['simplify']['flags'][] = [
    options.flags,
    [...base, 'Permissive'],
    [...base, 'Permissive', 'Prune'],
    [...base, 'Permissive', 'Sparse'],
  ];
  let best: Mesh | null = null;
  for (const flags of attempts) {
    const result = simplifyMesh(mesh, target, { ...options, flags });
    const tris = triangleCount(result);
    if (tris === 0 || tris > target) continue;
    if (!best || tris > triangleCount(best)) best = result;
    if (tris >= target * 0.9) break;
  }
  if (best) return best;
  const [indices] = MeshoptSimplifier.simplifySloppy(
    mesh.indices,
    mesh.positions,
    3,
    null,
    target * 3,
    1,
  );
  return compact(mesh, indices);
}

/** Een kaart (blad- of naaldkaart) heeft hooguit zoveel driehoeken; grotere samenhangende delen zijn stam, tak of grond. */
const CARD_MAX_TRIANGLES = 64;
/** Aandeel van het LOD-budget voor de stam; de rest gaat naar de kaarten. */
const BODY_SHARE = 0.4;
/** Hoeveel een overgebleven kaart groter wordt om het weggevallen blad te dekken. */
const CARD_GROWTH_MAX = 2.2;

/**
 * LOD voor bomen met bladkaarten. Gewone reductie laat op een klein budget de kaarten en dunne stam verdwijnen
 * (de boom wordt een stompje). Hier gaat 40 procent van het budget naar de stam (gereduceerd) en de rest naar de
 * grootste kaarten, die om hun midden groter worden naarmate er meer blad weggevallen is (tot 2,2 keer).
 */
export function reduceFoliageMesh(
  mesh: Mesh,
  target: number,
  options: PacksConfig['simplify'],
): Mesh {
  const parts = splitComponents(mesh, 0.01);
  const cards = parts.filter((p) => p.triangles <= CARD_MAX_TRIANGLES);
  const body = parts.filter((p) => p.triangles > CARD_MAX_TRIANGLES);
  if (cards.length < 3 || body.length === 0) return reduceMesh(mesh, target, options);
  const bodyTarget = Math.max(24, Math.round(target * BODY_SHARE));
  const merge = (list: Mesh[]): Mesh => {
    const accumulator = new MeshAccumulator();
    for (const item of list) accumulator.add(item);
    return accumulator.build();
  };
  const reducedBody = reduceMesh(merge(body.map((p) => p.mesh)), bodyTarget, options);
  const budget = target - triangleCount(reducedBody);
  const picked: typeof cards = [];
  let used = 0;
  for (const card of cards) {
    if (used + card.triangles > budget) continue;
    picked.push(card);
    used += card.triangles;
  }
  if (picked.length === 0) return reducedBody;
  const totalArea = cards.reduce((sum, c) => sum + c.area, 0);
  const pickedArea = picked.reduce((sum, c) => sum + c.area, 0);
  const growth = Math.min(CARD_GROWTH_MAX, Math.max(1, Math.sqrt(totalArea / pickedArea)));
  const grown = picked.map(({ mesh: card }) => {
    const centre = [0, 0, 0];
    const count = card.positions.length / 3;
    for (let i = 0; i < card.positions.length; i++) centre[i % 3]! += card.positions[i]! / count;
    const positions = card.positions.slice();
    for (let i = 0; i < positions.length; i++)
      positions[i] = centre[i % 3]! + (positions[i]! - centre[i % 3]!) * growth;
    return { ...card, positions };
  });
  return merge([reducedBody, ...grown]);
}

export interface Prepared {
  /** Atlas-document in meter, voet op y=0, bij het midden; LOD0 voor de simplify. */
  glb: Uint8Array;
  atlas: AtlasInfo;
  sourceTriangles: number;
  sourceHeightM: number;
  scale: number;
  alpha: PropAlpha;
  cutoff: number;
  doubleSided: boolean;
  materials: string[];
}

export async function prepareProp(
  config: PacksConfig,
  source: PackSource,
  unit: number,
  propNode: Node,
  prop: PackProp,
): Promise<Prepared> {
  const settings = resolveProp(config, prop);
  // Eerst op bron-eenheden (unit) om de ruwe maat te meten, dan de uniforme schaal naar de echte maat.
  const raw = extract(propNode, unit);
  const rawBox = meshBounds([...raw.groups.values()].map((g) => g.build()));
  const rawSize = [0, 1, 2].map((k) => rawBox.max[k]! - rawBox.min[k]!);
  if (!(rawSize[1]! > 0)) throw new Error('het prop heeft geen hoogte');
  let fit = 1;
  if (prop.heightM) fit = prop.heightM / rawSize[1]!;
  else if (prop.longestM) fit = prop.longestM / Math.max(...rawSize);
  const extracted = fit === 1 ? raw : extract(propNode, unit * fit);
  const meshes = new Map(
    [...extracted.groups].map(([material, group]) => [material, group.build()] as const),
  );
  const box = meshBounds(meshes.values());
  const [cx, cz] =
    settings.centre === 'base'
      ? baseCentre([...meshes.values()], box)
      : [(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2];
  const move: Transform = {
    m: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    n: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    t: [-cx, -box.min[1], -cz],
  };

  const document = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  document.createBuffer();
  const textures = new Map<SourceTexture, Texture>();
  const sceneMesh = document.createMesh(propNode.getName());
  let alphaTriangles = 0;
  let totalTriangles = 0;
  const colour = [0, 0, 0];
  let cutoff = 0.5;
  let doubleSided = false;
  const materialNames: string[] = [];
  for (const [material, mesh] of meshes) {
    const info = source.materials.get(material)!;
    if (!info.texture) throw new Error(`materiaal "${info.name}" heeft geen diffuse textuur`);
    if (info.factor.slice(0, 3).some((f) => Math.abs(f - 1) > 0.02))
      throw new Error(
        `materiaal "${info.name}" heeft een diffuse factor ${info.factor.join(', ')}; alleen 1 wordt ondersteund`,
      );
    let texture = textures.get(info.texture);
    if (!texture) {
      texture = document
        .createTexture(`${info.name}`)
        .setMimeType('image/png')
        .setImage(info.texture.image);
      textures.set(info.texture, texture);
    }
    const out = document
      .createMaterial(info.name)
      .setBaseColorTexture(texture)
      .setBaseColorFactor([1, 1, 1, 1]);
    out
      .getBaseColorTextureInfo()!
      .setWrapS(info.wrap[0] as 10497)
      .setWrapT(info.wrap[1] as 10497);
    materialNames.push(info.name);
    const triangles = triangleCount(mesh);
    totalTriangles += triangles;
    if (info.texture.hasAlpha) {
      alphaTriangles += triangles;
      for (let k = 0; k < 3; k++) colour[k]! += info.texture.opaqueMean[k]! * triangles;
      if (info.alphaMode === 'MASK') cutoff = info.cutoff;
    }
    if (info.doubleSided) doubleSided = true;
    sceneMesh.addPrimitive(addMeshPrimitive(document, transformMesh(mesh, move), out));
  }
  const meanRgb = (alphaTriangles > 0 ? colour.map((c) => c / alphaTriangles) : [0, 0, 0]) as [
    number,
    number,
    number,
  ];
  const { hue, saturation } = hueSaturation(meanRgb);
  const alpha: PropAlpha = {
    triangleShare: totalTriangles > 0 ? alphaTriangles / totalTriangles : 0,
    meanRgb: meanRgb.map((c) => Math.round(c * 10) / 10) as [number, number, number],
    hue: Math.round(hue),
    saturation: Math.round(saturation * 100) / 100,
    foliage: alphaTriangles === 0 ? 'none' : classifyFoliage(hue, saturation),
    cutoff,
  };

  const node = document.createNode(propNode.getName()).setMesh(sceneMesh);
  document.createScene('scene').addChild(node);
  const atlas = await buildAtlas(document, settings.atlas, { keepAlpha: alphaTriangles > 0 });
  await mergePrimitives(document);
  const material = document.getRoot().listMaterials()[0]!;
  if (alphaTriangles > 0) material.setAlphaMode('MASK').setAlphaCutoff(cutoff);
  material.setDoubleSided(doubleSided);
  document.getRoot().getAsset().copyright = config.attribution;
  return {
    glb: await createIO().writeBinary(document),
    atlas,
    sourceTriangles: extracted.sourceTriangles,
    sourceHeightM: rawSize[1]!,
    scale: unit * fit,
    alpha,
    cutoff,
    doubleSided,
    materials: [...new Set(materialNames)],
  };
}

export interface PropLod {
  level: 0 | 1 | 2;
  glb: Uint8Array;
  triangles: number;
  textureSize: number;
  textureBytes: number;
  textureFormat: 'jpeg' | 'webp';
  document: Document;
}

/** LOD `level` uit het atlas-document: simplify op het doel, atlas op de maat van de LOD, meshopt-compressie. */
async function buildLod(
  config: PacksConfig,
  prepared: Prepared,
  level: 0 | 1 | 2,
  targets: readonly [number, number, number],
): Promise<PropLod> {
  await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready]);
  const io = createIO();
  const document = await io.readBinary(prepared.glb);
  const mesh = readPrimitive(document);
  const target = Math.min(targets[level], triangleCount(mesh));
  const reduce = prepared.alpha.foliage === 'leafy' && level > 0 ? reduceFoliageMesh : reduceMesh;
  const reduced = triangleCount(mesh) > target ? reduce(mesh, target, config.simplify) : mesh;
  // De reductie kan de onderste hoekpunten weghalen: elke LOD zet zijn eigen voet weer op y=0.
  let minY = Infinity;
  for (let i = 1; i < reduced.positions.length; i += 3)
    minY = Math.min(minY, reduced.positions[i]!);
  if (minY !== 0 && Number.isFinite(minY)) {
    reduced.positions = reduced.positions.slice();
    for (let i = 1; i < reduced.positions.length; i += 3)
      reduced.positions[i] = reduced.positions[i]! - minY;
  }
  writePrimitive(document, reduced);

  const texture = document.getRoot().listTextures()[0]!;
  const sharp = await loadSharp();
  const atlasSize = Math.max(64, prepared.atlas.size >> level);
  const resized = sharp(Buffer.from(texture.getImage()!)).resize(atlasSize, atlasSize, {
    fit: 'fill',
    kernel: 'lanczos3',
  });
  const transparent = prepared.alpha.foliage !== 'none';
  const encoded = transparent
    ? await resized
        .webp({ quality: config.textureQuality.webp, alphaQuality: 100, effort: 6 })
        .toBuffer()
    : await resized
        .removeAlpha()
        .jpeg({ quality: config.textureQuality.jpeg, mozjpeg: true })
        .toBuffer();
  texture.setImage(new Uint8Array(encoded)).setMimeType(transparent ? 'image/webp' : 'image/jpeg');
  if (transparent) document.createExtension(EXTTextureWebP).setRequired(true);

  await document.transform(
    dedup(),
    prune({ keepSolidTextures: true, keepAttributes: true }),
    reorder({ encoder: MeshoptEncoder }),
  );
  document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  return {
    level,
    glb: await io.writeBinary(document),
    triangles: countTriangles(document),
    textureSize: atlasSize,
    textureBytes: encoded.length,
    textureFormat: transparent ? 'webp' : 'jpeg',
    document,
  };
}

// --- controles ----------------------------------------------------------------------------------------------------

const HEIGHT_TOLERANCE_M = 0.02;

/** Controleert de maat, grond, midden en het alfagedrag van een LOD0-document tegen de config. */
export function checkPropDocument(
  config: PacksConfig,
  id: string,
  prop: PackProp,
  lod0: Document,
  alpha: PropAlpha,
): string[] {
  const errors: string[] = [];
  const settings = resolveProp(config, prop);
  const scene = lod0.getRoot().listScenes()[0]!;
  const { min, max } = getBounds(scene);
  const height = max[1]! - min[1]!;
  const [lo, hi] = settings.heightRangeM;
  if (height < lo || height > hi)
    errors.push(
      `hoogte ${height.toFixed(2)} m valt buiten ${lo} tot ${hi} m voor ${prop.category}; stuur heightM of heightRangeM bij in packs.json`,
    );
  if (Math.abs(min[1]!) > HEIGHT_TOLERANCE_M)
    errors.push(`de voet staat op y=${min[1]!.toFixed(3)}, verwacht 0`);
  if (settings.centre === 'bounds') {
    const cx = (min[0]! + max[0]!) / 2;
    const cz = (min[2]! + max[2]!) / 2;
    if (Math.abs(cx) > 0.05 || Math.abs(cz) > 0.05)
      errors.push(`het midden staat op (${cx.toFixed(2)}, ${cz.toFixed(2)}), verwacht (0, 0)`);
  }
  const expected = prop.alpha ?? (prop.category === 'tree-leafy' ? 'mask' : undefined);
  if (expected === 'mask' && alpha.foliage === 'none')
    errors.push('alpha: "mask" verwacht, maar de bron heeft geen transparante textuur');
  if (expected === 'none' && alpha.foliage !== 'none')
    errors.push('alpha: "none" verwacht, maar de bron heeft een transparante textuur');
  if (prop.category === 'tree-leafy' && alpha.foliage === 'bare')
    errors.push(
      `categorie tree-leafy, maar de bladkaarten zijn ${alpha.hue} graden, verzadiging ${alpha.saturation}: dat is twijgwerk (tree-bare)`,
    );
  if (prop.category === 'tree-bare' && alpha.foliage === 'leafy')
    errors.push(
      `categorie tree-bare, maar de kaarten zijn ${alpha.hue} graden, verzadiging ${alpha.saturation}: dat is blad (tree-leafy)`,
    );
  const root = lod0.getRoot();
  const pbr = root
    .listExtensionsUsed()
    .map((e) => e.extensionName)
    .filter((name) => name.startsWith('KHR_materials_') && name !== 'KHR_materials_unlit');
  if (pbr.length > 0)
    errors.push(`PBR-extensies gevonden (${pbr.join(', ')}); de brief eist geen PBR`);
  if (root.listMaterials().length !== 1)
    errors.push(`${root.listMaterials().length} materialen, verwacht 1 (atlas)`);
  const material = root.listMaterials()[0];
  if (
    material &&
    alpha.foliage !== 'none' &&
    (material.getAlphaMode() !== 'MASK' || material.getAlphaCutoff() <= 0)
  )
    errors.push('alfa is niet als MASK met een alphaCutoff behouden');
  return errors;
}

// --- de buis ------------------------------------------------------------------------------------------------------

export interface PackPropDetails {
  kind: 'prop';
  pack: string;
  category: string;
  sourceTriangles: number;
  lodTriangles: number[];
  /** Hoogte van de bron in meter bij `unit` (zonder echte-maat-correctie), de uiteindelijke hoogte, en de totale schaal. */
  sourceHeightM: number;
  heightM: number;
  scale: number;
  atlas: { size: number; cells: AtlasInfo['cells'] };
  textures: { size: number; format: string; bytes: number }[];
  alpha: PropAlpha;
  materials: string[];
  preserved?: true;
}

export interface PacksResult {
  reports: {
    id: string;
    source: string;
    errors: string[];
    warnings: string[];
    details?: PackPropDetails;
  }[];
  entries: AssetEntry[];
  outputs: Map<string, Uint8Array>;
}

export const EMPTY_PACKS: PacksResult = { reports: [], entries: [], outputs: new Map() };

/** De map met de pack-GLB's: assets/src/packs, vanuit een worktree ook die van de hoofdcheckout (gitignored). */
export function findPacksDir(srcDir: string): string | null {
  const local = join(srcDir, 'packs');
  if (existsSync(local)) return local;
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: srcDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const main = resolve(srcDir, common, '..');
    for (const candidate of [join(main, 'assets', 'src', 'packs')])
      if (existsSync(candidate)) return candidate;
  } catch {
    // geen git: alleen de lokale map telt
  }
  return null;
}

function round6(v: number[]): [number, number, number] {
  return [v[0]!, v[1]!, v[2]!].map((x) => Math.round(x * 1e6) / 1e6) as [number, number, number];
}

/** Uitvoer van props uit een bron die ontbreekt: de gecommitte bestanden in `previousDist` blijven staan. */
function preserveProps(
  ids: string[],
  sourceName: string,
  result: PacksResult,
  previousDist: string | undefined,
): void {
  let previous: ReturnType<typeof manifestSchema.safeParse> | null = null;
  if (previousDist && existsSync(join(previousDist, 'manifest.json'))) {
    try {
      previous = manifestSchema.safeParse(
        JSON.parse(readFileSync(join(previousDist, 'manifest.json'), 'utf8')),
      );
    } catch {
      previous = null;
    }
  }
  for (const id of ids) {
    const report: PacksResult['reports'][number] = {
      id,
      source: `packs/${sourceName}`,
      errors: [],
      warnings: [],
    };
    result.reports.push(report);
    const entry = previous?.success ? previous.data.assets.find((a) => a.id === id) : undefined;
    if (!entry || !previousDist) {
      report.errors.push(
        `bron van pack "${sourceName}" ontbreekt (assets/src/packs, staat niet in git) en er is geen eerdere uitvoer van "${id}" in assets/dist`,
      );
      continue;
    }
    const files = entry.lods.map((lod) => lod.path);
    const missing = files.filter((file) => !existsSync(join(previousDist, file)));
    if (missing.length > 0) {
      report.errors.push(
        `eerdere uitvoer van "${id}" is onvolledig (${missing.join(', ')} ontbreekt)`,
      );
      continue;
    }
    for (const file of new Set(files))
      result.outputs.set(file, new Uint8Array(readFileSync(join(previousDist, file))));
    result.entries.push(entry);
    report.warnings.push(
      `bron van pack "${sourceName}" ontbreekt; de bestaande uitvoer in assets/dist is behouden`,
    );
  }
}

/** Bouwt alle props uit `config`: splitsen, schalen, atlas, LOD's, controles. Fouten staan in het verslag per prop. */
export async function buildPacks(
  config: PacksConfig,
  options: { packsDir: string | null; previousDist?: string },
): Promise<PacksResult> {
  const result: PacksResult = { reports: [], entries: [], outputs: new Map() };
  for (const [sourceName, def] of Object.entries(config.sources)) {
    const file = options.packsDir ? join(options.packsDir, def.file) : null;
    const ids = Object.keys(def.props).sort();
    if (!file || !existsSync(file)) {
      preserveProps(ids, sourceName, result, options.previousDist);
      continue;
    }
    const source = await loadPackSource(file);
    const parent = findNode(source.document, def.split.parent);
    if (!parent) {
      for (const id of ids)
        result.reports.push({
          id,
          source: `packs/${def.file}`,
          errors: [`splitsknoop "${def.split.parent}" bestaat niet in ${def.file}`],
          warnings: [],
        });
      continue;
    }
    const children = new Map(
      parent.listChildren().map((child) => [child.getName(), child] as const),
    );
    const stray = [...children.keys()].filter(
      (name) => !(name in def.skip) && !Object.values(def.props).some((p) => p.node === name),
    );
    if (stray.length > 0)
      result.reports.push({
        id: sourceName,
        source: `packs/${def.file}`,
        errors: [`objecten zonder prop of skip in packs.json: ${stray.join(', ')}`],
        warnings: [],
      });
    for (const id of ids) {
      const prop = def.props[id]!;
      const report: PacksResult['reports'][number] = {
        id,
        source: `packs/${def.file}#${prop.node}`,
        errors: [],
        warnings: [],
      };
      result.reports.push(report);
      const node = children.get(prop.node);
      if (!node) {
        report.errors.push(
          `object "${prop.node}" bestaat niet onder "${def.split.parent}" in ${def.file}`,
        );
        continue;
      }
      try {
        const settings = resolveProp(config, prop);
        const prepared = await prepareProp(config, source, def.unit, node, prop);
        const lods: PropLod[] = [];
        for (const level of [0, 1, 2] as const)
          lods.push(await buildLod(config, prepared, level, settings.tris));
        report.errors.push(
          ...checkPropDocument(config, id, prop, lods[0]!.document, prepared.alpha),
        );
        for (const lod of lods)
          if (lod.triangles > settings.tris[lod.level] || lod.triangles === 0)
            report.errors.push(
              `LOD${lod.level} heeft ${lod.triangles} driehoeken, budget ${settings.tris[lod.level]}`,
            );
        const { min, max } = getBounds(lods[0]!.document.getRoot().listScenes()[0]!);
        report.details = {
          kind: 'prop',
          pack: sourceName,
          category: prop.category,
          sourceTriangles: prepared.sourceTriangles,
          lodTriangles: lods.map((l) => l.triangles),
          sourceHeightM: Math.round(prepared.sourceHeightM * 1000) / 1000,
          heightM: Math.round((max[1]! - min[1]!) * 1000) / 1000,
          scale: Math.round(prepared.scale * 1e6) / 1e6,
          atlas: { size: prepared.atlas.size, cells: prepared.atlas.cells },
          textures: lods.map((l) => ({
            size: l.textureSize,
            format: l.textureFormat,
            bytes: l.textureBytes,
          })),
          alpha: prepared.alpha,
          materials: prepared.materials,
        };
        if (report.errors.length > 0) continue;
        for (const lod of lods) result.outputs.set(`${id}/lod${lod.level}.glb`, lod.glb);
        result.entries.push({
          id,
          kind: 'prop',
          bounds: { min: round6(min), max: round6(max) },
          lods: lods.map((lod) => ({
            level: lod.level,
            path: `${id}/lod${lod.level}.glb`,
            triangles: lod.triangles,
          })) as AssetEntry['lods'],
          sockets: {},
          animations: [],
          boneCount: 0,
          teamMask: 'none',
          category: prop.category,
          ...(prepared.alpha.foliage !== 'none' ? { alpha: 'mask' as const } : {}),
          ...(prop.albedoGain !== undefined ? { albedoGain: prop.albedoGain } : {}),
        });
      } catch (error) {
        report.errors.push(
          `kan prop niet bouwen: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return result;
}
