// Retargeten met twee synthetische skeletten: verschillende rustposes (T-pose tegen hangende armen, een gedraaide
// rustrotatie op de romp) en verschillende beenlengtes. Geen bronassets nodig.
import { Document, type Node } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { quatFromAxisAngle, quatMultiply, quatRotate, normalize3, sub3 } from '../src/math.js';
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
