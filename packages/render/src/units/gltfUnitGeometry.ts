// Merges every skinned mesh of one LOD GLB into the unit vertex layout. The types, constants and the quantization
// recovery live in gltfUnitGeometry.part1.ts; this file is the merge itself.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix3,
  Matrix4,
  Vector3,
  type Bone,
  type Object3D,
  type SkinnedMesh,
  type Texture,
} from 'three/webgpu';
import { NO_LAYER } from '../structures/buildingGeometry.js';
import { texelLuminance } from '../structures/textureArray.js';
import {
  BAND_BONE,
  hasBodyRegions,
  resolveBodyPalette,
  teamBandMask,
  vertexRegion,
  type VertexRegion,
} from './bodyRegions.js';
import {
  NO_UV,
  STATS_SIZE,
  TEAM_FALLBACK_BASE,
  TEAM_MATERIAL,
  TEAM_MATERIAL_FALLBACK,
  TEAM_PIVOT_DEFAULT,
  UnitGeometryError,
  dequantizationOf,
  hasAlphaMask,
  isQuantized,
  lumaOf,
  texelLuma,
  type MaterialLike,
  type TeamMaskSource,
  type UnitGeometryOptions,
  type UnitGeometryResult,
} from './gltfUnitGeometry.part1.js';

export {
  ALPHA_MASK_MAX,
  NO_UV,
  TEAM_FALLBACK_BASE,
  TEAM_MATERIAL,
  TEAM_MATERIAL_FALLBACK,
  TEAM_PIVOT_DEFAULT,
  UnitGeometryError,
  dequantizationOf,
  hasAlphaMask,
} from './gltfUnitGeometry.part1.js';
export type {
  MaterialLike,
  TeamMaskSource,
  UnitGeometryOptions,
  UnitGeometryResult,
} from './gltfUnitGeometry.part1.js';


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

  const requested = opts.teamMask ?? 'auto';
  const maps: Texture[] = [];
  const mapOf = (m: MaterialLike): Texture | null => {
    const map = m.map ?? null;
    if (map && !maps.some((t) => t === map || (t.source === map.source && t.source !== undefined)))
      maps.push(map);
    return map;
  };
  for (const mesh of meshes)
    mapOf((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MaterialLike);
  const table = opts.layers ?? null;
  // Without a layer table the first map is the atlas and the rest is dropped (the old single-sampler path).
  const atlas = table ? null : (maps[0] ?? null);
  /** Pixels of one map at STATS_SIZE, once per texture: the alpha-mask test and the team pivot read these. */
  const statsCache = new Map<unknown, Uint8Array | null>();
  const statsOf = (map: Texture | null): Uint8Array | null => {
    if (!map || !opts.rasterize) return null;
    const key: unknown = map.source ?? map;
    if (!statsCache.has(key)) {
      const px = opts.rasterize(map.image, STATS_SIZE);
      statsCache.set(key, px && px.length === STATS_SIZE * STATS_SIZE * 4 ? px : null);
    }
    return statsCache.get(key) ?? null;
  };
  const atlasPx = table ? null : statsOf(atlas);
  const anyAlphaMask = table
    ? maps.some((m) => {
        const px = statsOf(m);
        return px !== null && hasAlphaMask(px);
      })
    : atlasPx !== null && hasAlphaMask(atlasPx);
  const teamMask: Exclude<TeamMaskSource, 'auto'> =
    requested !== 'auto' ? requested : anyAlphaMask ? 'diffuseAlpha' : 'materialName';
  const materialName = (mesh: SkinnedMesh): string =>
    ((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MaterialLike).name;
  const teamPattern =
    teamMask !== 'materialName'
      ? null
      : meshes.some((m) => TEAM_MATERIAL.test(materialName(m)))
        ? TEAM_MATERIAL
        : TEAM_MATERIAL_FALLBACK;

  // A mannequin (the main material takes the team color) with a body skeleton: team accent plus clothing regions.
  const boneNames = reference.map((b) => b.name);
  const regions = teamPattern === TEAM_MATERIAL_FALLBACK && hasBodyRegions(boneNames);
  const palette = resolveBodyPalette(opts.palette);
  /** Band zone: per vertex, the skin weight on the band's bone (the team band is a window along that bone). */
  const bandShare: number[] = [];
  const region: VertexRegion = { team: 0, color: [0, 0, 0] };
  const vertexNames: (string | undefined)[] = [];
  const vertexWeights: number[] = [];

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
  let pivotSum = 0;
  let pivotCount = 0;
  let vertexLumaSum = 0;
  let texturedCount = 0;

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
    // With a layer table every material with a map is textured, on its own layer; without one only the atlas is.
    const layer = table && uv !== undefined ? table.layerOf(material) : NO_LAYER;
    const textured = table
      ? layer !== NO_LAYER
      : atlas !== null &&
        map !== null &&
        (map === atlas || map.source === atlas.source) &&
        uv !== undefined;
    const meshPx = textured ? (table ? statsOf(map) : atlasPx) : null;
    base.copy(material.color ?? new Color(1, 1, 1));
    const materialMask = teamPattern?.test(material.name) ? 1 : 0;
    if (materialMask && teamPattern === TEAM_MATERIAL_FALLBACK)
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
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += sw.getComponent(i, k);
      vertexNames.length = vertexWeights.length = 0;
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
        vertexNames.push(ref === undefined ? undefined : boneNames[ref]);
        vertexWeights.push(w);
      }
      const r = vc ? vc.getX(i) : 1;
      const gg = vc ? vc.getY(i) : 1;
      const b = vc ? vc.getZ(i) : 1;
      let mask = materialMask;
      let cr = base.r * r;
      let cg = base.g * gg;
      let cb = base.b * b;
      if (regions) {
        vertexRegion(vertexNames, vertexWeights, TEAM_FALLBACK_BASE, region, palette);
        mask = region.team;
        [cr, cg, cb] = region.color;
      }
      col.push(cr, cg, cb, mask);
      if (regions && palette.teamZone === 'band') {
        let share = 0;
        for (let k = 0; k < 4; k++) if (vertexNames[k] === BAND_BONE) share += vertexWeights[k]!;
        bandShare.push(share);
      }
      if (table) {
        if (textured) uvs.push(uv!.getX(i), uv!.getY(i), layer);
        else uvs.push(NO_UV, NO_UV, NO_LAYER);
      } else if (atlas) {
        if (textured) uvs.push(uv!.getX(i), uv!.getY(i));
        else uvs.push(NO_UV, NO_UV);
      }
      if (mask > 0.5) {
        const t = meshPx ? texelLuma(meshPx, STATS_SIZE, uv!.getX(i), uv!.getY(i)) : 1;
        pivotSum += lumaOf(cr, cg, cb) * t;
        pivotCount++;
      } else if (textured && teamMask === 'diffuseAlpha') {
        vertexLumaSum += lumaOf(cr, cg, cb);
        texturedCount++;
      }
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(first + gi.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(first + i);
  }

  if (bandShare.length > 0) {
    // Team band: a window along the band's bone (|x| in the T-pose, shoulder end to elbow end), over the weight on it.
    let lo = Infinity;
    let hi = -Infinity;
    bandShare.forEach((share, i) => {
      if (share <= 0.5) return;
      const x = Math.abs(pos[i * 3]!);
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    });
    const length = hi - lo;
    if (length > 1e-4) {
      pivotSum = 0;
      pivotCount = 0;
      bandShare.forEach((share, i) => {
        if (share <= 0) return;
        const m = share * teamBandMask((Math.abs(pos[i * 3]!) - lo) / length);
        if (m <= 0) return;
        for (let c = 0; c < 3; c++)
          col[i * 4 + c] = col[i * 4 + c]! * (1 - m) + TEAM_FALLBACK_BASE * m;
        col[i * 4 + 3] = m;
      });
      for (let i = 0; i < col.length; i += 4)
        if (col[i + 3]! > 0.5) {
          pivotSum += lumaOf(col[i]!, col[i + 1]!, col[i + 2]!);
          pivotCount++;
        }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
  if (table) geometry.setAttribute('uvl', new BufferAttribute(new Float32Array(uvs), 3));
  else if (atlas) geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  // Float bone indices keep the vertex layout identical on the WebGPU and WebGL2 backends (as the placeholder).
  geometry.setAttribute('skinIndex', new BufferAttribute(new Float32Array(skinIndex), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(skinWeight), 4));
  const vertexCount = pos.length / 3;
  geometry.setIndex(
    new BufferAttribute(vertexCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1),
  );
  geometry.computeBoundingSphere();
  let teamPivot = pivotCount > 0 ? pivotSum / pivotCount : TEAM_PIVOT_DEFAULT;
  if (teamMask === 'diffuseAlpha') {
    // Mask per texel: the mean of the masked texels over every texture of the asset (one atlas without a layer
    // table), times the mean vertex color of the textured primitives.
    let sum = 0;
    let n = 0;
    for (const px of table ? statsCache.values() : [atlasPx]) {
      if (!px) continue;
      for (let i = 0; i < px.length; i += 4)
        if (px[i + 3]! >= 128) {
          sum += texelLuminance(px, i);
          n++;
        }
    }
    const vertexLuma = texturedCount > 0 ? vertexLumaSum / texturedCount : 1;
    if (n > 0) teamPivot = (sum / n) * vertexLuma;
  }
  return {
    geometry,
    map: atlas,
    triangles: idx.length / 3,
    textureCount: table ? table.size : maps.length,
    teamMask,
    teamPivot: Math.min(1, Math.max(0.02, teamPivot)),
    boneNames,
    farTeam: palette.farTeam,
  };
}
