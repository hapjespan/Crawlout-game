// Delivered models (assets/delivered.json): GLB's from a designer that are processed as they are (textures and all) into
// rigid units (robots), props (weapons, tools, gear with an anchor) or buildings, on the real scale. Used by the local
// pipeline (`pnpm assets --local`, sources in assets/local/delivered, output in assets/dist-local): most of these are
// fan models that must never be committed, so only this module and the config (node and material names, sizes, no art)
// live in git.
//
// Per asset: pick nodes of the source scene, flatten the node transforms into the vertices, turn the model to +Z forward
// (`rotate`), give it its real size (`scale` or `fit`: one axis in meters, never squashed), place its origin (`align`,
// `lift` for a hovering unit), map source materials (rename, recolour, drop the texture, two-sided) and add extra shapes
// (a team band). Per LOD the meshes per output material are simplified to the budget of the kind (meshopt, uv and normal
// weighted), several diffuse textures are merged into one atlas and the result goes through the same finishing as the
// procedural models (JPEG textures per LOD, meshopt, validation). The model is never shrunk to a footprint: a building
// whose real size differs from the data footprint gets a warning with the footprint it needs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, Logger, type Material, type Texture } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { z } from 'zod';
import { BUDGETS } from './budgets.js';
import {
  finishBuildingLod,
  hexToLinear,
  placeShape,
  transformFromMatrix4,
  validateBuildingDocument,
  type BuildingLod,
} from './buildings.js';
import {
  compact,
  makeTransform,
  MeshAccumulator,
  simplifyMesh,
  transformMesh,
  triangleCount,
  type Mesh,
} from './geometry.js';
import { createIO } from './lods.js';
import type { AssetEntry } from './manifest.js';
import { ensureSmoothNormals } from './normals.js';
import { expandParts } from './partExpand.js';
import { buildAtlas } from './textures.js';
import { hexColor, partSchema, type VariantPart } from './variants.js';
import type { RobotsResult } from './robots.js';

export const DELIVERED_VERSION = 1 as const;

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const positive = z.number().positive();

/** Where the origin of the model lands on one axis: the middle, an end of the bounds, an offset from an end, or untouched. */
const axisSchema = z.union([
  z.enum(['centre', 'min', 'max', 'keep']),
  z.object({ fromMin: z.number() }).strict(),
  z.object({ fromMax: z.number() }).strict(),
]);

const sourceMaterialSchema = z
  .object({
    /** Output material name. Textured materials of a model need a name that is unique over all assets (render keys its texture layer on it). */
    name: z.string().min(1).optional(),
    /** Solid colour that replaces the diffuse factor (and, with `flat`, the texture). */
    color: hexColor.optional(),
    /** Drop the texture: the material becomes a flat colour (a recolour of a baked-light texture). */
    flat: z.boolean().optional(),
    /** Leave this material out. */
    drop: z.boolean().optional(),
    /** Add a flipped copy of every triangle (a sheet that has no thickness: a tarp, a banner). */
    twoSided: z.boolean().optional(),
    /**
     * Triangles of this material at LOD0 (scaled down on the far LODs), simplified on its own instead of sharing the joint
     * budget: for a hull that would otherwise be starved by many small parts.
     */
    solo: z.number().int().positive().optional(),
  })
  .strict();

export const ANCHORS = ['grip', 'back', 'head', 'body'] as const;

export const deliveredAssetSchema = z
  .object({
    /** Source GLB relative to the source dir (assets/local). */
    file: z.string().min(1),
    kind: z.enum(['rigid-unit', 'prop', 'building']),
    /** Further ids that get the same model (the same LOD files, their own manifest entries). */
    alias: z.array(z.string().min(1)).optional(),
    /** Only meshes under these nodes (name of the node or of an ancestor). Default all. */
    include: z.array(z.string()).optional(),
    /** Leave out meshes under these nodes. */
    exclude: z.array(z.string()).optional(),
    /**
     * Degrees (order Y, X, Z per step) applied after the node transforms: turns the model to +Z forward, +Y up. An array
     * of steps is applied one after the other (a roll about an axis the first step turned the model onto).
     */
    rotate: z.union([vec3, z.array(vec3).min(1)]).optional(),
    /** Uniform scale of the source units to meters (applied after `rotate`). One of `scale` and `fit`. */
    scale: positive.optional(),
    /** Uniform scale that gives the model this size along one axis (after `rotate`). */
    fit: z
      .object({ axis: z.enum(['x', 'y', 'z']), meters: positive })
      .strict()
      .optional(),
    align: z
      .object({
        x: axisSchema.optional(),
        y: axisSchema.optional(),
        z: axisSchema.optional(),
      })
      .strict()
      .default({}),
    /** Rigid unit that hovers: meters of the underside above the ground, baked into the model (manifest `hover`). */
    hover: positive.optional(),
    /** Prop: where the model is held or worn, as in assets/src/raiders.json. */
    anchor: z.enum(ANCHORS).optional(),
    /** Building: the footprint of the data (the sim reserves it); the model is never scaled to it, see `neededFootprint` in the report. */
    footprint: z
      .object({ w: z.number().int().positive(), h: z.number().int().positive() })
      .optional(),
    /** LOD0 target in triangles; LOD1 and LOD2 follow the budget ratios of the kind. */
    lod0Triangles: z.number().int().positive(),
    /** Edge of the atlas (at most 1024) when the model has several diffuse textures. */
    atlas: z.number().int().min(16).max(1024).default(1024),
    /** Output name of the atlas material, with the surface keyword render reads and a part unique to this asset. */
    atlasName: z.string().min(1).optional(),
    /** Prefix of the default output name of a source material (surface keyword), default `metal`. */
    surface: z.string().min(1).default('metal'),
    /**
     * Per source material name, or `node:<name>` for everything under that node (the node rule wins). A source material
     * that is not listed keeps its colour and texture under a default name.
     */
    materials: z.record(sourceMaterialSchema).default({}),
    /** Extra shapes in the finished model's space (meters, origin as aligned), e.g. the team band; materials from `flatMaterials`. */
    extraParts: z.array(partSchema).default([]),
    simplify: z
      .object({
        flags: z.array(z.enum(['Prune', 'Permissive', 'LockBorder', 'Sparse'])).optional(),
        uvWeight: z.number().nonnegative().optional(),
        normalWeight: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
    note: z.string().optional(),
  })
  .strict()
  .superRefine((asset, ctx) => {
    const issue = (message: string, path: string[]): void =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    if ((asset.scale === undefined) === (asset.fit === undefined))
      issue('geef precies een van scale en fit', ['scale']);
    if (asset.kind === 'building' && !asset.footprint)
      issue('een gebouw heeft een footprint', ['footprint']);
    if (asset.kind !== 'building' && asset.footprint)
      issue('footprint is alleen voor gebouwen', ['footprint']);
    if (asset.kind === 'prop' && !asset.anchor) issue('een prop heeft een anchor', ['anchor']);
    if (asset.kind !== 'prop' && asset.anchor) issue('anchor is alleen voor props', ['anchor']);
    if (asset.hover !== undefined && asset.kind !== 'rigid-unit')
      issue('hover is alleen voor rigide units', ['hover']);
    asset.extraParts.forEach((part, index) => {
      if (part.type === 'house')
        issue('extraParts gebruiken geen bronhuis', ['extraParts', String(index)]);
    });
  });

export const deliveredSchema = z
  .object({
    version: z.literal(DELIVERED_VERSION),
    /** Flat materials of the extra shapes by name (a name with "team" is the team material). */
    flatMaterials: z.record(z.object({ color: hexColor, note: z.string().optional() })).default({}),
    assets: z.record(deliveredAssetSchema),
  })
  .superRefine((config, ctx) => {
    for (const [id, asset] of Object.entries(config.assets))
      asset.extraParts.forEach((part, index) => {
        if ('material' in part && !(part.material in config.flatMaterials))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `onbekend effen materiaal "${part.material}"`,
            path: ['assets', id, 'extraParts', index, 'material'],
          });
      });
  });

export type DeliveredConfig = z.infer<typeof deliveredSchema>;
export type DeliveredAsset = z.infer<typeof deliveredAssetSchema>;

export function parseDelivered(json: unknown): DeliveredConfig {
  const parsed = deliveredSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  throw new Error(
    parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
  );
}

export function loadDeliveredConfig(path: string): DeliveredConfig {
  return parseDelivered(JSON.parse(readFileSync(path, 'utf8')));
}

type V3 = [number, number, number];

/** One output material of a model: its meshes merged, with the colour and (when textured) the source texture. */
interface Group {
  name: string;
  mesh: Mesh;
  /** Linear rgb. */
  color: V3;
  texture: { key: string; image: Uint8Array; mimeType: string } | null;
  twoSided: boolean;
  /** LOD0 triangles for a group that is simplified on its own (0: joint). */
  solo: number;
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'material';

function inSelection(
  node: { getName(): string; getParentNode(): unknown },
  names: readonly string[] | undefined,
): boolean {
  if (!names) return false;
  let current: { getName(): string; getParentNode(): unknown } | null = node;
  while (current) {
    if (names.includes(current.getName())) return true;
    current = current.getParentNode() as typeof current | null;
  }
  return false;
}

function nodeChain(node: { getName(): string; getParentNode(): unknown }): string[] {
  const names: string[] = [];
  let current: { getName(): string; getParentNode(): unknown } | null = node;
  while (current) {
    names.push(current.getName());
    current = current.getParentNode() as typeof current | null;
  }
  return names;
}

function det3(m: readonly number[]): number {
  return (
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!)
  );
}

function boundsOf(meshes: readonly Mesh[]): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes)
    for (let i = 0; i < mesh.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const v = mesh.positions[i + k]!;
        if (v < min[k]!) min[k] = v;
        if (v > max[k]!) max[k] = v;
      }
  return { min, max };
}

interface Extracted {
  /** Name of the node and its ancestors, nearest first. */
  nodes: string[];
  sourceName: string;
  mesh: Mesh;
  color: V3;
  texture: Group['texture'];
}

function materialTexture(material: Material): { texture: Texture; fromEmissive: boolean } | null {
  const base = material.getBaseColorTexture();
  if (base) return { texture: base, fromEmissive: false };
  const emissive = material.getEmissiveTexture();
  // A Sketchfab unlit material: no diffuse, the picture is in the emissive texture.
  if (emissive) return { texture: emissive, fromEmissive: true };
  return null;
}

/** Meshes of the selected nodes with the node transforms in the vertices, per source material. */
async function extract(
  file: string,
  asset: DeliveredAsset,
): Promise<{ parts: Extracted[]; sourceTriangles: number }> {
  const document = await createIO().readBinary(new Uint8Array(readFileSync(file)));
  ensureSmoothNormals(document);
  const parts: Extracted[] = [];
  let sourceTriangles = 0;
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (asset.include && !inSelection(node, asset.include)) continue;
    if (inSelection(node, asset.exclude)) continue;
    const transform = transformFromMatrix4(node.getWorldMatrix());
    const mirrored = det3(transform.m) < 0;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const position = prim.getAttribute('POSITION');
      const normal = prim.getAttribute('NORMAL');
      const uv = prim.getAttribute('TEXCOORD_0');
      if (!position || !normal) continue;
      const material = prim.getMaterial();
      const sourceName = material?.getName() || 'material';
      const count = position.getCount();
      const positions = new Float32Array(count * 3);
      const normals = new Float32Array(count * 3);
      const e = [0, 0, 0];
      for (let i = 0; i < count; i++) {
        positions.set(position.getElement(i, e), i * 3);
        normals.set(normal.getElement(i, e), i * 3);
      }
      const found = material ? materialTexture(material) : null;
      let uvs: Float32Array | null = null;
      if (uv && found) {
        uvs = new Float32Array(count * 2);
        const e2 = [0, 0];
        for (let i = 0; i < count; i++) uvs.set(uv.getElement(i, e2), i * 2);
      }
      const index = prim.getIndices();
      const indices = new Uint32Array(index ? index.getCount() : count);
      for (let i = 0; i < indices.length; i++) indices[i] = index ? index.getScalar(i) : i;
      if (mirrored)
        for (let i = 0; i < indices.length; i += 3) {
          const t = indices[i + 1]!;
          indices[i + 1] = indices[i + 2]!;
          indices[i + 2] = t;
        }
      const placed = transformMesh({ positions, normals, uvs, indices }, transform);
      sourceTriangles += indices.length / 3;
      const factor = material?.getBaseColorFactor() ?? [1, 1, 1, 1];
      const image = found?.texture.getImage();
      parts.push({
        nodes: nodeChain(node),
        sourceName,
        mesh: placed,
        color: found?.fromEmissive ? [1, 1, 1] : [factor[0]!, factor[1]!, factor[2]!],
        texture:
          found && image && uvs
            ? {
                key: `${sourceName}:${image.byteLength}`,
                image,
                mimeType: found.texture.getMimeType(),
              }
            : null,
      });
    }
  }
  if (parts.length === 0) throw new Error(`geen meshes gevonden in ${file} met include/exclude`);
  return { parts, sourceTriangles };
}

function resolveAxis(
  spec: z.infer<typeof axisSchema> | undefined,
  fallback: 'centre' | 'min',
  min: number,
  max: number,
): number {
  const choice = spec ?? fallback;
  if (choice === 'keep') return 0;
  if (choice === 'min') return min;
  if (choice === 'max') return max;
  if (choice === 'centre') return (min + max) / 2;
  if ('fromMin' in choice) return min + choice.fromMin;
  return max - choice.fromMax;
}

export interface PlacedModel {
  groups: Group[];
  scale: number;
  sourceTriangles: number;
  warnings: string[];
}

/** Groups the extracted meshes per output material and puts them in model space: rotate, real size, origin. */
export function placeModel(
  parts: readonly Extracted[],
  asset: DeliveredAsset,
  sourceTriangles: number,
  assetId: string,
): PlacedModel {
  const warnings: string[] = [];
  const steps: V3[] =
    asset.rotate === undefined
      ? []
      : typeof asset.rotate[0] === 'number'
        ? [asset.rotate as V3]
        : (asset.rotate as V3[]);
  const turns = steps.map((rotation) => makeTransform({ rotation }));
  const turned = parts.map((p) => ({
    ...p,
    mesh: turns.reduce((mesh, turn) => transformMesh(mesh, turn), p.mesh),
  }));
  const first = boundsOf(turned.map((p) => p.mesh));
  const axisIndex = { x: 0, y: 1, z: 2 } as const;
  const scale =
    asset.scale ??
    (() => {
      const fit = asset.fit!;
      const size = first.max[axisIndex[fit.axis]]! - first.min[axisIndex[fit.axis]]!;
      if (size <= 0) throw new Error(`fit: de ${fit.axis}-afmeting van het model is 0`);
      return fit.meters / size;
    })();
  const min: V3 = [first.min[0] * scale, first.min[1] * scale, first.min[2] * scale];
  const max: V3 = [first.max[0] * scale, first.max[1] * scale, first.max[2] * scale];
  const lift = asset.hover ?? 0;
  const offset: V3 = [
    -resolveAxis(asset.align.x, 'centre', min[0], max[0]),
    -resolveAxis(asset.align.y, 'min', min[1], max[1]) + lift,
    -resolveAxis(asset.align.z, 'centre', min[2], max[2]),
  ];
  const place = makeTransform({ scale: [scale, scale, scale], translation: offset });

  const byName = new Map<
    string,
    { acc: MeshAccumulator; textured: boolean } & Omit<Group, 'mesh'>
  >();
  for (const part of turned) {
    const nodeKey = part.nodes.find((n) => `node:${n}` in asset.materials);
    const rule = asset.materials[nodeKey ? `node:${nodeKey}` : part.sourceName] ?? {};
    if (rule.drop) continue;
    const textured = part.texture !== null && !rule.flat;
    // The surface keyword in the name picks the render look; a textured name also carries the asset id because render
    // keys its texture layer on the material name.
    const name =
      rule.name ??
      `${slug(asset.surface)}_${slug(nodeKey ?? part.sourceName)}${textured ? `_${slug(assetId)}` : ''}`;
    const color: V3 = rule.color ? hexToLinear(rule.color) : part.color;
    let entry = byName.get(name);
    if (!entry) {
      entry = {
        acc: new MeshAccumulator(),
        textured,
        name,
        color,
        texture: textured ? part.texture : null,
        twoSided: rule.twoSided ?? false,
        solo: rule.solo ?? 0,
      };
      byName.set(name, entry);
    } else if (
      entry.textured !== textured ||
      (textured && entry.texture?.key !== part.texture?.key)
    )
      throw new Error(
        `materiaal "${name}": bronmaterialen met dezelfde uitvoernaam moeten dezelfde textuur hebben (geef ze een eigen naam)`,
      );
    entry.acc.add(textured ? part.mesh : { ...part.mesh, uvs: null });
  }
  if (byName.size === 0) throw new Error('alle materialen zijn weggelaten (drop)');
  const groups: Group[] = [...byName.values()]
    .map((e) => ({
      name: e.name,
      color: e.color,
      texture: e.texture,
      twoSided: e.twoSided,
      solo: e.solo,
      mesh: transformMesh(e.acc.build(), place),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { groups, scale, sourceTriangles, warnings };
}

/** Triangle targets per LOD: the budgets of the kind, LOD1 and LOD2 as a share of LOD0 (buildings use the ratios of the config). */
export function deliveredLodTargets(
  kind: DeliveredAsset['kind'],
  lod0: number,
): [number, number, number] {
  const max = kind === 'building' ? BUDGETS.buildingMaxTris : BUDGETS.rigidUnitMaxTris;
  const ratios = kind === 'building' ? BUDGETS.buildingLodRatios : ([1, 0.4, 0.15] as const);
  return [0, 1, 2].map((level) => Math.min(max[level]!, Math.round(lod0 * ratios[level]!))) as [
    number,
    number,
    number,
  ];
}

function flipped(mesh: Mesh): Mesh {
  const n = mesh.positions.length / 3;
  const positions = new Float32Array(mesh.positions.length * 2);
  positions.set(mesh.positions);
  positions.set(mesh.positions, mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length * 2);
  normals.set(mesh.normals);
  for (let i = 0; i < mesh.normals.length; i++)
    normals[mesh.normals.length + i] = -mesh.normals[i]!;
  let uvs: Float32Array | null = null;
  if (mesh.uvs) {
    uvs = new Float32Array(mesh.uvs.length * 2);
    uvs.set(mesh.uvs);
    uvs.set(mesh.uvs, mesh.uvs.length);
  }
  const indices = new Uint32Array(mesh.indices.length * 2);
  indices.set(mesh.indices);
  for (let i = 0; i < mesh.indices.length; i += 3) {
    indices[mesh.indices.length + i] = mesh.indices[i]! + n;
    indices[mesh.indices.length + i + 1] = mesh.indices[i + 2]! + n;
    indices[mesh.indices.length + i + 2] = mesh.indices[i + 1]! + n;
  }
  return { positions, normals, uvs, indices };
}

interface OutGroup {
  name: string;
  mesh: Mesh;
  color: V3;
  texture: Group['texture'];
}

/** The GLB document of one LOD: textured groups (atlas when there are several textures), then the flat groups. */
async function assembleDocument(
  id: string,
  allGroups: readonly OutGroup[],
  atlasSize: number,
  atlasName: string,
): Promise<Document> {
  const document = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  const buffer = document.createBuffer();
  const mesh = document.createMesh(id);
  const add = (geometry: Mesh, material: ReturnType<Document['createMaterial']>): void => {
    const compacted = compact(geometry, geometry.indices);
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
  };
  const solid = (name: string, color: V3): ReturnType<Document['createMaterial']> =>
    document
      .createMaterial(name)
      .setBaseColorFactor([color[0], color[1], color[2], 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(1);

  const groups = allGroups.filter((g) => g.mesh.indices.length > 0);
  const textured = groups.filter((g) => g.texture && g.mesh.uvs);
  const textures = new Map<string, Texture>();
  for (const group of textured) {
    let texture = textures.get(group.texture!.key);
    if (!texture) {
      texture = document
        .createTexture(`${group.name}_diffuse`)
        .setImage(group.texture!.image)
        .setMimeType(group.texture!.mimeType);
      textures.set(group.texture!.key, texture);
    }
    const material = solid(group.name, [1, 1, 1]).setBaseColorTexture(texture);
    add(group.mesh, material);
  }
  if (textures.size >= 2) {
    await buildAtlas(document, atlasSize);
    for (const material of document.getRoot().listMaterials()) material.setName(atlasName);
  }
  for (const group of groups.filter((g) => !(g.texture && g.mesh.uvs)))
    add(group.mesh, solid(group.name, group.color));
  document.createScene(id).addChild(document.createNode(id).setMesh(mesh));
  return document;
}

const SIMPLIFY_DEFAULT = BUDGETS.buildingSimplify;
const JOINT_FLAGS: readonly ('Prune' | 'Permissive' | 'LockBorder' | 'Sparse')[] = ['Permissive'];

/**
 * One simplification over all groups together (meshopt, the material of a vertex is a heavily weighted attribute): the
 * seams between materials stay closed and the budget goes where the shape needs it, instead of every material getting its
 * own share and cracks along the borders. The triangles are split over the groups again afterwards.
 */
function simplifyJoint(
  groups: readonly Group[],
  target: number,
  options: DeliveredAsset['simplify'],
): Mesh[] {
  const counts = groups.map((g) => g.mesh.positions.length / 3);
  const total = counts.reduce((a, b) => a + b, 0);
  const positions = new Float32Array(total * 3);
  const stride = 6; // normal (3), uv (2), group id (1)
  const attributes = new Float32Array(total * stride);
  const owner = new Uint16Array(total);
  const indices: number[] = [];
  let base = 0;
  groups.forEach((g, gi) => {
    positions.set(g.mesh.positions, base * 3);
    for (let v = 0; v < counts[gi]!; v++) {
      attributes.set(g.mesh.normals.subarray(v * 3, v * 3 + 3), (base + v) * stride);
      if (g.mesh.uvs)
        attributes.set(g.mesh.uvs.subarray(v * 2, v * 2 + 2), (base + v) * stride + 3);
      attributes[(base + v) * stride + 5] = gi;
      owner[base + v] = gi;
    }
    for (const i of g.mesh.indices) indices.push(i + base);
    base += counts[gi]!;
  });
  const nw = options?.normalWeight ?? SIMPLIFY_DEFAULT.normalWeight;
  const uw = options?.uvWeight ?? SIMPLIFY_DEFAULT.uvWeight;
  // Permissive (a texture atlas or hard normals have seams everywhere) but no Prune: with the error limit at 1 it drops
  // every thin or small part (cage bars, a team saucer). The group id attribute is weighted so a collapse rarely crosses materials.
  const flags = [...(options?.flags ?? JOINT_FLAGS)];
  const run = (goal: number): Uint32Array => {
    let current: Uint32Array<ArrayBufferLike> = Uint32Array.from(indices);
    let want = goal;
    for (let pass = 0; pass < 6; pass++) {
      [current] = MeshoptSimplifier.simplifyWithAttributes(
        current,
        positions,
        3,
        attributes,
        stride,
        [nw, nw, nw, uw, uw, 50],
        null,
        Math.min(indices.length / 3, Math.max(1, Math.floor(want))) * 3,
        1,
        flags,
      );
      if (current.length / 3 <= goal) break;
      want = Math.max(1, want * 0.85);
    }
    return current;
  };
  let reduced = run(target);
  // Two-sided groups get a flipped copy, so they count double against the target.
  const twoSided = (r: Uint32Array): number => {
    let n = 0;
    for (let i = 0; i < r.length; i += 3) if (groups[owner[r[i]!]!]!.twoSided) n++;
    return n;
  };
  const flippedTris = twoSided(reduced);
  const keptTris = reduced.length / 3;
  if (flippedTris > 0 && keptTris + flippedTris > target)
    reduced = run(Math.max(12, Math.floor((target * keptTris) / (keptTris + flippedTris))));
  const perGroup: number[][] = groups.map(() => []);
  for (let i = 0; i < reduced.length; i += 3) {
    const gi = owner[reduced[i]!]!;
    perGroup[gi]!.push(reduced[i]!, reduced[i + 1]!, reduced[i + 2]!);
  }
  const normals = new Float32Array(total * 3);
  for (let v = 0; v < total; v++)
    normals.set(attributes.subarray(v * stride, v * stride + 3), v * 3);
  const uvs = new Float32Array(total * 2);
  for (let v = 0; v < total; v++)
    uvs.set(attributes.subarray(v * stride + 3, v * stride + 5), v * 2);
  return groups.map((g, gi) =>
    compact(
      {
        positions,
        normals,
        uvs: g.mesh.uvs ? uvs : null,
        indices: Uint32Array.from(perGroup[gi]!),
      },
      Uint32Array.from(perGroup[gi]!),
    ),
  );
}

/** Meshes of all groups reduced to the target, plus the extra shapes untouched. `scale`: this LOD's target over LOD0's. */
function reduceGroups(
  groups: readonly Group[],
  extra: readonly { material: string; mesh: Mesh }[],
  target: number,
  scale: number,
  options: DeliveredAsset['simplify'],
): OutGroup[] {
  const extraTris = extra.reduce((sum, e) => sum + triangleCount(e.mesh), 0);
  const solo = groups.filter((g) => g.solo > 0);
  const joint = groups.filter((g) => g.solo === 0);
  const flags = options?.flags ?? SIMPLIFY_DEFAULT.flags;
  const soloMeshes = solo.map((g) =>
    simplifyMesh(g.mesh, Math.max(4, Math.round(g.solo * scale)), {
      flags,
      uvWeight: options?.uvWeight ?? SIMPLIFY_DEFAULT.uvWeight,
      normalWeight: options?.normalWeight ?? SIMPLIFY_DEFAULT.normalWeight,
    }),
  );
  const soloTris = soloMeshes.reduce((sum, m) => sum + triangleCount(m), 0);
  const jointMeshes =
    joint.length > 0
      ? simplifyJoint(joint, Math.max(joint.length * 12, target - extraTris - soloTris), options)
      : [];
  return groups.map((group) => {
    const mesh =
      group.solo > 0 ? soloMeshes[solo.indexOf(group)]! : jointMeshes[joint.indexOf(group)]!;
    return {
      name: group.name,
      mesh: group.twoSided ? flipped(mesh) : mesh,
      color: group.color,
      texture: group.texture,
    };
  });
}

/** Moves every mesh in y so the lowest vertex of the set is at `y` (simplification can lift a foot or tip off the ground). */
function regroundY(groups: OutGroup[], extra: OutGroup[], y: number): void {
  const all = [...groups, ...extra];
  const lowest = boundsOf(all.map((g) => g.mesh)).min[1];
  if (!Number.isFinite(lowest) || Math.abs(lowest - y) < 1e-9) return;
  for (const g of all) {
    const positions = new Float32Array(g.mesh.positions);
    for (let i = 1; i < positions.length; i += 3) positions[i] = positions[i]! - (lowest - y);
    g.mesh = { ...g.mesh, positions };
  }
}

const round6 = (v: readonly number[]): V3 =>
  [v[0]!, v[1]!, v[2]!].map((x) => Math.round(x * 1e6) / 1e6) as V3;

const oddCeil = (meters: number): number => {
  const cells = Math.ceil(meters - 1e-6);
  return cells % 2 === 0 ? cells + 1 : cells;
};

export interface DeliveredDetails {
  kind: 'rigid-unit' | 'prop' | 'building';
  sourceTriangles: number;
  lodTriangles: number[];
  materials: string[];
  /** Real size of LOD0 in meters (w x h x d). */
  sizeM: V3;
  scale: number;
  hover?: number;
  /** Buildings: the footprint (cells of 1 m, odd) that the model needs at its real size. */
  neededFootprint?: { w: number; h: number };
}

/** Builds every asset of the config: 3 LODs, validation, manifest entries. Source files are relative to `srcDir`. */
export async function buildDelivered(
  config: DeliveredConfig,
  srcDir: string,
  configSource: string,
): Promise<RobotsResult & { details: Map<string, DeliveredDetails> }> {
  await MeshoptSimplifier.ready;
  const result: RobotsResult & { details: Map<string, DeliveredDetails> } = {
    reports: [],
    entries: [],
    outputs: new Map(),
    details: new Map(),
  };
  for (const id of Object.keys(config.assets).sort()) {
    const asset = config.assets[id]!;
    const ids = [id, ...(asset.alias ?? [])];
    const report: RobotsResult['reports'][number] = {
      id,
      source: configSource,
      errors: [],
      warnings: [],
    };
    result.reports.push(report);
    try {
      const file = join(srcDir, asset.file);
      const { parts, sourceTriangles } = await extract(file, asset);
      const placed = placeModel(parts, asset, sourceTriangles, id);
      report.warnings.push(...placed.warnings);
      const extra = expandParts(asset.extraParts as VariantPart[]).map((part) => ({
        material: (part as { material: string }).material,
        mesh: placeShape(part as Exclude<VariantPart, { type: 'house' }>),
      }));
      const targets = deliveredLodTargets(asset.kind, asset.lod0Triangles);
      const atlasName = asset.atlasName ?? `${slug(asset.surface)}_${slug(id)}_atlas`;
      const lods: BuildingLod[] = [];
      let materials: string[] = [];
      for (const level of [0, 1, 2] as const) {
        const reduced = reduceGroups(
          placed.groups,
          extra,
          targets[level],
          targets[level] / targets[0],
          asset.simplify,
        );
        const extraGroups: OutGroup[] = [];
        for (const e of extra) {
          const flat = config.flatMaterials[e.material]!;
          const existing = extraGroups.find((g) => g.name === e.material);
          if (existing) {
            const acc = new MeshAccumulator();
            acc.add(existing.mesh);
            acc.add(e.mesh);
            existing.mesh = acc.build();
          } else
            extraGroups.push({
              name: e.material,
              mesh: e.mesh,
              color: hexToLinear(flat.color),
              texture: null,
            });
        }
        if (asset.kind !== 'prop') regroundY(reduced, extraGroups, asset.hover ?? 0);
        const document = await assembleDocument(
          id,
          [...reduced, ...extraGroups],
          asset.atlas,
          atlasName,
        );
        if (level === 0)
          materials = document
            .getRoot()
            .listMaterials()
            .map((m) => m.getName())
            .sort();
        const lod = await finishBuildingLod(document, level);
        report.errors.push(...validateBuildingDocument(lod.document, level, asset.kind !== 'prop'));
        const cap = asset.kind === 'building' ? BUDGETS.buildingMaxTris : BUDGETS.rigidUnitMaxTris;
        if (lod.triangles > cap[level])
          report.errors.push(
            `LOD${level} heeft ${lod.triangles} driehoeken, budget ${cap[level]}.`,
          );
        lods.push(lod);
      }
      const { min, max } = getBounds(lods[0]!.document.getRoot().listScenes()[0]!);
      const size: V3 = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
      if (asset.kind !== 'prop' && Math.abs(min[1]! - (asset.hover ?? 0)) > BUDGETS.hoverTolerance)
        report.errors.push(
          `de onderkant staat op y=${min[1]!.toFixed(3)}, verwacht ${asset.hover ?? 0}`,
        );
      let neededFootprint: DeliveredDetails['neededFootprint'];
      if (asset.kind === 'building') {
        neededFootprint = { w: oddCeil(size[0]), h: oddCeil(size[2]) };
        const fp = asset.footprint!;
        // Too big for the footprint, or its longest side far from the longest side of the footprint.
        const over = size[0] > fp.w * 1.05 || size[2] > fp.h * 1.05;
        const longest = Math.max(size[0], size[2]);
        const wanted = Math.max(fp.w, fp.h);
        if (over || Math.abs(longest - wanted) / wanted > 0.15)
          report.warnings.push(
            `echte maat ${size[0].toFixed(2)} x ${size[2].toFixed(2)} m wijkt meer dan 15 procent af van de footprint ${fp.w}x${fp.h} van de data; het model is niet gekrompen of opgerekt. Nodig: ongeveer ${neededFootprint.w}x${neededFootprint.h}.`,
          );
      }
      if (report.errors.length > 0) continue;
      const teamMaterials = lods[0]!.document
        .getRoot()
        .listMaterials()
        .map((m) => m.getName())
        .filter((name) => /team/i.test(name))
        .sort();
      const details: DeliveredDetails = {
        kind: asset.kind,
        sourceTriangles,
        lodTriangles: lods.map((l) => l.triangles),
        materials,
        sizeM: round6(size),
        scale: Math.round(placed.scale * 1e6) / 1e6,
        ...(asset.hover !== undefined ? { hover: asset.hover } : {}),
        ...(neededFootprint ? { neededFootprint } : {}),
      };
      for (const outId of ids) {
        for (const lod of lods) result.outputs.set(`${outId}/lod${lod.level}.glb`, lod.glb);
        result.details.set(outId, details);
        result.entries.push({
          id: outId,
          kind: asset.kind,
          bounds: { min: round6(min), max: round6(max) },
          lods: lods.map((lod) => ({
            level: lod.level,
            path: `${outId}/lod${lod.level}.glb`,
            triangles: lod.triangles,
          })) as AssetEntry['lods'],
          sockets: {},
          animations: [],
          boneCount: 0,
          ...(asset.kind === 'prop' ? { teamMask: 'none' as const } : { teamMaterials }),
          ...(asset.kind === 'rigid-unit'
            ? {
                rigid: true as const,
                teamMask: 'materialName' as const,
                ...(asset.hover !== undefined ? { hover: asset.hover } : {}),
              }
            : asset.kind === 'building'
              ? { footprint: asset.footprint! }
              : {}),
        });
        if (outId !== id)
          result.reports.push({
            id: outId,
            source: configSource,
            errors: [],
            warnings: [`alias van ${id}`],
          });
      }
    } catch (error) {
      report.errors.push(
        `kan model niet bouwen: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}
