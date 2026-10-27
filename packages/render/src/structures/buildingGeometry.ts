// A building LOD from the asset-cli (kind 'building') as one static geometry, so every LOD of every building asset is
// one instanced draw whatever number of materials it has. Vertex layout of the structure material (propMaterial.ts
// with a texture array):
//   position, normal (node transforms applied, also the dequantization of KHR_mesh_quantization),
//   color: linear rgb = the glTF base color factor, alpha = team mask (1 on a team material),
//   uvl: u, v (tiling, may lie outside 0..1) and the texture layer of the material, or -1 for a flat material, whose
//   u then carries the surface kind of the material (look/surfaces.ts index: metal, team trim, wall proxy ...).
// Which layer a material samples is decided by a TextureLayerTable shared by all building assets: the asset-cli gives
// every source texture one material name ("bronmaterialen met dezelfde naam hebben dezelfde textuur"), so the name is
// the key, and the LODs of one material (512, 256, 128 px) share one layer. The table keeps the largest image per key.
// Two materials that point at the very same images share one layer whatever they are called, so a band that borrows
// the body's atlas does not pay for a second copy of it.
import {
  BufferAttribute,
  BufferGeometry,
  Matrix3,
  Vector3,
  type Color,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three/webgpu';
import { surfaceIndex, surfaceKindOfMaterial, type SurfaceKind } from '../look/surfaces.js';
import { TEAM_MATERIAL } from '../units/gltfUnitGeometry.js';
import { texelsPerMeter, uvScaleForDensity } from './texelDensity.js';

export class BuildingGeometryError extends Error {
  override name = 'BuildingGeometryError';
}

/** Layer index of a flat (untextured) primitive in the uvl attribute. */
export const NO_LAYER = -1;

interface MaterialLike extends Material {
  color?: Color;
  map?: Texture | null;
  /** glTF normalTexture; GLTFLoader puts it here. Same uv set and size as `map` (asset-cli contract). */
  normalMap?: Texture | null;
  /** glTF metallicRoughnessTexture; GLTFLoader points both of these at the same texture. */
  roughnessMap?: Texture | null;
  metalnessMap?: Texture | null;
  /** glTF roughnessFactor / metallicFactor; the fallback when the material has no metallicRoughnessTexture. */
  roughness?: number;
  metalness?: number;
}

/** Image sources the texture array is built from; the image is whatever the GLB loader produced (ImageBitmap etc.). */
export interface TextureLayer {
  key: string;
  /** Surface kind of the material (by its name). */
  kind: SurfaceKind;
  image: unknown;
  /** Pixels of `image` (0 when the loader produced no image). */
  width: number;
  height: number;
  /**
   * Tangent-space normal map of the same material, or null. It shares the uv set and the dimensions of `image`
   * (asset-cli contract), so one layer index addresses the base colour, the normal and the metallic-roughness array.
   */
  normalImage?: unknown;
  /** glTF metallicRoughness map (G = roughness, B = metalness), or null. */
  mrImage?: unknown;
  /** Material factors; the fill of the metallic-roughness layer when the material has no map for them. */
  roughness?: number;
  metalness?: number;
}

/** Which of a layer's maps `createLayerTexture` builds an array from. */
export type LayerMapKind = 'base' | 'normal' | 'mr';

/** The image of a layer for one map kind (null when the material has none). */
export function layerImage(layer: TextureLayer, kind: LayerMapKind): unknown {
  if (kind === 'normal') return layer.normalImage ?? null;
  if (kind === 'mr') return layer.mrImage ?? null;
  return layer.image;
}

function imageSize(image: unknown): [number, number] {
  const i = image as { width?: unknown; height?: unknown } | null | undefined;
  const w = typeof i?.width === 'number' ? i.width : 0;
  const h = typeof i?.height === 'number' ? i.height : 0;
  return [w, h];
}

/** Material name to texture-array layer, shared by all building assets of one load. */
export class TextureLayerTable {
  private readonly byKey = new Map<string, number>();
  /**
   * Layer by the identity of the three images behind it, so two materials pointing at the same textures are one
   * layer whatever they are called. The asset-cli's team band is a second material on the body's own atlas textures
   * (tools/asset-cli/src/teamTrim.ts: "Same texture object, so the GLB does not grow"), and a name-keyed table gave
   * it a second layer of the very same pixels: 48 of the Klerk's 96 MB.
   */
  private readonly byImages = new Map<string, number>();
  /** Identity number per image object; a Map compares object keys by identity, which is exactly the question. */
  private readonly imageIds = new Map<unknown, number>();
  readonly layers: TextureLayer[] = [];

  /** Stable number for the image behind a texture (0 without one). Falls back to the source of an undecoded map. */
  private imageId(texture: Texture | null | undefined): number {
    const image: unknown = texture?.image ?? texture?.source ?? texture ?? null;
    if (image === null || image === undefined) return 0;
    let id = this.imageIds.get(image);
    if (id === undefined) {
      id = this.imageIds.size + 1;
      this.imageIds.set(image, id);
    }
    return id;
  }

  /** Layer of a textured material (allocated on first use), or NO_LAYER without a map. */
  layerOf(material: MaterialLike): number {
    const map = material.map ?? null;
    if (!map) return NO_LAYER;
    const key = material.name || `texture:${map.uuid}`;
    const image: unknown = map.image ?? null;
    const [width, height] = imageSize(image);
    // The normal and metallicRoughness maps ride along on the same layer index (same uv set, same size).
    const normalMap = material.normalMap ?? null;
    const mrMap = material.roughnessMap ?? material.metalnessMap ?? null;
    const normalImage: unknown = normalMap?.image ?? null;
    const mrImage: unknown = mrMap?.image ?? null;
    const roughness = typeof material.roughness === 'number' ? material.roughness : 1;
    const metalness = typeof material.metalness === 'number' ? material.metalness : 0;
    // All three maps have to match: a material that shares the base colour but brings its own normal map is a
    // different layer, because one layer index addresses all three arrays.
    const images = `${this.imageId(map)}/${this.imageId(normalMap)}/${this.imageId(mrMap)}`;
    // The name wins over the identity: the LODs of one material are separate GLBs, so their images are separate
    // objects, and the name is what keeps them on one layer.
    const index = this.byKey.get(key) ?? this.byImages.get(images);
    if (index === undefined) {
      const added =
        this.layers.push({
          key,
          kind: surfaceKindOfMaterial(key),
          image,
          width,
          height,
          normalImage,
          mrImage,
          roughness,
          metalness,
        }) - 1;
      this.byKey.set(key, added);
      this.byImages.set(images, added);
      return added;
    }
    const layer = this.layers[index]!;
    const agree = layer.roughness === roughness && layer.metalness === metalness;
    if (width * height > layer.width * layer.height) {
      layer.image = image;
      layer.width = width;
      layer.height = height;
      layer.normalImage = normalImage;
      layer.mrImage = mrImage;
      layer.roughness = roughness;
      layer.metalness = metalness;
    } else {
      // A lighter LOD may carry a map the largest one lacks; never drop one that is already there.
      layer.normalImage ??= normalImage;
      layer.mrImage ??= mrImage;
    }
    // The factors are baked into the metallicRoughness layer (textureArray.ts), so a layer holds one pair. Materials
    // that share a map and disagree over the pair fall back to the neutral one: a factor may only be baked into a map
    // its own material owns, and a shared map carries its factors per texel already (asset-cli textures.part3 bakes
    // them per atlas cell and leaves the atlas material at 1 / 1). The LODs of one material always agree.
    if (!agree) {
      layer.roughness = 1;
      layer.metalness = 1;
    }
    this.byKey.set(key, index);
    this.byImages.set(images, index);
    return index;
  }

  /** True when at least one layer carries a map of this kind. */
  has(kind: LayerMapKind): boolean {
    return this.layers.some((l) => layerImage(l, kind) !== null);
  }

  get size(): number {
    return this.layers.length;
  }
}

export interface BuildingMesh {
  geometry: BufferGeometry;
  triangles: number;
  /** Top of the mesh above y = 0, meters. */
  height: number;
}

export interface BuildingGeometryOptions {
  /** Names of the materials that take the player's color (manifest teamMaterials). TEAM_MATERIAL also counts. */
  teamMaterials: readonly string[];
  layers: TextureLayerTable;
}

/** Merges every mesh under `root` into one building geometry (see the header). Skinned meshes are rejected. */
export function buildingGeometryFromGltf(
  root: Object3D,
  opts: BuildingGeometryOptions,
): BuildingMesh {
  root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  if (meshes.length === 0) throw new BuildingGeometryError('no mesh in the GLB');
  if (meshes.some((m) => (m as { isSkinnedMesh?: boolean }).isSkinnedMesh))
    throw new BuildingGeometryError('a building must be static (the GLB is skinned)');

  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const uvl: number[] = [];
  const idx: number[] = [];
  const v = new Vector3();
  const normalMatrix = new Matrix3();
  let maxY = -Infinity;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const p = g.getAttribute('position');
    if (!p) throw new BuildingGeometryError(`mesh "${mesh.name}" has no position`);
    let n = g.getAttribute('normal');
    if (!n) {
      const copy = g.clone();
      copy.computeVertexNormals();
      n = copy.getAttribute('normal');
    }
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
      MaterialLike | undefined;
    const name = material?.name ?? '';
    const team = opts.teamMaterials.includes(name) || TEAM_MATERIAL.test(name) ? 1 : 0;
    const uv = g.getAttribute('uv');
    const layer = material && uv ? opts.layers.layerOf(material) : NO_LAYER;
    const flatKind = surfaceIndex(surfaceKindOfMaterial(name));
    const vc = g.getAttribute('color');
    const base = material?.color;
    const br = base?.r ?? 1;
    const bg = base?.g ?? 1;
    const bb = base?.b ?? 1;
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    const first = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      pos.push(v.x, v.y, v.z);
      if (v.y > maxY) maxY = v.y;
      v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
      nrm.push(v.x, v.y, v.z);
      col.push(
        br * (vc ? vc.getX(i) : 1),
        bg * (vc ? vc.getY(i) : 1),
        bb * (vc ? vc.getZ(i) : 1),
        team,
      );
      if (layer === NO_LAYER) uvl.push(flatKind, 0, NO_LAYER);
      else uvl.push(uv!.getX(i), uv!.getY(i), layer);
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(first + gi.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(first + i);
  }

  equalizeDensity(pos, uvl, idx, opts.layers.layers);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
  geometry.setAttribute('uvl', new BufferAttribute(new Float32Array(uvl), 3));
  const vertexCount = pos.length / 3;
  geometry.setIndex(
    new BufferAttribute(vertexCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1),
  );
  geometry.computeBoundingSphere();
  return { geometry, triangles: idx.length / 3, height: Math.max(0, maxY) };
}

/**
 * Rescales the uv of every textured layer so its texel density lands in the shared band (texelDensity.ts). The density
 * is measured per layer over the whole LOD (all meshes together, so a surface that continues over two meshes keeps its
 * pattern) from the source texture's width. A layer without a decoded image, or one that does not tile, is left alone.
 */
function equalizeDensity(
  pos: readonly number[],
  uvl: number[],
  idx: readonly number[],
  layers: readonly TextureLayer[],
): void {
  const world = new Float64Array(layers.length);
  const uvArea = new Float64Array(layers.length);
  // A layer whose uv stay inside one tile is a packed atlas (windows, the roof's details) and not a tiling material:
  // rescaling it would sample other parts of the atlas. Only layers that repeat are rescaled.
  const uMin = new Float64Array(layers.length).fill(Infinity);
  const uMax = new Float64Array(layers.length).fill(-Infinity);
  const vMin = new Float64Array(layers.length).fill(Infinity);
  const vMax = new Float64Array(layers.length).fill(-Infinity);
  for (let i = 0; i < uvl.length; i += 3) {
    const layer = uvl[i + 2]!;
    if (layer < 0) continue;
    uMin[layer] = Math.min(uMin[layer]!, uvl[i]!);
    uMax[layer] = Math.max(uMax[layer]!, uvl[i]!);
    vMin[layer] = Math.min(vMin[layer]!, uvl[i + 1]!);
    vMax[layer] = Math.max(vMax[layer]!, uvl[i + 1]!);
  }
  const tiles = (layer: number): boolean =>
    Math.max(uMax[layer]! - uMin[layer]!, vMax[layer]! - vMin[layer]!) > 1.5;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t]!;
    const b = idx[t + 1]!;
    const c = idx[t + 2]!;
    const layer = uvl[a * 3 + 2]!;
    if (layer < 0) continue;
    const ux = pos[b * 3]! - pos[a * 3]!;
    const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!;
    const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
    const vx = pos[c * 3]! - pos[a * 3]!;
    const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!;
    const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
    world[layer] =
      world[layer]! + 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const du1 = uvl[b * 3]! - uvl[a * 3]!;
    const dv1 = uvl[b * 3 + 1]! - uvl[a * 3 + 1]!;
    const du2 = uvl[c * 3]! - uvl[a * 3]!;
    const dv2 = uvl[c * 3 + 1]! - uvl[a * 3 + 1]!;
    uvArea[layer] = uvArea[layer]! + 0.5 * Math.abs(du1 * dv2 - du2 * dv1);
  }
  const scale = layers.map((l, i) =>
    tiles(i) ? uvScaleForDensity(texelsPerMeter(world[i]!, uvArea[i]!, l.width)) : 1,
  );
  if (scale.every((s) => s === 1)) return;
  for (let i = 0; i < uvl.length; i += 3) {
    const layer = uvl[i + 2]!;
    if (layer < 0) continue;
    const s = scale[layer]!;
    uvl[i] = uvl[i]! * s;
    uvl[i + 1] = uvl[i + 1]! * s;
  }
}
