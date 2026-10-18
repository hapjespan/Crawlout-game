// Split from packs.ts to stay under the 5,000-token file limit; packs.ts re-exports the public surface.
// Holds: PACKS_VERSION, triple, range, atlasMax, categorySchema, propSchema, +26 more.
import { z } from 'zod';
import { propCategorySchema, albedoGainSchema, PROP_CATEGORIES } from './manifest.js';
import { BUDGETS } from './budgets.js';
import { readFileSync } from 'node:fs';
import { type Material, type Texture, Document, type Node } from '@gltf-transform/core';
import { PBRSpecularGlossiness } from '@gltf-transform/extensions';
import { createIO } from './lods.js';
import { type Transform, MeshAccumulator, transformMesh, type Mesh } from './geometry.js';
import { invertAffine, multiply } from './math.js';

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

export interface SourceTexture {
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

export const loadSharp = (): Promise<Sharp> =>
  (sharpModule ??= import('sharp').then((m) => m.default));

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

export function findNode(document: Document, name: string): Node | null {
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
export function extract(prop: Node, scale: number): Extracted {
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

export function meshBounds(meshes: Iterable<Mesh>): BoundsBox {
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
export function baseCentre(meshes: readonly Mesh[], box: BoundsBox): [number, number] {
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
