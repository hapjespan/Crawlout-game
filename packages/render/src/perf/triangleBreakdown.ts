// Triangles of the last frame per layer, from the meshes in the scene: what a mesh draws is its triangles times its
// instances, once in the main pass and once more in the sun's shadow pass when it casts. Layers are told apart by the
// mesh names the layers give their batches (terrain-*, props-<asset>-<i>, building-*, units-*, rigid-*, ...). The sum of
// both passes matches what the renderer's own `info.render.triangles` reports for the frame (the shadow pass counts in it).
import type { Object3D } from 'three/webgpu';

export interface TriangleBreakdown {
  /** Triangles drawn into the view, per layer. */
  main: Record<string, number>;
  /** Triangles drawn into the shadow map, per layer (casters only). */
  shadow: Record<string, number>;
}

interface MeshLike extends Object3D {
  isMesh?: boolean;
  count?: number;
  geometry?: {
    index?: { count: number } | null;
    attributes?: { position?: { count: number } };
  };
}

/** The layer a mesh belongs to, from its name; props are split by the category `categoryOf` gives for the asset id. */
export function layerOfMesh(name: string, categoryOf: (assetId: string) => string | null): string {
  if (name === 'terrain-skirt') return 'terrain skirt';
  if (name.startsWith('terrain')) return 'terrain';
  if (name === 'water') return 'water';
  if (name.startsWith('props-')) {
    // props-<asset id>-<batch index>: the id may contain dashes or underscores, the index is the last segment.
    const id = name.slice('props-'.length, name.lastIndexOf('-'));
    return `props: ${categoryOf(id) ?? 'unknown'}`;
  }
  if (name.startsWith('building-') || name.startsWith('buildings-')) return 'buildings';
  if (name.startsWith('units-')) return 'units';
  if (name.startsWith('rigid-')) return 'robots';
  if (name === 'scrap-nodes' || name === 'claim-points') return 'scrap and claims';
  if (name === 'ground-decals') return 'decals';
  if (name.startsWith('vfx-')) return 'vfx';
  return 'other';
}

function trianglesOf(mesh: MeshLike): number {
  const g = mesh.geometry;
  if (!g) return 0;
  const verts = g.index ? g.index.count : (g.attributes?.position?.count ?? 0);
  return (verts / 3) * (mesh.count !== undefined ? Math.max(0, mesh.count) : 1);
}

/** Sums the scene's visible meshes per layer, main pass and shadow pass. */
export function triangleBreakdown(
  root: Object3D,
  categoryOf: (assetId: string) => string | null,
): TriangleBreakdown {
  const out: TriangleBreakdown = { main: {}, shadow: {} };
  root.traverse((node) => {
    const mesh = node as MeshLike;
    if (!mesh.isMesh || !mesh.visible) return;
    const tris = trianglesOf(mesh);
    if (tris === 0) return;
    const layer = layerOfMesh(mesh.name, categoryOf);
    out.main[layer] = (out.main[layer] ?? 0) + tris;
    if (mesh.castShadow) out.shadow[layer] = (out.shadow[layer] ?? 0) + tris;
  });
  return out;
}
