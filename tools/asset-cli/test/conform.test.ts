import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneBones } from '../src/bones.js';
import { buildAssets } from '../src/build.js';
import { parseClipmap } from '../src/clipmap.js';
import { conformDocument } from '../src/conform.js';
import { facingZ, countTriangles } from '../src/inspect.js';
import { simplifyToTarget } from '../src/lods.js';
import { manifestSchema } from '../src/manifest.js';
import { parseRigmap } from '../src/rigmap.js';
import { validateAsset } from '../src/validate.js';
import { UE_CLIPMAP, UE_CLIPS, UE_TO_MIXAMO, makeProp, makeUeSource } from './fixtures.js';

const io = new NodeIO();
const clipmap = parseClipmap({ assets: { ue: UE_CLIPMAP } });
const rigmap = parseRigmap({ rigs: { ue: { bones: UE_TO_MIXAMO } }, assets: { ue: { rig: 'ue', lod0Triangles: 3600 } } });

type Weights = { joints: number[][]; weights: number[][] };
function readInfluences(document: Document): Weights {
  const prim = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  const j = prim.getAttribute('JOINTS_0')!;
  const w = prim.getAttribute('WEIGHTS_0')!;
  const out: Weights = { joints: [], weights: [] };
  for (let i = 0; i < j.getCount(); i++) {
    out.joints.push(j.getElement(i, [0, 0, 0, 0]));
    out.weights.push(w.getElement(i, [0, 0, 0, 0]));
  }
  return out;
}

describe('bone-snoeien', () => {
  it('telt gewichten van vingers en leafs op bij de ouder en normaliseert', async () => {
    const doc = await io.readBinary(await makeUeSource({ segments: 8, rings: 8 }));
    const joints = doc.getRoot().listSkins()[0]!.listJoints();
    expect(joints.length).toBe(36);
    const before = readInfluences(doc);
    // Bronvertex: 0.4 hoofdbone (pelvis), 0.3 index_01_l, 0.2 index_02_l_leaf, 0.1 ball_l_leaf.
    expect(before.joints[0]![0]).toBe(joints.findIndex((j) => j.getName() === 'pelvis'));

    const result = pruneBones(doc, UE_TO_MIXAMO);
    const skin = doc.getRoot().listSkins()[0]!;
    const after = skin.listJoints();
    expect(result.bonesBefore).toBe(36);
    expect(result.bonesAfter).toBe(20);
    expect(after.length).toBe(20);
    expect(after.length).toBeLessThanOrEqual(28);
    expect(after.map((j) => j.getName())).toEqual([
      'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
      'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot',
      'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightUpLeg', 'RightLeg', 'RightFoot',
    ]);
    for (const name of after.map((j) => j.getName())) expect(name).not.toMatch(/index|thumb|leaf|ball|root/);

    const { joints: j, weights: w } = readInfluences(doc);
    const hips = after.findIndex((n) => n.getName() === 'Hips');
    const leftHand = after.findIndex((n) => n.getName() === 'LeftHand');
    const leftFoot = after.findIndex((n) => n.getName() === 'LeftFoot');
    for (let v = 0; v < w.length; v++) {
      expect(w[v]!.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
      for (const index of j[v]!) expect(index).toBeLessThan(after.length);
    }
    // Eerste vertex: pelvis 0.4 blijft Hips; vinger en leaf (0.3 + 0.2) gaan naar LeftHand; ball_l_leaf (0.1) naar LeftFoot.
    // Op gewicht gesorteerd: LeftHand (0.5) staat vóór Hips (0.4).
    expect(j[0]![0]).toBe(leftHand);
    const byJoint = new Map(j[0]!.flatMap((index, k) => (w[0]![k]! > 0 ? [[index, w[0]![k]!] as const] : [])));
    expect(byJoint.get(hips)).toBeCloseTo(0.4, 5);
    expect(byJoint.get(leftHand)).toBeCloseTo(0.5, 5);
    expect(byJoint.get(leftFoot)).toBeCloseTo(0.1, 5);
  });

  it('houdt de joint-volgorde en de inverse-bindmatrices van de behouden bones', async () => {
    const doc = await io.readBinary(await makeUeSource({ segments: 8, rings: 8 }));
    const oldJoints = doc.getRoot().listSkins()[0]!.listJoints().map((j) => j.getName());
    pruneBones(doc, UE_TO_MIXAMO);
    const skin = doc.getRoot().listSkins()[0]!;
    const ibm = skin.getInverseBindMatrices()!;
    expect(ibm.getCount()).toBe(20);
    const oldOrder = oldJoints.filter((n) => n in UE_TO_MIXAMO);
    skin.listJoints().forEach((joint, i) => {
      expect(joint.getName()).toBe(UE_TO_MIXAMO[oldOrder[i] as keyof typeof UE_TO_MIXAMO]);
      expect(ibm.getElement(i, new Array<number>(16).fill(0))[12]).toBe(oldJoints.indexOf(oldOrder[i]!));
    });
  });

  it('laat animatiekanalen van gesnoeide bones vallen', async () => {
    const doc = await io.readBinary(await makeUeSource({ segments: 8, rings: 8 }));
    const channels = (): number => doc.getRoot().listAnimations().reduce((n, a) => n + a.listChannels().length, 0);
    expect(channels()).toBe(UE_CLIPS.length * 4);
    const result = pruneBones(doc, UE_TO_MIXAMO);
    // root, index_01_l en index_02_l_leaf per clip weg; alleen pelvis (Hips) blijft.
    expect(result.channelsDropped).toBe(UE_CLIPS.length * 3);
    expect(channels()).toBe(UE_CLIPS.length);
    for (const animation of doc.getRoot().listAnimations()) {
      expect(animation.listChannels().map((c) => c.getTargetNode()?.getName())).toEqual(['Hips']);
      expect(animation.listSamplers().length).toBe(1);
    }
    // De static root blijft als gewone node boven Hips, de vingerbones zijn uit de scene.
    const names = doc.getRoot().listNodes().map((n) => n.getName());
    expect(names).toContain('root');
    expect(names.filter((n) => /index|thumb|leaf|ball/.test(n))).toEqual([]);
  });

  it('weigert een rigmap die geen bone herkent of een dubbele doelnaam geeft', async () => {
    const doc = await io.readBinary(await makeUeSource({ segments: 8, rings: 8 }));
    expect(() => pruneBones(doc, { onbekend: 'Hips' })).toThrow(/geen enkele bone/);
    expect(() => pruneBones(doc, { pelvis: 'Hips', spine_01: 'Hips' })).toThrow(/dezelfde naam "Hips"/);
  });
});

describe('rigmap', () => {
  it('valideert verwijzingen en de LOD0-band', () => {
    expect(() => parseRigmap({ assets: { a: { rig: 'weg' } } })).toThrow(/onbekende rig/);
    expect(() => parseRigmap({ rigs: { r: { bones: {} } }, assets: { a: { rig: 'r', lod0Triangles: 9000 } } })).toThrow(/LOD0-band/);
    expect(parseRigmap({ assets: { prop: { scale: 0.01 } } }).assets.prop?.scale).toBe(0.01);
  });

  it('matcht botnamen hoofdletterongevoelig en hernoemt naar Mixamo', async () => {
    const doc = await io.readBinary(await makeUeSource({ segments: 8, rings: 8 }));
    pruneBones(doc, Object.fromEntries(Object.entries(UE_TO_MIXAMO).map(([k, v]) => [k.toUpperCase(), v])));
    const names = doc.getRoot().listSkins()[0]!.listJoints().map((j) => j.getName());
    expect(names).toContain('Hips');
    expect(names).toContain('RightFoot');
  });

  it('de meegeleverde assets/src/rigmap.json is geldig en dekt de karakter- en propnamen', () => {
    const map = parseRigmap(JSON.parse(readFileSync(new URL('../../../assets/src/rigmap.json', import.meta.url), 'utf8')));
    const bones = map.rigs['quaternius-ual']!.bones;
    expect(bones['DEF-hips']).toBe('Hips');
    expect(bones['pelvis']).toBe('Hips');
    expect(map.assets['dweller_body_human']?.rig).toBe('quaternius-ual');
    expect(Object.keys(map.assets).filter((id) => map.assets[id]?.scale === 0.01).length).toBe(10);
  });
});

describe('simplify met skinning', () => {
  it('reduceert naar de LOD0-band en houdt geldige, genormaliseerde skinning-attributen', async () => {
    const doc = await io.readBinary(await makeUeSource());
    expect(countTriangles(doc)).toBe(9600);
    const info = await conformDocument(doc, { assetId: 'ue', rigmap, clipmap });
    const tris = countTriangles(doc);
    expect(info.reduced).toBe(true);
    expect(tris).toBeGreaterThanOrEqual(3000);
    expect(tris).toBeLessThanOrEqual(4000);
    const { joints, weights } = readInfluences(doc);
    const jointCount = doc.getRoot().listSkins()[0]!.listJoints().length;
    expect(jointCount).toBe(20);
    for (let v = 0; v < joints.length; v++) {
      expect(weights[v]!.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
      for (const index of joints[v]!) expect(index).toBeLessThan(jointCount);
    }
    const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    expect(prim.listSemantics()).toEqual(expect.arrayContaining(['POSITION', 'JOINTS_0', 'WEIGHTS_0', 'TEXCOORD_0']));
    expect(prim.listSemantics()).not.toContain('TEXCOORD_1');
    expect(info.extraUvSetsRemoved).toBe(1);
  });

  it('simplifyToTarget laat een mesh onder het doel ongemoeid', async () => {
    const doc = await io.readBinary(await makeUeSource({ segments: 10, rings: 10 }));
    await simplifyToTarget(doc, 5000);
    expect(countTriangles(doc)).toBe(200);
  });
});

describe('clips en validatie na conform', () => {
  it('selecteert de acht gemapte clips met canonieke namen en laat de rest vallen', async () => {
    const doc = await io.readBinary(await makeUeSource({ segments: 8, rings: 8 }));
    const info = await conformDocument(doc, { assetId: 'ue', rigmap, clipmap });
    expect(doc.getRoot().listAnimations().map((a) => a.getName()).sort()).toEqual(['attack1', 'attack2', 'build', 'death', 'gather', 'idle', 'run', 'walk']);
    expect(info.clipsDropped.sort()).toEqual(['Dance_Loop', 'Roll']);
    expect(info.clipsKept['Jog_Fwd_Loop']).toBe('run');
    expect(validateAsset(doc, { clipmap, assetId: 'ue' }).errors).toEqual([]);
  });

  it('weigert de bron ongewijzigd zonder rigmap-entry (te veel bones en tris blijven fouten)', async () => {
    const doc = await io.readBinary(await makeUeSource());
    await conformDocument(doc, { assetId: 'ue', rigmap: parseRigmap({}), clipmap });
    const errors = validateAsset(doc, { clipmap, assetId: 'ue' }).errors.join('\n');
    expect(errors).toMatch(/36 bones, maximaal 28/);
    expect(errors).toMatch(/9600 driehoeken in LOD0/);
  });

  it('facingZ ziet of de voeten naar +Z of -Z wijzen', () => {
    const make = (zSign: number): Document => {
      const doc = new Document();
      const buffer = doc.createBuffer();
      const scene = doc.createScene();
      scene.addChild(doc.createNode('LeftFoot').setTranslation([0, 0.1, 0]));
      const position = doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array([0, 0, 0, 0, 0, zSign * 0.2, 0, 1.8, 0]));
      scene.addChild(doc.createNode('m').setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', position))));
      return doc;
    };
    expect(facingZ(make(1))).toBeGreaterThan(0.02);
    expect(facingZ(make(-1))).toBeLessThan(-0.02);
    expect(facingZ(new Document())).toBeNull();
  });
});

describe('buis met conform', () => {
  let root: string;
  let src: string;
  let dist: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'asset-cli-conform-'));
    src = join(root, 'src');
    dist = join(root, 'dist');
    mkdirSync(src);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('bouwt een zware UE-bron tot een brief-conform karakter en een prop in meters, met validatierapport', async () => {
    writeFileSync(join(src, 'ue.glb'), await makeUeSource());
    writeFileSync(join(src, 'steen.glb'), await makeProp({ segments: 30, rings: 20 }));
    writeFileSync(join(src, 'clipmap.json'), JSON.stringify({ assets: { ue: UE_CLIPMAP } }));
    writeFileSync(join(src, 'rigmap.json'), JSON.stringify({ rigs: { ue: { bones: UE_TO_MIXAMO } }, assets: { ue: { rig: 'ue', lod0Triangles: 3600 }, steen: { scale: 0.01 } } }));
    const result = await buildAssets({ srcDir: src, distDir: dist, toktx: null });
    expect(result.reports.flatMap((r) => r.errors)).toEqual([]);
    expect(result.ok).toBe(true);

    const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')));
    const ue = manifest.assets.find((a) => a.id === 'ue')!;
    expect(ue.boneCount).toBe(20);
    expect(ue.lods[0].triangles).toBeGreaterThanOrEqual(3000);
    expect(ue.lods[0].triangles).toBeLessThanOrEqual(4000);
    expect(ue.lods[1].triangles).toBeGreaterThanOrEqual(1200);
    expect(ue.lods[1].triangles).toBeLessThanOrEqual(1500);
    expect(ue.lods[2].triangles).toBeGreaterThanOrEqual(400);
    expect(ue.lods[2].triangles).toBeLessThanOrEqual(600);
    expect(ue.baked?.clips.map((c) => c.name)).toEqual(['idle', 'walk', 'run', 'attack1', 'attack2', 'gather', 'build', 'death']);
    expect(ue.baked?.width).toBe(80);
    expect(ue.animations.map((a) => a.name).sort()).toEqual(['attack1', 'attack2', 'build', 'death', 'gather', 'idle', 'run', 'walk']);
    expect(ue.sockets.hand).toBeDefined();

    const steen = manifest.assets.find((a) => a.id === 'steen')!;
    expect(steen.kind).toBe('prop');
    expect(steen.bounds.max[1]).toBeCloseTo(0.018, 3);

    const report = JSON.parse(readFileSync(join(dist, 'validation-report.json'), 'utf8')) as { ok: boolean; assets: { id: string; sourceBones: number; bones: number; clipsDropped: string[]; sourceTriangles: number; scale: number | null }[] };
    expect(report.ok).toBe(true);
    const ueReport = report.assets.find((a) => a.id === 'ue')!;
    expect(ueReport).toMatchObject({ sourceBones: 36, bones: 20, sourceTriangles: 9600 });
    expect(ueReport.clipsDropped.sort()).toEqual(['Dance_Loop', 'Roll']);
    expect(report.assets.find((a) => a.id === 'steen')?.scale).toBe(0.01);
    expect(existsSync(join(dist, 'ue/ue.anim.f32'))).toBe(true);
  });

  it('weigert een ongeldige rigmap met een leesbare reden en schrijft niets', async () => {
    writeFileSync(join(src, 'ue.glb'), await makeUeSource({ segments: 8, rings: 8 }));
    writeFileSync(join(src, 'rigmap.json'), JSON.stringify({ assets: { ue: { rig: 'weg' } } }));
    const result = await buildAssets({ srcDir: src, distDir: dist, toktx: null });
    expect(result.ok).toBe(false);
    expect(result.reports[0]?.errors.join('')).toMatch(/onbekende rig/);
    expect(existsSync(join(dist, 'manifest.json'))).toBe(false);
  });
});

describe('smoke: het echte Quaternius-bestand', () => {
  const real = new URL('../../../assets/src/characters/dweller_body_human.glb', import.meta.url);
  it.skipIf(!existsSync(real))('snoeit naar 20 bones en reduceert naar de LOD0-band, binnen 20 s', async () => {
    const started = Date.now();
    const base = new URL('../../../assets/src/', import.meta.url);
    const realRigmap = parseRigmap(JSON.parse(readFileSync(new URL('rigmap.json', base), 'utf8')));
    const realClipmap = parseClipmap(JSON.parse(readFileSync(new URL('clipmap.json', base), 'utf8')));
    const doc = await io.readBinary(new Uint8Array(readFileSync(real)));
    expect(doc.getRoot().listSkins()[0]!.listJoints().length).toBe(53);
    expect(doc.getRoot().listAnimations().length).toBe(46);
    const info = await conformDocument(doc, { assetId: 'dweller_body_human', rigmap: realRigmap, clipmap: realClipmap });
    const result = validateAsset(doc, { clipmap: realClipmap, assetId: 'dweller_body_human' });
    expect(result.errors).toEqual([]);
    expect(info.bones?.bonesAfter).toBeLessThanOrEqual(28);
    expect(result.triangles).toBeGreaterThanOrEqual(3000);
    expect(result.triangles).toBeLessThanOrEqual(4000);
    expect(doc.getRoot().listAnimations().length).toBe(8);
    expect(facingZ(doc)).toBeGreaterThan(0.02);
    expect(Date.now() - started).toBeLessThan(20_000);
  });
});
