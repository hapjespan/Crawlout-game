// A building LOD from the asset-cli (kind 'building') as one static geometry, so every LOD of every building asset is
// one instanced draw whatever number of materials it has. Vertex layout of the structure material (propMaterial.ts
// with a texture array):
//   position, normal (node transforms applied, also the dequantization of KHR_mesh_quantization),
//   color: linear rgb = the glTF base color factor, alpha = team mask (1 on a team material),
//   uvl: u, v (tiling, may lie outside 0..1) and the texture layer of the material, or -1 for a flat material.
// Which layer a material samples is decided by a TextureLayerTable shared by all building assets: the asset-cli gives
// every source texture one material name ("bronmaterialen met dezelfde naam hebben dezelfde textuur"), so the name is
// the key, and the LODs of one material (512, 256, 128 px) share one layer. The table keeps the largest image per key.
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
import { TEAM_MATERIAL } from '../units/gltfUnitGeometry.js';

export class BuildingGeometryError extends Error {
  override name = 'BuildingGeometryError';
}

/** Layer index of a flat (untextured) primitive in the uvl attribute. */
export const NO_LAYER = -1;

interface MaterialLike extends Material {
  color?: Color;
  map?: Texture | null;
}

/** Image sources the texture array is built from; the image is whatever the GLB loader produced (ImageBitmap etc.). */
export interface TextureLayer {
  key: string;
  image: unknown;
  /** Pixels of `image` (0 when the loader produced no image). */
  width: number;
  height: number;
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
  readonly layers: TextureLayer[] = [];

  /** Layer of a textured material (allocated on first use), or NO_LAYER without a map. */
  layerOf(material: MaterialLike): number {
    const map = material.map ?? null;
    if (!map) return NO_LAYER;
    const key = material.name || `texture:${map.uuid}`;
    const image: unknown = map.image ?? null;
    const [width, height] = imageSize(image);
    let index = this.byKey.get(key);
    if (index === undefined) {
      index = this.layers.push({ key, image, width, height }) - 1;
      this.byKey.set(key, index);
    } else {
      const layer = this.layers[index]!;
      if (width * height > layer.width * layer.height) {
        layer.image = image;
        layer.width = width;
        layer.height = height;
      }
    }
    return index;
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
      if (layer === NO_LAYER) uvl.push(0, 0, NO_LAYER);
      else uvl.push(uv!.getX(i), uv!.getY(i), layer);
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(first + gi.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(first + i);
  }

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
