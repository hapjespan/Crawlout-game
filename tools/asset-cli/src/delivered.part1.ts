// Split from delivered.ts to stay under the 5,000-token file limit; delivered.ts re-exports the public surface.
// Holds: DELIVERED_VERSION, vec3, positive, axisSchema, sourceMaterialSchema, ANCHORS, +18 more.
import { z } from 'zod';
import { hexColor, partSchema } from './variants.js';
import { readFileSync } from 'node:fs';
import { type Mesh, transformMesh } from './geometry.js';
import type { Material, Texture } from '@gltf-transform/core';
import { createIO } from './lods.js';
import { ensureSmoothNormals } from './normals.js';
import { transformFromMatrix4 } from './buildings.js';

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
    /**
     * Turns part of the model before the whole model is turned: the rotor discs of a tilt-rotor from cruise into
     * helicopter mode, a turret onto its target. Degrees in the same order as `rotate`, about `pivot` (the hub) in the
     * source's own space, because the node transforms are already in the vertices by then. A part matches when any
     * node in its chain carries one of these names.
     */
    partRotate: z
      .array(
        z
          .object({ nodes: z.array(z.string()).min(1), rotate: vec3, pivot: vec3.optional() })
          .strict(),
      )
      .optional(),
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

export type V3 = [number, number, number];

/** One output material of a model: its meshes merged, with the colour and (when textured) the source texture. */
export interface Group {
  name: string;
  mesh: Mesh;
  /** Linear rgb. */
  color: V3;
  texture: { key: string; image: Uint8Array; mimeType: string } | null;
  twoSided: boolean;
  /** LOD0 triangles for a group that is simplified on its own (0: joint). */
  solo: number;
}

export const slug = (text: string): string =>
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

export function boundsOf(meshes: readonly Mesh[]): { min: V3; max: V3 } {
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

export interface Extracted {
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
export async function extract(
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

export function resolveAxis(
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
