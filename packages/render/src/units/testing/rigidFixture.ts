// Test-only: synthetic rigid-unit (robot) assets the way the asset side will deliver them, without real art: LOD GLBs
// of stacked boxes (a "Metal" and a "Team_Plate" material, optionally with the model's origin in the middle of the
// body), and a raw manifest (rigid entries are kind 'rigid-unit', validated by the asset-cli schema, see
// rigidUnitManifest.ts) that also carries the skinned character fixture, so tests can check the routing between the two.
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { BoxGeometry } from 'three/webgpu';
import { FIXTURE_ID, fixtureManifest } from './skinnedFixture.js';

export const GUARD_ID = 'dweller_robot_guard';
export const DRONE_ID = 'dweller_robot_drone';
export const SENTINEL_ID = 'dweller_robot_sentinel';

/** Triangles per LOD of a robot GLB: 12 per box, `parts` boxes of Metal plus one Team_Plate box. */
export const PARTS_PER_LOD = [3, 2, 1] as const;
const trianglesOf = (parts: number): number => (parts + 1) * 12;
export const TRIANGLES = PARTS_PER_LOD.map(trianglesOf) as [number, number, number];

export interface RigidGlbOptions {
  /** Metal boxes besides the team plate. */
  parts: number;
  /** Height of the model and the y of its lowest point (a model authored with its origin in the middle: negative). */
  height: number;
  lowest?: number;
  /** Name of the team material. Default 'Team_Plate'. */
  teamName?: string;
}

/** One robot LOD as a GLB: a column of boxes from `lowest` up, the top box with the team plate on its front. */
export async function rigidGlb(opts: RigidGlbOptions): Promise<Uint8Array> {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  const buffer = doc.createBuffer();
  const scene = doc.createScene('scene');
  const lowest = opts.lowest ?? 0;
  const slice = opts.height / (opts.parts + 1);
  const acc = (array: Float32Array | Uint16Array, type: 'VEC3' | 'SCALAR') =>
    doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  const primitive = (
    boxes: { y: number; w: number; d: number }[],
    material: ReturnType<Document['createMaterial']>,
  ) => {
    const pos: number[] = [];
    const nrm: number[] = [];
    const idx: number[] = [];
    for (const box of boxes) {
      const g = new BoxGeometry(box.w, slice, box.d).translate(0, box.y, 0);
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      const base = pos.length / 3;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      }
      const gi = g.getIndex()!;
      for (let i = 0; i < gi.count; i++) idx.push(base + gi.getX(i));
      g.dispose();
    }
    return doc
      .createPrimitive()
      .setAttribute('POSITION', acc(new Float32Array(pos), 'VEC3'))
      .setAttribute('NORMAL', acc(new Float32Array(nrm), 'VEC3'))
      .setIndices(acc(new Uint16Array(idx), 'SCALAR'))
      .setMaterial(material);
  };
  const metal = doc.createMaterial('Metal').setBaseColorFactor([0.5, 0.5, 0.55, 1]);
  const team = doc
    .createMaterial(opts.teamName ?? 'Team_Plate')
    .setBaseColorFactor([0.7, 0.7, 0.7, 1]);
  const mesh = doc.createMesh('robot');
  const metalBoxes = Array.from({ length: opts.parts }, (_, k) => ({
    y: lowest + slice * (k + 0.5),
    w: 0.9,
    d: 0.6,
  }));
  mesh.addPrimitive(primitive(metalBoxes, metal));
  mesh.addPrimitive(primitive([{ y: lowest + slice * (opts.parts + 0.5), w: 0.6, d: 0.7 }], team));
  scene.addChild(doc.createNode('robot').setMesh(mesh));
  return new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).writeBinary(doc);
}

export interface RigidFixtureEntry {
  id: string;
  height: number;
  /** y of the lowest point as authored (a floating unit: its hover height, baked in). */
  lowest?: number;
  hover?: number;
  /** Team material name in the manifest's teamMaterials (and in the GLB unless `glbMaterial` says otherwise). */
  teamName?: string;
  /** Name of the GLB's team plate material, when it should differ from the manifest's teamMaterials. */
  glbMaterial?: string;
}

export const FIXTURE_ENTRIES: readonly RigidFixtureEntry[] = [
  { id: GUARD_ID, height: 2.2 },
  { id: DRONE_ID, height: 0.8, hover: 1.35, lowest: 1.35 }, // hover baked: bounds.min.y = hover
  { id: SENTINEL_ID, height: 3.5 },
];

/** Raw manifest with the skinned fixture character, a prop and the rigid entries, as JSON would carry it. */
export function rigidManifest(entries: readonly RigidFixtureEntry[] = FIXTURE_ENTRIES): {
  version: 1;
  assets: unknown[];
} {
  const base = fixtureManifest();
  const rigid = entries.map((e) => {
    const lowest = e.lowest ?? 0;
    const entry: Record<string, unknown> = {
      id: e.id,
      kind: 'rigid-unit',
      bounds: { min: [-0.45, lowest, -0.35], max: [0.45, lowest + e.height, 0.35] },
      lods: PARTS_PER_LOD.map((_, level) => ({
        level,
        path: `${e.id}/lod${level}.glb`,
        triangles: TRIANGLES[level],
      })),
      sockets: {},
      animations: [],
      boneCount: 0,
      teamMaterials: [e.teamName ?? 'Team_Plate'],
    };
    if (e.hover !== undefined) entry.hover = e.hover;
    return entry;
  });
  return { version: 1, assets: [...base.assets, ...rigid] };
}

/** Files of the rigid entries by manifest-relative path. */
export async function rigidFiles(
  entries: readonly RigidFixtureEntry[] = FIXTURE_ENTRIES,
): Promise<Map<string, ArrayBuffer>> {
  const files = new Map<string, ArrayBuffer>();
  for (const e of entries)
    for (const [level, parts] of PARTS_PER_LOD.entries()) {
      const glb = await rigidGlb({
        parts,
        height: e.height,
        lowest: e.lowest ?? 0,
        ...((e.glbMaterial ?? e.teamName) ? { teamName: (e.glbMaterial ?? e.teamName)! } : {}),
      });
      files.set(`${e.id}/lod${level}.glb`, glb.slice().buffer as ArrayBuffer);
    }
  return files;
}

export { FIXTURE_ID };
