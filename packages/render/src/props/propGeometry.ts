// Geometry for decorative props in the vertex layout of the prop material (structures/propMaterial.ts): position,
// normal, color (linear rgb, team mask 0 in alpha) and, for textured art, uv. A static GLB (an asset-cli prop LOD or
// a source file) is merged into one geometry with its node transforms applied, so a prop kind stays one instanced
// draw. Without art, a placeholder per kind (tree cone, rock block, bush, tuft) stands in.
//
// Alpha-tested art (leaf cards, grass blades: glTF alphaMode MASK, which GLTFLoader reads as material.alphaTest) gets
// a per-vertex `aCut` attribute: the cutoff of the vertex's material, 0 for an opaque one, so a tree whose trunk is
// opaque and whose leaves are masked is still one geometry, one draw. The material discards where texture alpha is
// below aCut (propMaterial.ts `alphaMask`).
//
// One texture per prop is the usual case (a palette or atlas, `map` plus `uv`). A prop whose materials use more than
// one texture (bark and leaves, say) takes the layered layout instead, as the buildings do: `uvl` = u, v and the layer
// in a texture array shared by the LODs of an asset (structures/buildingGeometry.ts TextureLayerTable, keyed by
// material name).
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  Matrix3,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three/webgpu';
import { NO_LAYER, type TextureLayerTable } from '../structures/buildingGeometry.js';
import { MeshBuilder } from '../structures/meshBuilder.js';
import { NO_UV } from '../units/gltfUnitGeometry.js';
import type { PropKind } from './propFit.js';

export class PropGeometryError extends Error {
  override name = 'PropGeometryError';
}

export interface PropMesh {
  geometry: BufferGeometry;
  /** Diffuse map shared by the textured primitives, or null (also null in the layered layout). */
  map: Texture | null;
  /** True when some primitive is alpha-tested (the geometry has the `aCut` attribute). */
  mask: boolean;
  /** True for the layered layout (`uvl` instead of `uv`, textures in the table's array). */
  layered: boolean;
  triangles: number;
  /** Top of the mesh above y = 0, meters (the mesh stands on y = 0). */
  height: number;
  /** Largest horizontal distance of a vertex from the y axis, meters. */
  radius: number;
}

interface MaterialLike extends Material {
  color?: Color;
  map?: Texture | null;
  alphaTest: number;
  transparent: boolean;
}

/** Cutoff of a glTF MASK material without an alphaCutoff (the glTF default), and of a forced mask. */
export const DEFAULT_ALPHA_CUTOFF = 0.5;

export interface PropGeometryOptions {
  /** The manifest says `alpha: 'mask'`: textured primitives are alpha-tested even if the GLB says opaque or blend. */
  forceMask?: boolean;
  /** Switches to the layered layout with this table (shared by the LODs of an asset). */
  layers?: TextureLayerTable;
}

function meshMaterial(m: Mesh): MaterialLike {
  return (Array.isArray(m.material) ? m.material[0] : m.material) as MaterialLike;
}

/** Cutoff the GLB asks of this material: MASK (three: alphaTest), or BLEND with a texture (no sorted blending here). */
function glbCutoff(material: MaterialLike): number {
  if (!material.map) return 0;
  if (material.alphaTest > 0) return material.alphaTest;
  return material.transparent ? DEFAULT_ALPHA_CUTOFF : 0;
}

/** The static meshes of a GLB scene. */
function meshesOf(root: Object3D): Mesh[] {
  root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  return meshes;
}

/** How many different textures the textured materials of a GLB use: above 1 it needs the layered layout. */
export function distinctTextures(root: Object3D): number {
  const seen = new Set<unknown>();
  for (const mesh of meshesOf(root)) {
    const map = meshMaterial(mesh).map;
    if (map && mesh.geometry.getAttribute('uv')) seen.add(map.source ?? map);
  }
  return seen.size;
}

function measure(geometry: BufferGeometry): { height: number; radius: number; minY: number } {
  const p = geometry.getAttribute('position');
  let minY = Infinity;
  let maxY = -Infinity;
  let r2 = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    r2 = Math.max(r2, x * x + z * z);
  }
  if (p.count === 0) return { height: 0, radius: 0, minY: 0 };
  return { height: maxY - minY, radius: Math.sqrt(r2), minY };
}

/**
 * Merges every mesh under `root` into one static prop geometry. Node transforms (including the dequantization
 * transform of a KHR_mesh_quantization GLB) are applied; the result stands on y = 0. Skinned meshes are rejected.
 */
export function propGeometryFromGltf(root: Object3D, opts: PropGeometryOptions = {}): PropMesh {
  const meshes = meshesOf(root);
  if (meshes.length === 0) throw new PropGeometryError('no mesh in the GLB');
  if (meshes.some((m) => (m as { isSkinnedMesh?: boolean }).isSkinnedMesh))
    throw new PropGeometryError('a prop must be static (the GLB is skinned)');

  const layers = opts.layers ?? null;
  const cutoffOf = (m: MaterialLike): number =>
    glbCutoff(m) > 0 ? glbCutoff(m) : opts.forceMask && m.map ? DEFAULT_ALPHA_CUTOFF : 0;
  // The single texture of the usual prop: the one of the first alpha-tested mesh, else the first textured one.
  const materials = meshes.map(meshMaterial);
  const atlas = layers
    ? null
    : (materials.find((m) => cutoffOf(m) > 0)?.map ?? materials.find((m) => m.map)?.map ?? null);

  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const uvs: number[] = []; // uv, or uvl in the layered layout
  const cuts: number[] = [];
  const idx: number[] = [];
  const v = new Vector3();
  const normalMatrix = new Matrix3();
  let mask = false;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const p = g.getAttribute('position');
    if (!p) throw new PropGeometryError(`mesh "${mesh.name}" has no position`);
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
    const layer = layers && map && uv ? layers.layerOf(material) : NO_LAYER;
    const textured = layers
      ? layer !== NO_LAYER
      : atlas !== null &&
        map !== null &&
        (map === atlas || map.source === atlas.source) &&
        uv !== undefined;
    // An alpha-tested material needs its texture to read alpha from.
    const cutoff = textured ? cutoffOf(material) : 0;
    if (cutoff > 0) mask = true;
    const base = material.color ?? new Color(1, 1, 1);
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    const first = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
      nrm.push(v.x, v.y, v.z);
      col.push(
        base.r * (vc ? vc.getX(i) : 1),
        base.g * (vc ? vc.getY(i) : 1),
        base.b * (vc ? vc.getZ(i) : 1),
        0,
      );
      cuts.push(cutoff);
      if (layers) {
        if (textured) uvs.push(uv!.getX(i), uv!.getY(i), layer);
        else uvs.push(0, 0, NO_LAYER);
      } else if (atlas) {
        if (textured) uvs.push(uv!.getX(i), uv!.getY(i));
        else uvs.push(NO_UV, NO_UV);
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
  if (layers) geometry.setAttribute('uvl', new BufferAttribute(new Float32Array(uvs), 3));
  else if (atlas) geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  if (mask) geometry.setAttribute('aCut', new BufferAttribute(new Float32Array(cuts), 1));
  const vertexCount = pos.length / 3;
  geometry.setIndex(
    new BufferAttribute(vertexCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1),
  );
  const { height, radius, minY } = measure(geometry);
  if (Math.abs(minY) > 1e-4) geometry.translate(0, -minY, 0); // stand on y = 0
  geometry.computeBoundingSphere();
  return {
    geometry,
    map: atlas,
    mask,
    layered: layers !== null,
    triangles: idx.length / 3,
    height,
    radius,
  };
}

/** Adds a zero `aCut` attribute (nothing alpha-tested) to a geometry that lacks it, so it can share a mask material. */
export function ensureCutoffAttribute(geometry: BufferGeometry): void {
  if (geometry.getAttribute('aCut')) return;
  const n = geometry.getAttribute('position').count;
  geometry.setAttribute('aCut', new BufferAttribute(new Float32Array(n), 1));
}

const BARK = 0x5a4632;
const LEAVES = 0x6f7a3c;
const LEAVES_DARK = 0x56602f;
const STONE = 0x8a8478;
const SHRUB = 0x6a7040;
const STRAW = 0x9c9258;

/** Placeholder for a prop kind, about the size of PROP_KIND_HEIGHT (the fit scales it like real art). */
export function createPlaceholderPropGeometry(kind: PropKind): PropMesh {
  const b = new MeshBuilder();
  switch (kind) {
    case 'tree':
      b.add(new CylinderGeometry(0.12, 0.18, 1.6, 6, 1), { color: BARK, position: [0, 0.8, 0] });
      b.add(new ConeGeometry(1.25, 2.6, 7, 1), { color: LEAVES_DARK, position: [0, 2.3, 0] });
      b.add(new ConeGeometry(0.95, 2.0, 7, 1), {
        color: LEAVES,
        position: [0, 3.5, 0],
        rotation: [0, 0.4, 0],
      });
      break;
    case 'rock':
      b.add(new DodecahedronGeometry(0.8, 0), {
        color: STONE,
        position: [0, 0.5, 0],
        scale: [1.2, 0.85, 1],
      });
      break;
    case 'bush':
      b.add(new IcosahedronGeometry(0.6, 0), {
        color: SHRUB,
        position: [0, 0.5, 0],
        scale: [1.1, 0.85, 1],
      });
      break;
    case 'grass':
    case 'reed': {
      const h = kind === 'reed' ? 1.3 : 0.45;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        b.add(new ConeGeometry(0.05, h, 3, 1), {
          color: STRAW,
          position: [Math.cos(a) * 0.08, h / 2, Math.sin(a) * 0.08],
          rotation: [Math.sin(a) * 0.15, 0, Math.cos(a) * 0.15],
        });
      }
      break;
    }
    default:
      b.add(new DodecahedronGeometry(0.5, 0), { color: STONE, position: [0, 0.4, 0] });
  }
  const geometry = b.build();
  const { height, radius, minY } = measure(geometry);
  if (Math.abs(minY) > 1e-4) geometry.translate(0, -minY, 0);
  geometry.computeBoundingSphere();
  const triangles = (geometry.getIndex()?.count ?? 0) / 3;
  return { geometry, map: null, mask: false, layered: false, triangles, height, radius };
}
