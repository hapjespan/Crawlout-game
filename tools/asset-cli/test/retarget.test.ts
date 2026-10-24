// Retargeten met twee synthetische skeletten: verschillende rustposes (T-pose tegen hangende armen, een gedraaide
// rustrotatie op de romp) en verschillende beenlengtes. Geen bronassets nodig.
import { Document, type Node } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import {
  multiply,
  normalize3,
  quatFromAxisAngle,
  quatMultiply,
  quatRotate,
  sub3,
} from '../src/math.js';
import { retargetClips } from '../src/retarget.js';

type Bone = [
  name: string,
  parent: string | null,
  t: [number, number, number],
  r?: [number, number, number, number],
];

function rig(bones: readonly Bone[]): { doc: Document; nodes: Map<string, Node> } {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene();
  const nodes = new Map<string, Node>();
  const skin = doc.createSkin();
  for (const [name, parent, t, r] of bones) {
    const node = doc.createNode(name).setTranslation(t);
    if (r) node.setRotation(r);
    (parent ? nodes.get(parent)! : scene).addChild(node);
    nodes.set(name, node);
    skin.addJoint(node);
  }
  return { doc, nodes };
}

/** Bron: T-pose, benen 0,9 m (heup op 1 m, voet op 0,1 m). */
const SOURCE: Bone[] = [
  ['Hips', null, [0, 1, 0]],
  ['Spine', 'Hips', [0, 0.2, 0]],
  ['LeftArm', 'Spine', [0.2, 0.3, 0]],
  ['LeftForeArm', 'LeftArm', [0.3, 0, 0]],
  ['LeftHand', 'LeftForeArm', [0.3, 0, 0]],
  ['LeftUpLeg', 'Hips', [0.1, 0, 0]],
  ['LeftLeg', 'LeftUpLeg', [0, -0.45, 0]],
  ['LeftFoot', 'LeftLeg', [0, -0.45, 0]],
];

const Z90 = quatFromAxisAngle([0, 0, 1], -Math.PI / 2);
const ODD = quatFromAxisAngle([1, 1, 0], 0.7);

/**
 * Doel: armen hangend (de bovenarm wijst in rust naar -Y in plaats van +X), een romp met een willekeurige rustrotatie
 * (de kinderen compenseren, zodat de posities kloppen), benen twee keer zo lang, en een extra bone zonder bron.
 */
function target() {
  const inv = [-ODD[0], -ODD[1], -ODD[2], ODD[3]] as [number, number, number, number];
  const armOffset = quatRotate(inv, [0.2, 0.3, 0]);
  return rig([
    ['Hips', null, [0, 2, 0]],
    ['Spine', 'Hips', [0, 0.2, 0], ODD],
    ['LeftArm', 'Spine', armOffset as [number, number, number], quatMultiply(inv, Z90)],
    ['LeftForeArm', 'LeftArm', [0.3, 0, 0]],
    ['LeftHand', 'LeftForeArm', [0.3, 0, 0]],
    ['LeftUpLeg', 'Hips', [0.1, 0, 0]],
    ['LeftLeg', 'LeftUpLeg', [0, -0.9, 0]],
    ['LeftFoot', 'LeftLeg', [0, -0.9, 0]],
    ['Tail', 'Hips', [0, 0, -0.2]],
  ]);
}

/** Bronclip "clip" van 1 s: per bone een rotatie (lokaal, eind) en optioneel een heup-translatie. */
function addClip(
  doc: Document,
  nodes: Map<string, Node>,
  rotations: Record<string, [number, number, number, number]>,
  hipsTranslation?: [number, number, number],
): void {
  const anim = doc.createAnimation('clip');
  const buffer = doc.getRoot().listBuffers()[0]!;
  const input = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Float32Array([0, 1]))
    .setBuffer(buffer);
  const add = (node: Node, path: 'rotation' | 'translation', values: number[]) => {
    const sampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setOutput(
        doc
          .createAccessor()
          .setType(path === 'rotation' ? 'VEC4' : 'VEC3')
          .setArray(new Float32Array(values))
          .setBuffer(buffer),
      );
    anim
      .addSampler(sampler)
      .addChannel(
        doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler),
      );
  };
  for (const [name, end] of Object.entries(rotations)) {
    const node = nodes.get(name)!;
    add(node, 'rotation', [...node.getRotation(), ...quatMultiply(node.getRotation(), end)]);
  }
  if (hipsTranslation) {
    const t = nodes.get('Hips')!.getTranslation();
    add(nodes.get('Hips')!, 'translation', [
      ...t,
      t[0] + hipsTranslation[0],
      t[1] + hipsTranslation[1],
      t[2] + hipsTranslation[2],
    ]);
  }
}

/** Zet elke geretargete track op zijn laatste keyframe (t = 1 s). */
function poseAtEnd(doc: Document): void {
  const anim = doc.getRoot().listAnimations().at(-1)!;
  for (const channel of anim.listChannels()) {
    const out = channel.getSampler()!.getOutput()!;
    const last = out.getElement(out.getCount() - 1, new Array(out.getElementSize()).fill(0));
    if (channel.getTargetPath() === 'rotation') channel.getTargetNode()!.setRotation(last as never);
    else channel.getTargetNode()!.setTranslation(last as never);
  }
}

const pos = (n: Node) => n.getWorldTranslation() as [number, number, number];
const dir = (a: Node, b: Node) => normalize3(sub3(pos(b), pos(a)));

/**
 * Hangt een geskinde schil van straal `radius` om LeftLeg aan een rig, zodat het document iets heeft om de
 * grondbeperking op te meten. Zonder mesh is er geen beperking; met mesh bepaalt de dikte hoe diep hij zakt.
 */
function addShell(doc: Document, nodes: Map<string, Node>, radius: number): void {
  const buffer = doc.getRoot().listBuffers()[0]!;
  const skin = doc.getRoot().listSkins()[0]!;
  const joints = skin.listJoints();
  const index = joints.findIndex((j) => j.getName() === 'LeftLeg');
  const ibm: number[] = [];
  for (const joint of joints) {
    const w = joint.getWorldTranslation();
    ibm.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -w[0], -w[1], -w[2], 1);
  }
  skin.setInverseBindMatrices(
    doc.createAccessor().setType('MAT4').setArray(new Float32Array(ibm)).setBuffer(buffer),
  );
  const origin = joints[index]!.getWorldTranslation();
  const positions: number[] = [];
  const jointIds: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    positions.push(origin[0] + Math.cos(a) * radius, origin[1], origin[2] + Math.sin(a) * radius);
    jointIds.push(index, 0, 0, 0);
    weights.push(1, 0, 0, 0);
  }
  const prim = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer),
    )
    .setAttribute(
      'JOINTS_0',
      doc.createAccessor().setType('VEC4').setArray(new Uint16Array(jointIds)).setBuffer(buffer),
    )
    .setAttribute(
      'WEIGHTS_0',
      doc.createAccessor().setType('VEC4').setArray(new Float32Array(weights)).setBuffer(buffer),
    );
  doc
    .getRoot()
    .listScenes()[0]!
    .addChild(
      doc.createNode('shell').setMesh(doc.createMesh('shell').addPrimitive(prim)).setSkin(skin),
    );
}

/** Laagste y van de geskinde schil nadat `poseAtEnd` de laatste keyframe heeft gezet. */
function lowestShellY(doc: Document): number {
  const skin = doc.getRoot().listSkins()[0]!;
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices()!;
  const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  const position = prim.getAttribute('POSITION')!;
  const jointAttr = prim.getAttribute('JOINTS_0')!;
  let lowest = Infinity;
  const p = [0, 0, 0];
  const j = [0, 0, 0, 0];
  for (let v = 0; v < position.getCount(); v++) {
    position.getElement(v, p);
    jointAttr.getElement(v, j);
    const bind = new Float64Array(16);
    ibm.getElement(j[0]!, bind as unknown as number[]);
    const world = joints[j[0]!]!.getWorldMatrix() as unknown as number[];
    const m = multiply(world, bind);
    lowest = Math.min(lowest, m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]! + m[13]!);
  }
  return lowest;
}

describe('retargetClips', () => {
  it('neemt een rotatie van de heup over op een doel met dezelfde rustpose', () => {
    const src = rig(SOURCE);
    const tgt = rig(SOURCE);
    const yaw = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
    addClip(src.doc, src.nodes, { Hips: yaw });
    const info = retargetClips(tgt.doc, src.doc);
    expect(info.unmapped).toEqual([]);
    expect(info.clips).toEqual([{ name: 'clip', durationSeconds: 1, keyframes: 31 }]);
    poseAtEnd(tgt.doc);
    const r = tgt.nodes.get('Hips')!.getRotation();
    const dot = Math.abs(r[0] * yaw[0] + r[1] * yaw[1] + r[2] * yaw[2] + r[3] * yaw[3]);
    expect(dot).toBeCloseTo(1, 5);
  });

  it('zet een armbeweging uit een T-pose correct over op een rustpose met hangende armen en een gedraaide romp', () => {
    const src = rig(SOURCE);
    const tgt = target();
    // Bron: de bovenarm 90 graden naar voren (om -Y in de wereld: +X wordt +Z), de romp 30 graden om +Y.
    const spineTurn = quatFromAxisAngle([0, 1, 0], Math.PI / 6);
    const armForward = quatFromAxisAngle([0, 1, 0], -Math.PI / 2);
    addClip(src.doc, src.nodes, { Spine: spineTurn, LeftArm: armForward });
    const info = retargetClips(tgt.doc, src.doc);
    expect(info.unmapped).toEqual(['Tail']);
    poseAtEnd(src.doc);
    poseAtEnd(tgt.doc);
    // De botrichting van de bovenarm (en de onderarm) in de wereld is die van de bron, ondanks de andere rustpose.
    const s = (n: string) => src.nodes.get(n)!;
    const t = (n: string) => tgt.nodes.get(n)!;
    for (const [a, b] of [
      ['LeftArm', 'LeftForeArm'],
      ['LeftForeArm', 'LeftHand'],
    ] as const) {
      const ds = dir(s(a), s(b));
      const dt = dir(t(a), t(b));
      for (let k = 0; k < 3; k++) expect(dt[k]).toBeCloseTo(ds[k]!, 4);
    }
    // De romp draaide 30 graden om +Y ten opzichte van zijn eigen rustpose.
    const spineWorld = t('Spine').getWorldRotation();
    const expected = quatMultiply(spineTurn, ODD);
    const dot = Math.abs(
      spineWorld[0] * expected[0] +
        spineWorld[1] * expected[1] +
        spineWorld[2] * expected[2] +
        spineWorld[3] * expected[3],
    );
    expect(dot).toBeCloseTo(1, 4);
    // Een bone zonder bron krijgt geen kanaal en houdt zijn rustpose.
    const targets = tgt.doc
      .getRoot()
      .listAnimations()[0]!
      .listChannels()
      .map((c) => c.getTargetNode()!.getName());
    expect(targets).not.toContain('Tail');
  });

  it('schaalt de heup-translatie naar de beenlengte', () => {
    const src = rig(SOURCE);
    const tgt = target();
    addClip(src.doc, src.nodes, {}, [0.05, -0.1, 0.2]);
    const info = retargetClips(tgt.doc, src.doc);
    expect(info.translationScale).toBeCloseTo(2, 6);
    poseAtEnd(tgt.doc);
    const p = tgt.nodes.get('Hips')!.getTranslation();
    expect(p[0]).toBeCloseTo(0.1, 5);
    expect(p[1]).toBeCloseTo(2 - 0.2, 5);
    expect(p[2]).toBeCloseTo(0.4, 5);
  });

  it('tilt een clip die door de grond zakt op tot precies het grondvlak', () => {
    // De bron knielt: LeftLeg een kwartslag naar voren, zodat de schil eromheen rechtop komt te staan en met zijn
    // straal onder y = 0 duikt. De botten blijven bóven de grond - alleen de massa zakt weg.
    const src = rig(SOURCE);
    const tgt = rig(SOURCE);
    addShell(tgt.doc, tgt.nodes, 0.8);
    addClip(src.doc, src.nodes, { LeftLeg: quatFromAxisAngle([1, 0, 0], Math.PI / 2) });

    const sunk = rig(SOURCE);
    addShell(sunk.doc, sunk.nodes, 0.8);
    retargetClips(sunk.doc, src.doc, { ground: false });
    poseAtEnd(sunk.doc);
    const before = lowestShellY(sunk.doc);
    expect(before).toBeLessThan(-0.1);

    const info = retargetClips(tgt.doc, src.doc);
    expect(info.groundVertices).toBe(16);
    expect(info.clips[0]!.penetrationMm).toBeCloseTo(-before * 1000, 3);
    expect(info.clips[0]!.liftedFraction).toBeGreaterThan(0);
    poseAtEnd(tgt.doc);
    expect(lowestShellY(tgt.doc)).toBeCloseTo(0, 6);
  });

  it('drukt niets omlaag dat al boven de grond zweeft en laat de rotaties met rust', () => {
    const src = rig(SOURCE);
    const tgt = rig(SOURCE);
    addShell(tgt.doc, tgt.nodes, 0.02);
    // Alleen de arm beweegt; de voeten blijven staan waar ze stonden en de schil blijft ruim boven nul.
    addClip(src.doc, src.nodes, { LeftArm: quatFromAxisAngle([0, 1, 0], 0.5) });
    const info = retargetClips(tgt.doc, src.doc);
    expect(info.clips[0]!.penetrationMm).toBe(0);
    expect(info.clips[0]!.liftedFraction).toBe(0);
    // Zonder doordringing blijft de heup exact op zijn rustpositie staan: de beperking tilt alleen op.
    poseAtEnd(tgt.doc);
    expect(tgt.nodes.get('Hips')!.getTranslation()).toEqual([0, 1, 0]);
  });

  it('respecteert groundY en het plafond maxLift', () => {
    const src = rig(SOURCE);
    addClip(src.doc, src.nodes, { LeftLeg: quatFromAxisAngle([1, 0, 0], Math.PI / 2) });
    // Een hoger grondvlak vraagt meer lift; maxLift kapt die af, zodat één losse vertex de hele unit niet wegschiet.
    const high = rig(SOURCE);
    addShell(high.doc, high.nodes, 0.8);
    retargetClips(high.doc, src.doc, { groundY: 0.1 });
    poseAtEnd(high.doc);
    expect(lowestShellY(high.doc)).toBeCloseTo(0.1, 6);

    const capped = rig(SOURCE);
    addShell(capped.doc, capped.nodes, 0.8);
    const info = retargetClips(capped.doc, src.doc, { maxLift: 0.01 });
    poseAtEnd(capped.doc);
    // De gemelde doordringing is de gemeten waarde, de toegepaste correctie is afgekapt op 10 mm.
    const penetrationMm = info.clips[0]!.penetrationMm ?? 0;
    expect(penetrationMm).toBeGreaterThan(100);
    expect(lowestShellY(capped.doc)).toBeCloseTo(-penetrationMm / 1000 + 0.01, 6);
  });

  it('volgt een koppeling op andere naam (bones) en zonder uitlijning blijft het een pure rustpose-delta', () => {
    const src = rig(SOURCE);
    const tgt = rig(
      SOURCE.map(
        ([n, p, t, r]) => [n === 'Spine' ? 'Chest' : n, p === 'Spine' ? 'Chest' : p, t, r] as Bone,
      ),
    );
    const turn = quatFromAxisAngle([1, 0, 0], 0.4);
    addClip(src.doc, src.nodes, { Spine: turn });
    const info = retargetClips(tgt.doc, src.doc, { bones: { Chest: 'Spine' }, alignRest: false });
    expect(info.mapping.Chest).toBe('Spine');
    poseAtEnd(tgt.doc);
    const r = tgt.nodes.get('Chest')!.getRotation();
    const dot = Math.abs(r[0] * turn[0] + r[1] * turn[1] + r[2] * turn[2] + r[3] * turn[3]);
    expect(dot).toBeCloseTo(1, 5);
  });
});
