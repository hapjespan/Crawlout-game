// De grondbeperking op synthetische rigs: een bot dat door de vloer draait, een dikke schil om datzelfde bot, en de
// afspraken eromheen (alleen optillen, nooit indrukken; alleen wat de root echt kan optillen telt mee).
import { Document, type Node } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { createGroundSampler } from '../src/ground.js';
import {
  compose,
  multiply,
  quatFromAxisAngle,
  type Mat,
  type Pose,
  type Quat,
} from '../src/math.js';

type Bone = [name: string, parent: string | null, t: [number, number, number]];

/**
 * Twee bones boven elkaar (Hips op 1 m, Shin eronder op 0,5 m) met één mesh: een ring van `radius` om de Shin, op
 * `along` meter onder zijn oorsprong. Elk hoekpunt hangt volledig aan Shin, dus de pose is zuiver star.
 */
function rig(radius: number, along = 0.4, extra: Bone[] = [], onExtra = 0) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const nodes = new Map<string, Node>();
  const skin = doc.createSkin();
  const bones: Bone[] = [['Hips', null, [0, 1, 0]], ['Shin', 'Hips', [0, -0.5, 0]], ...extra];
  for (const [name, parent, t] of bones) {
    const node = doc.createNode(name).setTranslation(t);
    (parent ? nodes.get(parent)! : scene).addChild(node);
    nodes.set(name, node);
    skin.addJoint(node);
  }
  // Inverse bind: de bones staan recht onder elkaar zonder rotatie, dus alleen de translatie keert om.
  const ibmValues: number[] = [];
  const worldY = new Map([
    ['Hips', 1],
    ['Shin', 0.5],
  ]);
  for (const [name] of bones) {
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    m[13] = -(worldY.get(name) ?? 0);
    ibmValues.push(...m);
  }
  skin.setInverseBindMatrices(
    doc.createAccessor().setType('MAT4').setArray(new Float32Array(ibmValues)).setBuffer(buffer),
  );

  const ring = 12;
  const positions: number[] = [];
  const joints: number[] = [];
  const weights: number[] = [];
  const bone = onExtra || 1;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2;
    positions.push(Math.cos(a) * radius, 0.5 - along, Math.sin(a) * radius);
    joints.push(bone, 0, 0, 0);
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
      doc.createAccessor().setType('VEC4').setArray(new Uint16Array(joints)).setBuffer(buffer),
    )
    .setAttribute(
      'WEIGHTS_0',
      doc.createAccessor().setType('VEC4').setArray(new Float32Array(weights)).setBuffer(buffer),
    );
  const mesh = doc.createMesh('body').addPrimitive(prim);
  const meshNode = doc.createNode('bodyNode').setMesh(mesh).setSkin(skin);
  scene.addChild(meshNode);
  return { doc, skin, nodes };
}

/** Wereldmatrices van de joints voor een set lokale poses. */
function worlds(skin: { listJoints(): Node[] }, overrides: Map<Node, Pose>): Mat[] {
  const cache = new Map<Node, Mat>();
  const rest = (n: Node): Pose =>
    ({ t: [...n.getTranslation()], r: [...n.getRotation()], s: [...n.getScale()] }) as Pose;
  const world = (n: Node): Mat => {
    let m = cache.get(n);
    if (!m) {
      const local = compose(overrides.get(n) ?? rest(n));
      const parent = n.getParentNode();
      m = parent && parent.getName() !== '' ? multiply(world(parent), local) : local;
      cache.set(n, m);
    }
    return m;
  };
  return skin.listJoints().map(world);
}

const IDENTITY: Quat = [0, 0, 0, 1];

describe('createGroundSampler', () => {
  it('meet in de rustpose de onderkant van de schil, niet de botoorsprong', () => {
    const { doc, skin } = rig(0.05);
    const sampler = createGroundSampler(doc, skin, skin.listJoints()[0]!)!;
    expect(sampler.vertexCount).toBe(12);
    expect(sampler.skipped).toBe(0);
    // De ring ligt 0,4 m onder Shin (0,5 m), dus op 0,1 m; de straal staat loodrecht en verlaagt niets.
    expect(sampler.lowestY(worlds(skin, new Map()))).toBeCloseTo(0.1, 6);
  });

  it('ziet dat een dikkere schil om dezelfde botpose dieper komt', () => {
    // Shin een kwartslag naar voren: de ring staat nu rechtop, dus zijn straal telt wél in de hoogte mee.
    const pose = (
      doc: Document,
      skin: ReturnType<typeof rig>['skin'],
      nodes: Map<string, Node>,
    ) => {
      const map = new Map<Node, Pose>();
      const shin = nodes.get('Shin')!;
      map.set(shin, {
        t: [...shin.getTranslation()],
        r: quatFromAxisAngle([1, 0, 0], Math.PI / 2),
        s: [1, 1, 1],
      } as Pose);
      return createGroundSampler(doc, skin, skin.listJoints()[0]!)!.lowestY(worlds(skin, map));
    };
    const slim = rig(0.05);
    const bulky = rig(0.2);
    const slimY = pose(slim.doc, slim.skin, slim.nodes);
    const bulkyY = pose(bulky.doc, bulky.skin, bulky.nodes);
    // Rechtopstaande ring om een bot op 0,5 m: de onderkant is 0,5 m min de straal.
    expect(slimY).toBeCloseTo(0.45, 6);
    expect(bulkyY).toBeCloseTo(0.3, 6);
    // Zelfde botpose, alleen meer massa: het verschil is precies het verschil in straal. Dit is de kern van de
    // klacht - een botcorrectie ziet hier niets, want de botten staan in beide gevallen identiek.
    expect(bulkyY).toBeCloseTo(slimY - 0.15, 6);
  });

  it('negeert hoekpunten die de root niet kan optillen', () => {
    // Een extra bone náást de root (kind van de scene), met de ring eraan: die beweegt niet mee met Hips.
    const { doc, skin, nodes } = rig(0.05, 0.4, [['Loose', null, [0, 0.2, 0]]], 2);
    expect(nodes.get('Loose')!.getParentNode()).toBeNull();
    expect(createGroundSampler(doc, skin, skin.listJoints()[0]!)).toBeNull();
  });

  it('geeft null voor een skelet zonder geskinde mesh', () => {
    const doc = new Document();
    doc.createBuffer();
    const scene = doc.createScene();
    const skin = doc.createSkin();
    const hips = doc.createNode('Hips');
    scene.addChild(hips);
    skin.addJoint(hips);
    expect(createGroundSampler(doc, skin, hips)).toBeNull();
  });

  it('vindt dezelfde laagste y als een ongesnoeide scan over alle hoekpunten', () => {
    // De bound-and-skip mag het antwoord niet veranderen: tegen een rechttoe rechtaan referentie over 24 poses.
    const { doc, skin, nodes } = rig(0.12);
    const sampler = createGroundSampler(doc, skin, skin.listJoints()[0]!)!;
    const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    const position = prim.getAttribute('POSITION')!;
    const joints = prim.getAttribute('JOINTS_0')!;
    for (let k = 0; k < 24; k++) {
      const map = new Map<Node, Pose>();
      const shin = nodes.get('Shin')!;
      map.set(shin, {
        t: [...shin.getTranslation()],
        r: quatFromAxisAngle([1, 0.3, 0], (k / 24) * Math.PI * 2),
        s: [1, 1, 1],
      } as Pose);
      const hips = nodes.get('Hips')!;
      map.set(hips, { t: [0, 1 - k * 0.01, 0], r: IDENTITY, s: [1, 1, 1] } as Pose);
      const jointWorld = worlds(skin, map);
      // Referentie: elke vertex door skin = jointWorld * inverseBind, zonder enige versnelling.
      const ibm = skin.getInverseBindMatrices()!;
      let reference = Infinity;
      const p = [0, 0, 0];
      const j = [0, 0, 0, 0];
      for (let v = 0; v < position.getCount(); v++) {
        position.getElement(v, p);
        joints.getElement(v, j);
        const bind = new Float64Array(16);
        ibm.getElement(j[0]!, bind as unknown as number[]);
        const m = multiply(jointWorld[j[0]!]!, bind);
        reference = Math.min(reference, m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]! + m[13]!);
      }
      expect(sampler.lowestY(jointWorld)).toBeCloseTo(reference, 10);
    }
  });
});
