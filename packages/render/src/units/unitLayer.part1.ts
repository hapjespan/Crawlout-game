// Split from unitLayer.ts to stay under the 5,000-token file limit; unitLayer.ts re-exports the public surface.
// Holds: UnitLayerOptions, UnitRigSource, AttachmentSource, ATTACHMENT_LODS, LodBatch, Attachment, +18 more.
import { ScreenLod, type ScreenLodThresholds } from '../lod/screenLod.js';
import {
  Vector3,
  type BufferGeometry,
  Mesh,
  InstancedBufferAttribute,
  type MeshBasicNodeMaterial,
  type Texture,
  DynamicDrawUsage,
} from 'three/webgpu';
import type { DataTexturePrecision } from '../gpu/dataTextures.js';
import type { BakedAnimations } from './bake.js';
import type { SunShadowTerm } from '../shadows/sunShadow.js';
import type { UnitAlbedo } from './unitMaterial.js';
import { ENTITY_FLAG } from '@crawlout/protocol';
import { type DecalStyle, DECAL_SHAPE, DECAL_COLOR } from '../decals/decalLayer.js';

export interface UnitLayerOptions {
  capacity: number;
  /** Screen-size LOD (lod/screenLod.ts), shared with the other layers; the renderer feeds it the viewport. */
  screen?: ScreenLod;
  /** Projected heights (device px) below which LOD 1 and LOD 2 draw. Default UNIT_LOD_PX. */
  lodPixels?: ScreenLodThresholds;
  lightDir: Vector3;
  /** Bone and clip texture precision (gpu/dataTextures.ts). Default float. */
  precision?: DataTexturePrecision;
  /** Pre-baked clips for the placeholder rig; baked from the procedural rig when absent. */
  anims?: BakedAnimations;
  /**
   * The sun's shadow (shadows/sunShadow.ts): units cast it and receive it, and their blob decal drops to a faint
   * contact darkening (BLOB_WITH_SHADOW) that keeps them grounded at RTS distance. Without it, the full blob.
   */
  shadow?: SunShadowTerm | null;
}

/** A rig the layer can draw: baked clips plus one geometry per LOD in the unit vertex layout. */
export interface UnitRigSource {
  name: string;
  anims: BakedAnimations;
  lods: readonly [BufferGeometry, BufferGeometry, BufferGeometry];
  albedo?: UnitAlbedo;
}

/**
 * A prop carried by a rig's units: its LOD 0 and 1 in one geometry in the unit vertex layout, skinned to one bone
 * (attachmentGeometry.ts mergeAttachmentLods), drawn with the bone and clip textures of `rig`.
 */
export interface AttachmentSource {
  name: string;
  /** The rig whose animation it follows; only units drawn with this rig show it. */
  rig: number;
  geometry: BufferGeometry;
  /** Diffuse atlas when the prop has one; the rest of the material is the rig's attachment material. */
  albedo?: UnitAlbedo;
}

/** Unit LODs that show attachments: 0 and 1. The far LOD drops them (a weapon is a pixel there, the draw call is not). */
export const ATTACHMENT_LODS = 2;

export interface LodBatch {
  mesh: Mesh;
  pose: InstancedBufferAttribute;
  anim: InstancedBufferAttribute;
}

export interface Attachment {
  name: string;
  rig: number;
  batch: LodBatch;
  geometry: BufferGeometry;
  /** Set for an attachment with its own atlas; otherwise the rig's shared attachment material is used. */
  ownMaterial: MeshBasicNodeMaterial | null;
  textures: Texture[];
}

export interface Rig {
  name: string;
  /** Model height (m) of LOD 0 in its rest pose: the size for the screen-size LOD. */
  height: number;
  anims: BakedAnimations;
  /** Duration (s) of each clip by clip id: the pace of the looping work clips (animVariation.ts). */
  clipSeconds: number[];
  material: MeshBasicNodeMaterial;
  textures: Texture[];
  /** The bone and clip textures of `material`, shared by this rig's attachment materials. */
  dataTextures: { boneTex: Texture; clipTex: Texture };
  /** Material of the attachments of this rig that have no atlas of their own (made on first use). */
  attachmentMaterial: MeshBasicNodeMaterial | null;
  geometries: BufferGeometry[];
  lods: LodBatch[];
}

/** Anisotropic filtering of a unit asset's diffuse atlas. */
export const UNIT_ATLAS_ANISOTROPY = 8;

export const UNIT_RADIUS = 1.0; // culling sphere around a unit's chest, meters

/**
 * With shadows the culling sphere is this big: a unit just outside the view still casts its shadow into it (a 1.8 m
 * settler under the 40 degree sun throws about 2.2 m).
 */
export const UNIT_SHADOW_RADIUS = 3.2;

/** Blob strength under a unit when the real shadow is on: a contact darkening, not a second shadow. */
export const BLOB_WITH_SHADOW = 0.45;

export const SELECTED = ENTITY_FLAG.selected;

export const DEAD = ENTITY_FLAG.dead;

export const DECAL_HALF = 0.8; // meters

/** No rig of its own: the typeId uses the default rig. */
export const DEFAULT_RIG = 255;

export const PLACEHOLDER_RIG = 0;

export const BLOB: DecalStyle = {
  shape: DECAL_SHAPE.circle,
  shadow: 1,
  ring: 0,
  ringWidth: 0.14,
  fill: 0,
  grid: 0,
  color: DECAL_COLOR.selection,
};

export const BLOB_SELECTED: DecalStyle = { ...BLOB, ring: 1 };

export const CONTACT: DecalStyle = { ...BLOB, shadow: BLOB_WITH_SHADOW };

export const CONTACT_SELECTED: DecalStyle = { ...CONTACT, ring: 1 };

export const BLOB_INSPECTED: DecalStyle = { ...BLOB_SELECTED, color: DECAL_COLOR.invalid };

export const CONTACT_INSPECTED: DecalStyle = { ...CONTACT_SELECTED, color: DECAL_COLOR.invalid };

export function dynamic(capacity: number, size: number): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(new Float32Array(capacity * size), size);
  a.setUsage(DynamicDrawUsage);
  return a;
}

export function markUsed(a: InstancedBufferAttribute, count: number): void {
  a.clearUpdateRanges();
  a.addUpdateRange(0, Math.max(1, count) * a.itemSize);
  a.needsUpdate = true;
}
