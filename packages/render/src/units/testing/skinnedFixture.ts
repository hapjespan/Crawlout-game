// Test-only: a synthetic character asset the way the asset-cli writes one, without real art or downloads.
// A three-joint rig (Hips, Spine, Head) with inverse bind matrices, a team-masked shirt and a skin-colored body as two
// primitives, written as LOD GLBs exactly like tools/asset-cli/src/lods.ts (meshopt), optionally also quantized
// (KHR_mesh_quantization, the way gltfpack -c or gltf-transform quantize() would). The baked texture is computed
// here analytically, and the manifest follows tools/asset-cli/src/manifest.ts.
import { Document, Logger, NodeIO, type Node as GltfNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { ANIM_NAMES } from '@crawlout/protocol';
import { BoxGeometry, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import type { AssetManifest } from '@crawlout/asset-cli/manifest';

export const FIXTURE_ID = 'dweller_body_test';
/** Rest (= bind) world positions of the joints. */
export const JOINTS: readonly {
  name: string;
  parent: number;
  world: readonly [number, number, number];
}[] = [
  { name: 'Hips', parent: -1, world: [0, 1, 0] },
  { name: 'Spine', parent: 0, world: [0, 1.5, 0] },
  { name: 'Head', parent: 1, world: [0, 1.85, 0] },
];

export interface SourceVertex {
  position: [number, number, number];
  joints: [number, number, number, number];
  weights: [number, number, number, number];
  team: boolean;
}

interface Part {
  material: 'Team_Shirt' | 'Skin';
  size: [number, number, number];
  center: [number, number, number];
  /** Joint weights as a function of the vertex height. */
  skin: (y: number) => {
    joints: [number, number, number, number];
    weights: [number, number, number, number];
  };
}

const PARTS: Part[] = [
  {
    material: 'Team_Shirt',
    size: [0.5, 0.6, 0.3],
    center: [0, 1.4, 0],
    skin: (y) =>
      y < 1.3
        ? { joints: [0, 1, 0, 0], weights: [0.5, 0.5, 0, 0] }
        : { joints: [1, 0, 0, 0], weights: [1, 0, 0, 0] },
  },
  {
    material: 'Skin',
    size: [0.4, 1, 0.25],
    center: [0, 0.5, 0],
    skin: () => ({ joints: [0, 0, 0, 0], weights: [1, 0, 0, 0] }),
  },
  {
    material: 'Skin',
    size: [0.22, 0.25, 0.22],
    center: [0, 1.85, 0],
    skin: () => ({ joints: [2, 0, 0, 0], weights: [1, 0, 0, 0] }),
  },
];

export const MATERIAL_COLORS = {
  Team_Shirt: [0.6, 0.6, 0.65, 1],
  Skin: [0.8, 0.5, 0.35, 1],
} as const;

/** All source vertices, for comparing what the loader brings back. */
export function sourceVertices(): SourceVertex[] {
  const out: SourceVertex[] = [];
  for (const part of PARTS) {
    const g = new BoxGeometry(...part.size).translate(...part.center);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const s = part.skin(p.getY(i));
      out.push({
        position: [p.getX(i), p.getY(i), p.getZ(i)],
        ...s,
        team: part.material === 'Team_Shirt',
      });
    }
    g.dispose();
  }
  return out;
}

function sourceDocument(rename: Readonly<Record<string, string>> = {}): Document {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  const buffer = doc.createBuffer();
  const scene = doc.createScene('scene');
  const nodes: GltfNode[] = [];
  for (const j of JOINTS) {
    const node = doc.createNode(j.name);
    const parent = j.parent >= 0 ? JOINTS[j.parent]!.world : [0, 0, 0];
    node.setTranslation([
      j.world[0] - parent[0]!,
      j.world[1] - parent[1]!,
      j.world[2] - parent[2]!,
    ]);
    if (j.parent >= 0) nodes[j.parent]!.addChild(node);
    else scene.addChild(node);
    nodes.push(node);
  }
  const ibm = new Float32Array(JOINTS.length * 16);
  JOINTS.forEach((j, i) =>
    ibm.set(new Matrix4().makeTranslation(-j.world[0], -j.world[1], -j.world[2]).elements, i * 16),
  );
  const skin = doc
    .createSkin('skin')
    .setInverseBindMatrices(doc.createAccessor().setArray(ibm).setType('MAT4').setBuffer(buffer));
  for (const n of nodes) skin.addJoint(n);

  const mesh = doc.createMesh('body');
  for (const name of ['Team_Shirt', 'Skin'] as const) {
    const parts = PARTS.filter((p) => p.material === name);
    const pos: number[] = [];
    const nrm: number[] = [];
    const joints: number[] = [];
    const weights: number[] = [];
    const idx: number[] = [];
    for (const part of parts) {
      const g = new BoxGeometry(...part.size).translate(...part.center);
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      const base = pos.length / 3;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nrm.push(n.getX(i), n.getY(i), n.getZ(i));
        const s = part.skin(p.getY(i));
        joints.push(...s.joints);
        weights.push(...s.weights);
      }
      const gi = g.getIndex()!;
      for (let i = 0; i < gi.count; i++) idx.push(base + gi.getX(i));
      g.dispose();
    }
    const acc = (array: Float32Array | Uint16Array, type: 'VEC3' | 'VEC4' | 'SCALAR') =>
      doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
    const material = doc
      .createMaterial(rename[name] ?? name)
      .setBaseColorFactor([...MATERIAL_COLORS[name]]);
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setAttribute('POSITION', acc(new Float32Array(pos), 'VEC3'))
        .setAttribute('NORMAL', acc(new Float32Array(nrm), 'VEC3'))
        .setAttribute('JOINTS_0', acc(new Uint16Array(joints), 'VEC4'))
        .setAttribute('WEIGHTS_0', acc(new Float32Array(weights), 'VEC4'))
        .setIndices(acc(new Uint16Array(idx), 'SCALAR'))
        .setMaterial(material),
    );
  }
  scene.addChild(doc.createNode('body').setMesh(mesh).setSkin(skin));
  return doc;
}

function io(): NodeIO {
  return new NodeIO()
    .setLogger(new Logger(Logger.Verbosity.WARN))
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

/** One LOD GLB as lods.ts writes it (dedup, prune, reorder, meshopt); `quantized` adds quantize() first. */
/** `materialNames` renames the fixture's materials (Team_Shirt, Skin), e.g. to an asset without a "team" material. */
export async function fixtureGlb(
  opts: {
    meshopt?: boolean;
    quantized?: boolean;
    materialNames?: Readonly<Record<string, string>>;
  } = {},
): Promise<Uint8Array> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const doc = sourceDocument(opts.materialNames);
  if (opts.quantized) await doc.transform(quantize());
  if (opts.meshopt ?? true) {
    await doc.transform(
      dedup(),
      prune({ keepSolidTextures: true }),
      reorder({ encoder: MeshoptEncoder }),
    );
    doc
      .createExtension(EXTMeshoptCompression)
      .setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  }
  return io().writeBinary(doc);
}

/** Joint world matrices of frame f of clip c: Hips bobs and turns, Spine bends with the frame. */
export function jointWorlds(clip: number, frame: number): Matrix4[] {
  const out: Matrix4[] = [];
  const q = new Quaternion();
  JOINTS.forEach((j, i) => {
    const parent = j.parent >= 0 ? JOINTS[j.parent]!.world : [0, 0, 0];
    const local = new Vector3(
      j.world[0] - parent[0]!,
      j.world[1] - parent[1]!,
      j.world[2] - parent[2]!,
    );
    if (i === 0) local.y += 0.05 * frame;
    const angle = i === 0 ? 0.3 * clip : i === 1 ? 0.2 + 0.25 * frame : -0.1 * clip;
    q.setFromAxisAngle(i === 1 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0), angle);
    const m = new Matrix4().compose(local, q, new Vector3(1, 1, 1));
    out.push(j.parent >= 0 ? new Matrix4().multiplyMatrices(out[j.parent]!, m) : m);
  });
  return out;
}

/** Skin matrix (joint world * IBM) of a joint in a frame. */
export function skinMatrix(clip: number, frame: number, joint: number): Matrix4 {
  const w = JOINTS[joint]!.world;
  const world = jointWorlds(clip, frame)[joint]!;
  return world.clone().multiply(new Matrix4().makeTranslation(-w[0], -w[1], -w[2]));
}

export const FRAMES_PER_CLIP = 3;

/** The baked texture: RGBA float32 little-endian, row per frame, 4 texels (matrix columns) per joint. */
export function fixtureAnimF32(): ArrayBuffer {
  const width = JOINTS.length * 4;
  const height = ANIM_NAMES.length * FRAMES_PER_CLIP;
  const dv = new DataView(new ArrayBuffer(width * height * 16));
  for (let c = 0; c < ANIM_NAMES.length; c++) {
    for (let f = 0; f < FRAMES_PER_CLIP; f++) {
      const row = c * FRAMES_PER_CLIP + f;
      for (let j = 0; j < JOINTS.length; j++) {
        skinMatrix(c, f, j).elements.forEach((v, k) =>
          dv.setFloat32(((row * width + j * 4) * 4 + k) * 4, v, true),
        );
      }
    }
  }
  return dv.buffer;
}

/** A manifest with the fixture as its only character, plus a prop. */
export function fixtureManifest(id = FIXTURE_ID): AssetManifest {
  const lods = [0, 1, 2].map((level) => ({
    level,
    path: `${id}/lod${level}.glb`,
    triangles: 36,
  })) as AssetManifest['assets'][number]['lods'];
  return {
    version: 1,
    assets: [
      {
        id,
        kind: 'character',
        bounds: { min: [-0.25, 0, -0.15], max: [0.25, 1.975, 0.15] },
        lods,
        sockets: {},
        animations: ANIM_NAMES.map((name) => ({ name, durationSeconds: 1 })),
        boneCount: JOINTS.length,
        baked: {
          path: `${id}/${id}.anim.f32`,
          width: JOINTS.length * 4,
          height: ANIM_NAMES.length * FRAMES_PER_CLIP,
          fps: 30,
          clips: ANIM_NAMES.map((name, i) => ({
            name,
            startRow: i * FRAMES_PER_CLIP,
            frames: FRAMES_PER_CLIP,
            loop: name !== 'death',
            durationSeconds: 1,
          })),
        },
      },
      {
        id: 'crate',
        kind: 'prop',
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        lods: [0, 1, 2].map((level) => ({
          level,
          path: `crate/lod${level}.glb`,
          triangles: 12,
        })) as AssetManifest['assets'][number]['lods'],
        sockets: {},
        animations: [],
        boneCount: 0,
      },
    ],
  };
}
