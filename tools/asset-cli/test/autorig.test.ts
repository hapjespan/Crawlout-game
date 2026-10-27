// Auto-rigging (src/autorig.ts) on synthetic box figures: a T-pose reference with a skeleton, skin and clips, and a
// static source in A-pose, in centimeters, off-centre, with a small stud on the head. No source art.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO, type Node } from '@gltf-transform/core';
import { ANIM_NAMES } from '@crawlout/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { autoRig } from '../src/autorig.js';
import { bakeAnimations } from '../src/bake.js';
import { buildAssets } from '../src/build.js';
import { EMPTY_CLIPMAP, resolveClips } from '../src/clipmap.js';
import { manifestSchema } from '../src/manifest.js';
import { parseRigmap } from '../src/rigmap.js';
import { boneRegion } from '../src/textures.js';
import { makePng } from './fixtures.js';

type V3 = [number, number, number];

/** T-pose joints (meters, model space; rest rotations identity). */
const JOINTS: [string, string | null, V3][] = [
  ['Hips', null, [0, 0.95, 0]],
  ['Spine', 'Hips', [0, 1.05, 0]],
  ['Spine1', 'Spine', [0, 1.2, 0]],
  ['Spine2', 'Spine1', [0, 1.35, 0]],
  ['Neck', 'Spine2', [0, 1.5, 0]],
  ['Head', 'Neck', [0, 1.6, 0]],
  ['LeftShoulder', 'Spine2', [0.05, 1.44, 0]],
  ['LeftArm', 'LeftShoulder', [0.2, 1.44, 0]],
  ['LeftForeArm', 'LeftArm', [0.5, 1.44, 0]],
  ['LeftHand', 'LeftForeArm', [0.75, 1.44, 0]],
  ['RightShoulder', 'Spine2', [-0.05, 1.44, 0]],
  ['RightArm', 'RightShoulder', [-0.2, 1.44, 0]],
  ['RightForeArm', 'RightArm', [-0.5, 1.44, 0]],
  ['RightHand', 'RightForeArm', [-0.75, 1.44, 0]],
  ['LeftUpLeg', 'Hips', [0.1, 0.9, 0]],
  ['LeftLeg', 'LeftUpLeg', [0.1, 0.5, 0]],
  ['LeftFoot', 'LeftLeg', [0.1, 0.1, 0]],
  ['RightUpLeg', 'Hips', [-0.1, 0.9, 0]],
  ['RightLeg', 'RightUpLeg', [-0.1, 0.5, 0]],
  ['RightFoot', 'RightLeg', [-0.1, 0.1, 0]],
];

interface Part {
  name: string;
  min: V3;
  max: V3;
}
const BODY: Part[] = [
  { name: 'torso', min: [-0.2, 0.85, -0.12], max: [0.2, 1.5, 0.12] },
  { name: 'head', min: [-0.1, 1.5, -0.1], max: [0.1, 1.8, 0.12] },
  { name: 'armL', min: [0.18, 1.38, -0.06], max: [0.9, 1.5, 0.06] },
  { name: 'armR', min: [-0.9, 1.38, -0.06], max: [-0.18, 1.5, 0.06] },
  { name: 'legL', min: [0.03, 0, -0.07], max: [0.17, 0.9, 0.07] },
  { name: 'legR', min: [-0.17, 0, -0.07], max: [-0.03, 0.9, 0.07] },
  { name: 'footL', min: [0.03, 0, -0.05], max: [0.17, 0.08, 0.2] },
  { name: 'footR', min: [-0.17, 0, -0.05], max: [-0.03, 0.08, 0.2] },
];
// Off the head's vertex grid, so it stays a loose part instead of welding into the head.
const STUD: Part = { name: 'stud', min: [0.013, 1.8, 0.013], max: [0.033, 1.82, 0.033] };

/** A closed box with every face split into n x n quads (outward winding); part tags per vertex. */
function boxes(parts: Part[], n = 4): { pos: number[]; idx: number[]; tag: string[] } {
  const pos: number[] = [];
  const idx: number[] = [];
  const tag: string[] = [];
  for (const part of parts) {
    const { min, max } = part;
    // Faces: axis, sign; u and v axes chosen so (u x v) points along the outward normal.
    const faces: [number, 1 | -1, number, number][] = [
      [0, 1, 1, 2],
      [0, -1, 2, 1],
      [1, 1, 2, 0],
      [1, -1, 0, 2],
      [2, 1, 0, 1],
      [2, -1, 1, 0],
    ];
    for (const [axis, sign, ua, va] of faces) {
      const base = pos.length / 3;
      for (let j = 0; j <= n; j++)
        for (let i = 0; i <= n; i++) {
          const p: V3 = [0, 0, 0];
          p[axis] = sign > 0 ? max[axis]! : min[axis]!;
          p[ua] = min[ua]! + ((max[ua]! - min[ua]!) * i) / n;
          p[va] = min[va]! + ((max[va]! - min[va]!) * j) / n;
          pos.push(...p);
          tag.push(part.name);
        }
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const a = base + j * (n + 1) + i;
          idx.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
        }
    }
  }
  return { pos, idx, tag };
}

function uvOf(pos: number[]): Float32Array {
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0; i < pos.length / 3; i++) {
    uv[i * 2] = (pos[i * 3]! + 1) / 2;
    uv[i * 2 + 1] = 1 - pos[i * 3 + 1]! / 2;
  }
  return uv;
}

/** Reference: T-pose boxes skinned to Hips, the 20-bone skeleton and the eight clips (a forearm bend). */
async function makeReference(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('scene');
  const nodes = new Map<string, Node>();
  for (const [name, parent, at] of JOINTS) {
    const p = parent ? JOINTS.find((j) => j[0] === parent)![2] : ([0, 0, 0] as V3);
    const node = doc
      .createNode(`mixamorig:${name}`)
      .setTranslation([at[0] - p[0], at[1] - p[1], at[2] - p[2]]);
    (parent ? nodes.get(parent)! : scene).addChild(node);
    nodes.set(name, node);
  }
  const { pos, idx } = boxes(BODY);
  const count = pos.length / 3;
  const acc = (
    a: Float32Array | Uint16Array | Uint32Array,
    type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR' | 'MAT4',
  ) => doc.createAccessor().setArray(a).setType(type).setBuffer(buffer);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc(new Float32Array(pos), 'VEC3'))
    .setAttribute('TEXCOORD_0', acc(uvOf(pos), 'VEC2'))
    .setAttribute('JOINTS_0', acc(new Uint16Array(count * 4), 'VEC4'))
    .setAttribute('WEIGHTS_0', acc(weights, 'VEC4'))
    .setIndices(acc(new Uint32Array(idx), 'SCALAR'))
    .setMaterial(doc.createMaterial('M_Main'));
  const ibm = new Float32Array(JOINTS.length * 16);
  JOINTS.forEach(([, , at], j) => {
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -at[0], -at[1], -at[2], 1], j * 16);
  });
  const skin = doc.createSkin('skin').setInverseBindMatrices(acc(ibm, 'MAT4'));
  for (const [name] of JOINTS) skin.addJoint(nodes.get(name)!);
  scene.addChild(
    doc
      .createNode('Mannequin')
      .setMesh(doc.createMesh('Mannequin').addPrimitive(prim))
      .setSkin(skin),
  );
  const s = Math.sin(Math.PI / 4);
  for (const name of ANIM_NAMES) {
    const sampler = doc
      .createAnimationSampler()
      .setInput(acc(new Float32Array([0, 0.5, 1]), 'SCALAR'))
      .setOutput(acc(new Float32Array([0, 0, 0, 1, 0, 0, s, s, 0, 0, 0, 1]), 'VEC4'));
    const channel = doc
      .createAnimationChannel()
      .setTargetNode(nodes.get('LeftForeArm')!)
      .setTargetPath('rotation')
      .setSampler(sampler);
    doc.createAnimation(name).addSampler(sampler).addChannel(channel);
  }
  return new NodeIO().writeBinary(doc);
}

/** Source: the same figure in A-pose (arms 45 degrees down), in centimeters, shifted, with a stud on the head. */
async function makeSource(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const { pos, idx, tag } = boxes([...BODY, STUD]);
  const c = Math.cos(Math.PI / 4);
  for (let i = 0; i < tag.length; i++) {
    const side = tag[i] === 'armL' ? 1 : tag[i] === 'armR' ? -1 : 0;
    if (side === 0) continue;
    const x = pos[i * 3]! - side * 0.2;
    const y = pos[i * 3 + 1]! - 1.44;
    pos[i * 3] = side * 0.2 + c * x + side * c * y;
    pos[i * 3 + 1] = 1.44 - side * c * x + c * y;
  }
  const cm = pos.map((v, i) => (v + (i % 3 === 0 ? 0.05 : 0)) * 100);
  const acc = (a: Float32Array | Uint32Array, type: 'VEC2' | 'VEC3' | 'SCALAR') =>
    doc.createAccessor().setArray(a).setType(type).setBuffer(buffer);
  const texture = doc.createTexture('skin').setMimeType('image/png').setImage(makePng(8, 8));
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc(new Float32Array(cm), 'VEC3'))
    .setAttribute('TEXCOORD_0', acc(uvOf(pos), 'VEC2'))
    .setIndices(acc(new Uint32Array(idx), 'SCALAR'))
    .setMaterial(doc.createMaterial('Raider').setBaseColorTexture(texture));
  doc
    .createScene('scene')
    .addChild(doc.createNode('model').setMesh(doc.createMesh('model').addPrimitive(prim)));
  return new NodeIO().writeBinary(doc);
}

interface Rigged {
  doc: Document;
  pos: Float32Array;
  joints: Uint16Array;
  weights: Float32Array;
  names: string[];
  info: Awaited<ReturnType<typeof autoRig>>;
}

async function rig(): Promise<Rigged> {
  const io = new NodeIO();
  const doc = await io.readBinary(await makeReference());
  const info = await autoRig(await io.readBinary(await makeSource()), doc, { height: 1.8 });
  const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  return {
    doc,
    pos: prim.getAttribute('POSITION')!.getArray() as Float32Array,
    joints: prim.getAttribute('JOINTS_0')!.getArray() as Uint16Array,
    weights: prim.getAttribute('WEIGHTS_0')!.getArray() as Float32Array,
    names: doc
      .getRoot()
      .listSkins()[0]!
      .listJoints()
      .map((j) => j.getName().replace('mixamorig:', '')),
    info,
  };
}

/** Weight of vertex i on the named bones. */
function share(r: Rigged, i: number, bones: string[]): number {
  let s = 0;
  for (let k = 0; k < 4; k++)
    if (bones.includes(r.names[r.joints[i * 4 + k]!]!)) s += r.weights[i * 4 + k]!;
  return s;
}

describe('auto-rig', () => {
  it('keeps the reference skeleton, bind pose and clips, replaces the mesh and keeps the material', async () => {
    const r = await rig();
    const ref = await new NodeIO().readBinary(await makeReference());
    const skin = r.doc.getRoot().listSkins()[0]!;
    const refSkin = ref.getRoot().listSkins()[0]!;
    expect(r.names).toEqual(JOINTS.map((j) => j[0]));
    expect(Array.from(skin.getInverseBindMatrices()!.getArray()!)).toEqual(
      Array.from(refSkin.getInverseBindMatrices()!.getArray()!),
    );
    expect(
      r.doc
        .getRoot()
        .listAnimations()
        .map((a) => a.getName()),
    ).toEqual([...ANIM_NAMES]);
    expect(r.doc.getRoot().listMeshes()).toHaveLength(1);
    const material = r.doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getMaterial()!;
    expect(material.getName()).toBe('Raider');
    expect(material.getBaseColorTexture()).not.toBeNull();
    expect(
      r.doc
        .getRoot()
        .listMaterials()
        .map((m) => m.getName()),
    ).toEqual(['Raider']);
    expect(r.info.attachedComponents).toBe(1); // the stud
    // Measured from the armpit centre to the fingertip, so a little flatter than the 45 degree rotation.
    expect(r.info.armAngle.left).toBeGreaterThan(30);
    expect(r.info.armAngle.left).toBeLessThan(55);
    expect(r.info.scale).toBeCloseTo(0.01, 4);
  });

  it('gives every vertex at most 4 weights that sum to 1, on valid joints', async () => {
    const r = await rig();
    const count = r.pos.length / 3;
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        expect(r.joints[i * 4 + k]!).toBeLessThan(JOINTS.length);
        expect(r.weights[i * 4 + k]!).toBeGreaterThanOrEqual(0);
        sum += r.weights[i * 4 + k]!;
      }
      expect(sum).toBeCloseTo(1, 5);
    }
    expect(r.info.maxInfluences).toBeLessThanOrEqual(4);
  });

  it('weights the body parts to their own bones and keeps left and right apart', async () => {
    const r = await rig();
    const { tag } = boxes([...BODY, STUD]);
    const avg = (part: string, bones: string[]): number => {
      const ids = tag.map((t, i) => (t === part ? i : -1)).filter((i) => i >= 0);
      return ids.reduce((s, i) => s + share(r, i, bones), 0) / ids.length;
    };
    expect(avg('head', ['Head', 'Neck'])).toBeGreaterThan(0.9);
    expect(avg('stud', ['Head'])).toBeGreaterThan(0.9);
    expect(avg('armL', ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'])).toBeGreaterThan(
      0.9,
    );
    expect(avg('legR', ['RightUpLeg', 'RightLeg', 'RightFoot'])).toBeGreaterThan(0.85);
    expect(avg('footL', ['LeftFoot', 'LeftLeg'])).toBeGreaterThan(0.85);
    const trunk = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder'];
    expect(avg('torso', trunk)).toBeGreaterThan(0.65);
    // No vertex of the left arm or leg on a right-side bone.
    tag.forEach((t, i) => {
      if (t === 'armL' || t === 'legL' || t === 'footL')
        expect(
          share(
            r,
            i,
            JOINTS.map((j) => j[0]).filter((n) => n.startsWith('Right')),
          ),
        ).toBe(0);
    });
  });

  it('moves the A-pose arms into the T-pose of the rig, feet on the ground, 1.8 m', async () => {
    const r = await rig();
    const { tag } = boxes([...BODY, STUD]);
    let tipX = 0;
    let tipY = 0;
    let minY = Infinity;
    tag.forEach((t, i) => {
      minY = Math.min(minY, r.pos[i * 3 + 1]!);
      if (t === 'armL' && r.pos[i * 3]! > tipX) {
        tipX = r.pos[i * 3]!;
        tipY = r.pos[i * 3 + 1]!;
      }
    });
    expect(tipX).toBeGreaterThan(0.8);
    expect(Math.abs(tipY - 1.44)).toBeLessThan(0.1);
    expect(minY).toBeCloseTo(0, 1);
    expect(r.info.heightAfter).toBeGreaterThan(1.75);
    expect(r.info.heightAfter).toBeLessThan(1.9);
  });

  it('is deterministic and shares the bake of the reference', async () => {
    const a = await rig();
    const b = await rig();
    expect(Buffer.from(a.weights.buffer).equals(Buffer.from(b.weights.buffer))).toBe(true);
    expect(Buffer.from(a.pos.buffer).equals(Buffer.from(b.pos.buffer))).toBe(true);
    const bake = (doc: Document) =>
      bakeAnimations({
        assetId: 'x',
        document: doc,
        clips: resolveClips(
          doc
            .getRoot()
            .listAnimations()
            .map((x) => x.getName()),
          EMPTY_CLIPMAP,
          'x',
        ).found,
      }).data;
    const ref = await new NodeIO().readBinary(await makeReference());
    expect(Buffer.from(bake(a.doc)).equals(Buffer.from(bake(ref)))).toBe(true);
  });

  it('limits a team mask to the texels on chosen bones', async () => {
    const r = await rig();
    const texture = r.doc.getRoot().listTextures()[0]!;
    const region = boneRegion(r.doc, texture, ['LeftArm'], 0.5, 64, 64);
    const covered = region.reduce((s, v) => s + v, 0);
    expect(covered).toBeGreaterThan(0);
    expect(covered).toBeLessThan(64 * 64 * 0.25);
    // uvOf maps x to u: the left upper arm (x 0.2 to 0.5 in the source) is right of the middle.
    for (let y = 0; y < 64; y++) for (let x = 0; x < 30; x++) expect(region[y * 64 + x]).toBe(0);
  });

  it('refuses autoRig together with fit or rig', () => {
    expect(() =>
      parseRigmap({
        assets: {
          a: {
            autoRig: { from: 'a.glb', skeleton: 's.glb', rigmap: 'r', clipmap: 'c' },
            fit: { height: 1.8 },
          },
        },
      }),
    ).toThrow(/autoRig/);
  });
});

describe('auto-rig in the local pipeline', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'asset-cli-autorig-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('builds a character from a static mesh under delivered/ with the reference clips and its own texture', async () => {
    const src = join(root, 'src');
    const local = join(root, 'local');
    mkdirSync(join(src, 'characters'), { recursive: true });
    mkdirSync(join(local, 'delivered'), { recursive: true });
    writeFileSync(join(src, 'characters', 'reference.glb'), await makeReference());
    writeFileSync(join(src, 'rigmap.json'), JSON.stringify({}));
    writeFileSync(join(src, 'clipmap.json'), JSON.stringify({}));
    writeFileSync(join(local, 'delivered', 'figure.glb'), await makeSource());
    writeFileSync(join(local, 'clipmap.json'), JSON.stringify({}));
    writeFileSync(
      join(local, 'rigmap.json'),
      JSON.stringify({
        assets: {
          figure: {
            id: 'raider_body_human',
            autoRig: {
              from: 'delivered/figure.glb',
              skeleton: '../src/characters/reference.glb',
              rigmap: '../src/rigmap.json',
              clipmap: '../src/clipmap.json',
            },
          },
        },
      }),
    );
    const dist = join(root, 'dist-local');
    const result = await buildAssets({
      srcDir: local,
      distDir: dist,
      toktx: null,
      onlyConfigured: true,
    });
    expect(result.reports.flatMap((r) => r.errors)).toEqual([]);
    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')),
    );
    expect(manifest.assets.map((a) => a.id)).toEqual(['raider_body_human']);
    const entry = manifest.assets[0]!;
    expect(entry.kind).toBe('character');
    expect(entry.boneCount).toBe(20);
    expect(entry.palette).toBeUndefined();
    expect(entry.baked!.clips.map((c) => c.name)).toEqual([...ANIM_NAMES]);
    expect(entry.sockets.hand).toEqual([-0.75, 1.44, 0]);
    const report = JSON.parse(readFileSync(join(dist, 'validation-report.json'), 'utf8'));
    expect(report.assets[0].source).toBe('delivered/figure.glb');
    expect(report.assets[0].autoRig.attachedComponents).toBe(1);
  });
});
