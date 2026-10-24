// Turns one LOD GLB of the asset-cli (as loaded by three's GLTFLoader) into the vertex layout of the unit material:
// position and normal in skin bind space, color (linear rgb, team mask in alpha), skinIndex and skinWeight in the
// bone order of the baked texture, plus uvl (u, v, texture layer) when the asset has diffuse textures. All skinned
// primitives are merged into one geometry, so a unit stays one instanced draw per LOD.
//
// Textures: a character GLB has one material per part (the Klerk has 22: coat, boots, helmet, pouches, ...). One draw
// needs one sampler, so every material's map becomes a layer of a texture array shared by the three LODs of the asset
// (structures/buildingGeometry.ts TextureLayerTable, the same table the buildings use), and the layer index rides
// along in uvl.z; a material without a map gets NO_LAYER and the shader reads white there. Before this, only the
// first map was bound and every other part drew flat white.
//
// Quantization: the asset-cli writes meshopt with KHR_mesh_quantization. For a skinned mesh, gltf-transform's
// quantize() folds the dequantization transform T (uniform scale plus offset) into the inverse bind matrices of the
// LOD GLB, while the baked texture uses the source IBMs (skin = joint world * IBM_source). So the quantized vertices
// must be brought back with T before the texture applies: IBM_lod = IBM_source * T, and with the rest pose as the
// bind pose (IBM_source = inverse(rest world)), T = rest world * IBM_lod for every joint. All joints must agree.
import type { BodyPalette } from '@crawlout/asset-cli/manifest';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  type Material,
  type SkinnedMesh,
  type Texture,
} from 'three/webgpu';
import { type TextureLayerTable } from '../structures/buildingGeometry.js';
import { texelLuminance, type Rasterize } from '../structures/textureArray.js';

export class UnitGeometryError extends Error {
  override name = 'UnitGeometryError';
}

/**
 * Where the team mask comes from. 'materialName' (default): primitives whose glTF material name contains "team"
 * take the owner's color, the rest keep their own. An asset without a "team" material falls back to its main
 * material (name "main" or "body" as a word, e.g. Quaternius' M_Main): that whole material takes the owner's color,
 * on a neutral base so the team color reads clean (TEAM_FALLBACK_BASE). With a body skeleton (bodyRegions.ts) the
 * team color is an accent on the upper chest and shoulders instead and the rest of the body gets clothing colors.
 * 'diffuseAlpha': the alpha of the diffuse texture is the mask
 * per texel (artist brief; 1 = team color). 'auto' (this function's default; the loader passes the manifest's
 * teamMask): 'diffuseAlpha' when the atlas carries a mask in its alpha (some texels below ALPHA_MASK_MAX; an opaque
 * atlas or a JPEG has none), else 'materialName'. 'none': no team color
 * on the model; the selection ring and blob still show the owner.
 */
export type TeamMaskSource = 'auto' | 'materialName' | 'diffuseAlpha' | 'none';

export interface UnitGeometryOptions {
  /** Bones in the baked texture; the GLB's skin must have exactly this many joints. */
  boneCount: number;
  teamMask?: TeamMaskSource;
  /** Reads the atlas' pixels (structures/textureArray.ts canvasRasterize in the browser); null where it cannot. */
  rasterize?: Rasterize;
  /** Clothing palette of the body (manifest `palette`); without it the Dweller clothing (bodyRegions.ts). */
  palette?: BodyPalette | undefined;
  /**
   * Texture layers of this asset, shared by its three LODs: every material's map gets a layer and the geometry gets a
   * `uvl` attribute instead of `uv`. Without it only the first map is used (`map` in the result), the old behaviour
   * that left every other part of a multi-material character flat white.
   */
  layers?: TextureLayerTable;
}

export interface UnitGeometryResult {
  geometry: BufferGeometry;
  /**
   * The diffuse texture shared by the textured primitives, or null when the asset is vertex/material colored or when
   * a layer table was given (the material then samples the array with `uvl`).
   */
  map: Texture | null;
  triangles: number;
  /** Distinct diffuse textures found; all of them are layers when a layer table was given, else only the first is used. */
  textureCount: number;
  /** Where the team mask came from ('auto' resolved). */
  teamMask: Exclude<TeamMaskSource, 'auto'>;
  /**
   * Mean linear luminance of the albedo under the team mask: the team color is shaded relative to it, so the texture's
   * light and dark stay (unitMaterial.ts teamAlbedo). TEAM_PIVOT_DEFAULT when nothing is masked or it cannot be read.
   */
  teamPivot: number;
  /** Bone names in the joint order of the baked texture (attachments find their bone here). */
  boneNames: string[];
  /** 0..1: how much of the whole upper body takes the team color from far away (the palette's `farTeam`). */
  farTeam: number;
}

/** An atlas alpha below this counts as "not team": an atlas with such texels carries a mask in its alpha. */
export const ALPHA_MASK_MAX = 0.98;
/** Edge (px) the atlas is read at for the mask test and the team pivot. */
export const STATS_SIZE = 128;
export const TEAM_PIVOT_DEFAULT = 0.5;

export const lumaOf = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** True when the RGBA pixels (row 0 at the top) hold a team mask in their alpha. */
export function hasAlphaMask(px: Uint8Array): boolean {
  const limit = ALPHA_MASK_MAX * 255;
  let low = 0;
  let high = 0;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i]! < limit) low++;
    else high++;
  }
  return low > 0 && high > 0;
}

/** Linear luminance of the texel at uv (glTF convention: v down, row 0 at the top; repeat). */
export function texelLuma(px: Uint8Array, size: number, u: number, v: number): number {
  const x = Math.min(size - 1, Math.floor((u - Math.floor(u)) * size));
  const y = Math.min(size - 1, Math.floor((v - Math.floor(v)) * size));
  return texelLuminance(px, (y * size + x) * 4);
}

/** Material names that carry the team mask. */
export const TEAM_MATERIAL = /team/i;
/** The main material, team-masked when no material matches TEAM_MATERIAL. */
export const TEAM_MATERIAL_FALLBACK = /(^|[^a-z])(main|body)([^a-z]|$)/i;
/** Base color (linear grey) of a fallback team material: the unit material then shows the pure team color. */
export const TEAM_FALLBACK_BASE = 0.8;

/** uv of primitives without the atlas: the material reads white there. */
export const NO_UV = -1;

export interface MaterialLike extends Material {
  color?: Color;
  map?: Texture | null;
}

export function isQuantized(attr: BufferAttribute): boolean {
  return attr.normalized || !(attr.array instanceof Float32Array);
}

/** True for a matrix that only scales uniformly (s > 0) and translates. */
function isScaleOffset(m: Matrix4, tol: number): boolean {
  const e = m.elements;
  const s = e[0]!;
  if (!(s > 0)) return false;
  const t = tol * Math.max(1, s);
  const off = [1, 2, 3, 4, 6, 7, 8, 9, 11];
  return (
    Math.abs(e[5]! - s) < t &&
    Math.abs(e[10]! - s) < t &&
    Math.abs(e[15]! - 1) < tol &&
    off.every((i) => Math.abs(e[i]!) < t)
  );
}

function close(a: Matrix4, b: Matrix4, tol: number): boolean {
  for (let i = 0; i < 16; i++)
    if (Math.abs(a.elements[i]! - b.elements[i]!) > tol * Math.max(1, Math.abs(b.elements[i]!)))
      return false;
  return true;
}

/** Dequantization transform of a skinned mesh's vertices into its source bind space (see the header). */
export function dequantizationOf(mesh: SkinnedMesh): Matrix4 {
  const { bones, boneInverses } = mesh.skeleton;
  const candidates = bones.map((bone, j) =>
    new Matrix4().multiplyMatrices(bone.matrixWorld, boneInverses[j]!),
  );
  const tol = 1e-3;
  let best: Matrix4 | null = null;
  let bestVotes = 0;
  for (const c of candidates) {
    if (!isScaleOffset(c, tol)) continue;
    const votes = candidates.reduce((n, o) => n + (close(o, c, tol) ? 1 : 0), 0);
    if (votes > bestVotes) {
      best = c;
      bestVotes = votes;
    }
  }
  // A majority of the joints must agree; a skin whose rest pose differs from its bind pose cannot be recovered here.
  if (!best || bestVotes * 2 <= candidates.length) {
    throw new UnitGeometryError(
      `cannot recover the quantization transform of "${mesh.name}": rest pose differs from the bind pose in ${candidates.length - bestVotes} of ${candidates.length} joints`,
    );
  }
  return best;
}
