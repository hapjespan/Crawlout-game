// Turns one LOD GLB of the asset-cli (as loaded by three's GLTFLoader) into the vertex layout of the unit material:
// position and normal in skin bind space, color (linear rgb, team mask in alpha), skinIndex and skinWeight in the
// bone order of the baked texture, plus uv when the asset has a diffuse texture. All skinned primitives are merged
// into one geometry, so a unit stays one instanced draw per LOD.
//
// Quantization: the asset-cli writes meshopt with KHR_mesh_quantization. For a skinned mesh, gltf-transform's
// quantize() folds the dequantization transform T (uniform scale plus offset) into the inverse bind matrices of the
// LOD GLB, while the baked texture uses the source IBMs (skin = joint world * IBM_source). So the quantized vertices
// must be brought back with T before the texture applies: IBM_lod = IBM_source * T, and with the rest pose as the
// bind pose (IBM_source = inverse(rest world)), T = rest world * IBM_lod for every joint. All joints must agree.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix3,
  Matrix4,
  Vector3,
  type Bone,
  type Material,
  type Object3D,
  type SkinnedMesh,
  type Texture,
} from 'three/webgpu';

export class UnitGeometryError extends Error {
  override name = 'UnitGeometryError';
}

/**
 * Where the team mask comes from. 'materialName' (default): primitives whose glTF material name contains "team"
 * take the owner's color, the rest keep their own. An asset without a "team" material falls back to its main
 * material (name "main" or "body" as a word, e.g. Quaternius' M_Main): that whole material takes the owner's color,
 * on a neutral base so the team color reads clean (TEAM_FALLBACK_BASE). 'diffuseAlpha': the alpha of the diffuse texture is the mask
 * (artist brief). 'none': no team color on the model; the selection ring and blob still show the owner.
 */
export type TeamMaskSource = 'materialName' | 'diffuseAlpha' | 'none';

export interface UnitGeometryOptions {
  /** Bones in the baked texture; the GLB's skin must have exactly this many joints. */
  boneCount: number;
  teamMask?: TeamMaskSource;
}

export interface UnitGeometryResult {
  geometry: BufferGeometry;
  /** The diffuse texture shared by the textured primitives, or null when the asset is vertex/material colored. */
  map: Texture | null;
  triangles: number;
  /** Distinct diffuse textures found; only the first one is used (one draw per LOD needs one atlas). */
  textureCount: number;
}

/** Material names that carry the team mask. */
export const TEAM_MATERIAL = /team/i;
/** The main material, team-masked when no material matches TEAM_MATERIAL. */
export const TEAM_MATERIAL_FALLBACK = /(^|[^a-z])(main|body)([^a-z]|$)/i;
/** Base color (linear grey) of a fallback team material: the unit material then shows the pure team color. */
export const TEAM_FALLBACK_BASE = 0.8;

/** uv of primitives without the atlas: the material reads white there. */
export const NO_UV = -1;

interface MaterialLike extends Material {
  color?: Color;
  map?: Texture | null;
}

function isQuantized(attr: BufferAttribute): boolean {
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

/** Merges every skinned mesh under `root` into the unit vertex layout. Throws UnitGeometryError on a mismatch. */
export function unitGeometryFromGltf(
  root: Object3D,
  opts: UnitGeometryOptions,
): UnitGeometryResult {
  root.updateMatrixWorld(true);
  const meshes: SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh);
  });
  if (meshes.length === 0) throw new UnitGeometryError('no skinned mesh in the GLB');

  // Bone order of the baked texture = joint order of the first skin (asset-cli: one skin, same order as the bake).
  const reference = meshes[0]!.skeleton.bones;
  if (reference.length !== opts.boneCount)
    throw new UnitGeometryError(
      `skin has ${reference.length} joints, the baked texture ${opts.boneCount}`,
    );
  const byBone = new Map<Bone, number>();
  const byName = new Map<string, number>();
  reference.forEach((b, i) => {
    byBone.set(b, i);
    byName.set(b.name, i);
  });

  const teamMask = opts.teamMask ?? 'materialName';
  const maps: Texture[] = [];
  const mapOf = (m: MaterialLike): Texture | null => {
    const map = m.map ?? null;
    if (map && !maps.some((t) => t === map || (t.source === map.source && t.source !== undefined)))
      maps.push(map);
    return map;
  };
  for (const mesh of meshes)
    mapOf((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MaterialLike);
  const atlas = maps[0] ?? null;
  const materialName = (mesh: SkinnedMesh): string =>
    ((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MaterialLike).name;
  const teamPattern =
    teamMask !== 'materialName'
      ? null
      : meshes.some((m) => TEAM_MATERIAL.test(materialName(m)))
        ? TEAM_MATERIAL
        : TEAM_MATERIAL_FALLBACK;

  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const uvs: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  const idx: number[] = [];
  const v = new Vector3();
  const normalMatrix = new Matrix3();
  const base = new Color();
  const remap: number[] = [];

  for (const mesh of meshes) {
    const g = mesh.geometry;
    const p = g.getAttribute('position') as BufferAttribute | undefined;
    const si = g.getAttribute('skinIndex') as BufferAttribute | undefined;
    const sw = g.getAttribute('skinWeight') as BufferAttribute | undefined;
    if (!p || !si || !sw)
      throw new UnitGeometryError(`mesh "${mesh.name}" lacks position, JOINTS_0 or WEIGHTS_0`);
    let n = g.getAttribute('normal') as BufferAttribute | undefined;
    if (!n) {
      const copy = g.clone();
      copy.computeVertexNormals();
      n = copy.getAttribute('normal') as BufferAttribute;
    }
    const vc = g.getAttribute('color') as BufferAttribute | undefined;
    const uv = g.getAttribute('uv') as BufferAttribute | undefined;
    const material = (
      Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    ) as MaterialLike;
    const map = material.map ?? null;
    const textured =
      atlas !== null &&
      map !== null &&
      (map === atlas || map.source === atlas.source) &&
      uv !== undefined;
    base.copy(material.color ?? new Color(1, 1, 1));
    const mask = teamPattern?.test(material.name) ? 1 : 0;
    if (mask && teamPattern === TEAM_MATERIAL_FALLBACK)
      base.setRGB(TEAM_FALLBACK_BASE, TEAM_FALLBACK_BASE, TEAM_FALLBACK_BASE);

    const T = isQuantized(p) ? dequantizationOf(mesh) : new Matrix4();
    normalMatrix.getNormalMatrix(T);

    // Joint index of this mesh's skin -> index in the reference order.
    remap.length = 0;
    mesh.skeleton.bones.forEach((b, i) => {
      const r = byBone.get(b) ?? byName.get(b.name);
      if (r === undefined)
        throw new UnitGeometryError(
          `joint "${b.name}" of mesh "${mesh.name}" is not in the baked skeleton`,
        );
      remap[i] = r;
    });

    const first = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(T);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
      nrm.push(v.x, v.y, v.z);
      const r = vc ? vc.getX(i) : 1;
      const gg = vc ? vc.getY(i) : 1;
      const b = vc ? vc.getZ(i) : 1;
      col.push(base.r * r, base.g * gg, base.b * b, mask);
      if (atlas) {
        if (textured) uvs.push(uv.getX(i), uv.getY(i));
        else uvs.push(NO_UV, NO_UV);
      }
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += sw.getComponent(i, k);
      for (let k = 0; k < 4; k++) {
        const w = sum > 0 ? sw.getComponent(i, k) / sum : k === 0 ? 1 : 0;
        const j = si.getComponent(i, k);
        const ref = remap[j];
        if (ref === undefined) {
          if (w > 0)
            throw new UnitGeometryError(
              `mesh "${mesh.name}" vertex ${i} references joint ${j}, the skin has ${remap.length}`,
            );
          skinIndex.push(0);
        } else skinIndex.push(ref);
        skinWeight.push(w);
      }
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(first + gi.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(first + i);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
  if (atlas) geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  // Float bone indices keep the vertex layout identical on the WebGPU and WebGL2 backends (as the placeholder).
  geometry.setAttribute('skinIndex', new BufferAttribute(new Float32Array(skinIndex), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(skinWeight), 4));
  const vertexCount = pos.length / 3;
  geometry.setIndex(
    new BufferAttribute(vertexCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1),
  );
  geometry.computeBoundingSphere();
  return { geometry, map: atlas, triangles: idx.length / 3, textureCount: maps.length };
}
