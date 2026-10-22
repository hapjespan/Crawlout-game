// Turns the static GLB of an attachment (weapon, tool, gear, armor; asset-cli kind 'prop') into the vertex layout of the
// unit material, skinned to one bone of the body: position and normal moved into the body's bind space by the slot's
// matrix (attachmentSockets.ts), color (linear rgb, team mask 0 in alpha), skinIndex = (bone, 0, 0, 0) and skinWeight =
// (1, 0, 0, 0), plus uv when the prop has a diffuse texture. With that layout the unit vertex shader animates the
// attachment exactly like the body: the same baked bone texture, the same frame blend, the same yaw, lean, height
// variation and hero scale, and the same shadow pass, from the same per-instance attributes.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix3,
  Matrix4,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three/webgpu';
import { NO_UV } from './gltfUnitGeometry.js';

export class AttachmentGeometryError extends Error {
  override name = 'AttachmentGeometryError';
}

export interface AttachmentGeometryOptions {
  /** Index of the bone in the baked texture. */
  bone: number;
  /** Prop space to the body's bind space (attachmentSockets.ts attachmentMatrix). */
  matrix: Matrix4;
}

export interface AttachmentGeometryResult {
  geometry: BufferGeometry;
  /** The diffuse texture shared by the textured primitives, or null (vertex or material colored). */
  map: Texture | null;
  triangles: number;
  /** Distinct diffuse textures found; only the first is used. */
  textureCount: number;
}

interface MaterialLike extends Material {
  color?: Color;
  map?: Texture | null;
}

const meshMaterial = (m: Mesh): MaterialLike =>
  (Array.isArray(m.material) ? m.material[0] : m.material) as MaterialLike;

/** Merges every static mesh under `root` into one skinned-to-a-bone geometry. Throws AttachmentGeometryError. */
export function attachmentGeometryFromGltf(
  root: Object3D,
  opts: AttachmentGeometryOptions,
): AttachmentGeometryResult {
  root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  if (meshes.length === 0) throw new AttachmentGeometryError('no mesh in the GLB');
  if (meshes.some((m) => (m as { isSkinnedMesh?: boolean }).isSkinnedMesh))
    throw new AttachmentGeometryError('an attachment must be static (the GLB is skinned)');

  const maps: Texture[] = [];
  for (const mesh of meshes) {
    const map = meshMaterial(mesh).map ?? null;
    if (map && !maps.some((t) => t === map || (t.source === map.source && t.source !== undefined)))
      maps.push(map);
  }
  const atlas = maps[0] ?? null;

  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const v = new Vector3();
  const node = new Matrix4();
  const normalMatrix = new Matrix3();
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const p = g.getAttribute('position');
    if (!p) throw new AttachmentGeometryError(`mesh "${mesh.name}" has no position`);
    let n = g.getAttribute('normal');
    if (!n) {
      const copy = g.clone();
      copy.computeVertexNormals();
      n = copy.getAttribute('normal');
    }
    const vc = g.getAttribute('color');
    const uv = g.getAttribute('uv');
    const material = meshMaterial(mesh);
    const map = material.map ?? null;
    const textured =
      atlas !== null &&
      map !== null &&
      (map === atlas || map.source === atlas.source) &&
      uv !== undefined;
    const base = material.color ?? new Color(1, 1, 1);
    // Node transform (the dequantization of a quantized GLB included), then the slot's matrix into bind space.
    node.multiplyMatrices(opts.matrix, mesh.matrixWorld);
    normalMatrix.getNormalMatrix(node);
    const first = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(node);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
      nrm.push(v.x, v.y, v.z);
      col.push(
        base.r * (vc ? vc.getX(i) : 1),
        base.g * (vc ? vc.getY(i) : 1),
        base.b * (vc ? vc.getZ(i) : 1),
        0,
      );
      if (atlas) {
        if (textured) uvs.push(uv!.getX(i), uv!.getY(i));
        else uvs.push(NO_UV, NO_UV);
      }
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(first + gi.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(first + i);
  }

  const count = pos.length / 3;
  const skinIndex = new Float32Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    skinIndex[i * 4] = opts.bone;
    skinWeight[i * 4] = 1;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
  if (atlas) geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  geometry.setIndex(
    new BufferAttribute(count > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1),
  );
  geometry.computeBoundingSphere();
  return { geometry, map: atlas, triangles: idx.length / 3, textureCount: maps.length };
}

/**
 * One geometry that holds an attachment's LODs together, so a prop costs one draw however many LODs are on screen:
 * the vertices of LOD n carry n in their color alpha (the unit material, `attachment` variant, shows the LOD that the
 * instance names and collapses the rest). The inputs are consumed (disposed); all must be in the layout that
 * attachmentGeometryFromGltf writes, and may differ in having a uv.
 */
export function mergeAttachmentLods(lods: readonly BufferGeometry[]): BufferGeometry {
  const withUv = lods.some((g) => g.getAttribute('uv'));
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const uvs: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  const idx: number[] = [];
  lods.forEach((g, level) => {
    const first = pos.length / 3;
    const count = g.getAttribute('position').count;
    const read = (name: string, size: number, out: number[], alpha = false): void => {
      const a = g.getAttribute(name);
      for (let i = 0; i < count; i++)
        for (let c = 0; c < size; c++)
          out.push(alpha && c === 3 ? level : a ? a.getComponent(i, c) : NO_UV);
    };
    read('position', 3, pos);
    read('normal', 3, nrm);
    read('color', 4, col, true);
    read('skinIndex', 4, skinIndex);
    read('skinWeight', 4, skinWeight);
    if (withUv) read('uv', 2, uvs);
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(first + gi.getX(i));
    else for (let i = 0; i < count; i++) idx.push(first + i);
    g.dispose();
  });
  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  merged.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  merged.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
  if (withUv) merged.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  merged.setAttribute('skinIndex', new BufferAttribute(new Float32Array(skinIndex), 4));
  merged.setAttribute('skinWeight', new BufferAttribute(new Float32Array(skinWeight), 4));
  merged.setIndex(
    new BufferAttribute(pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1),
  );
  merged.computeBoundingSphere();
  return merged;
}
