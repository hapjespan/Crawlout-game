// Bone-snoeien en hernoemen voor bronskeletten met meer bones of andere namen dan de brief toestaat.
// Bones die niet in de mapping staan (vingers, tenen, *_leaf, root, ...) verdwijnen uit de skin; hun gewichten gaan naar
// de dichtstbijzijnde behouden voorouder en worden daarna genormaliseerd. Animatiekanalen van gesnoeide bones vallen weg.
// Een gesnoeide bone met behouden afstammelingen (bijvoorbeeld een statische `root`) blijft als gewone node in de
// hiërarchie, op zijn rustpose, zodat de wereldmatrices van de behouden bones kloppen.
import type { Accessor, Document, Node } from '@gltf-transform/core';

export interface PruneResult {
  bonesBefore: number;
  bonesAfter: number;
  /** Namen (bronnamen) van de gesnoeide bones. */
  pruned: string[];
  /** Aantal animatiekanalen dat is weggevallen. */
  channelsDropped: number;
}

/** Nieuwe JOINTS_0 en WEIGHTS_0 voor één vertex: gewichten opgeteld per doelbone, top 4, genormaliseerd. */
function remapInfluences(joints: number[], weights: number[], target: Int32Array): [number[], number[]] {
  const acc = new Map<number, number>();
  for (let k = 0; k < 4; k++) {
    const w = weights[k] ?? 0;
    if (w <= 0) continue;
    const t = target[joints[k] ?? 0] ?? -1;
    if (t < 0) throw new Error(`joint ${joints[k]} heeft gewicht maar geen behouden voorouder om het naar over te dragen`);
    acc.set(t, (acc.get(t) ?? 0) + w);
  }
  const sorted = [...acc.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
  const sum = sorted.reduce((s, [, w]) => s + w, 0);
  const outJ = [0, 0, 0, 0];
  const outW = [0, 0, 0, 0];
  sorted.forEach(([j, w], k) => {
    outJ[k] = j;
    outW[k] = sum > 0 ? w / sum : 0;
  });
  return [outJ, outW];
}

/**
 * Snoeit de skin van `document` tot de bones in `mapping` (bronnaam hoofdletterongevoelig naar nieuwe naam) en hernoemt ze.
 * De joint-volgorde van de bron blijft behouden. Gooit een fout als de mapping geen enkele bone herkent of als twee
 * bones dezelfde doelnaam krijgen.
 */
export function pruneBones(document: Document, mapping: Readonly<Record<string, string>>): PruneResult {
  const root = document.getRoot();
  const skins = root.listSkins();
  if (skins.length !== 1) throw new Error(`bone-snoeien verwacht precies 1 skin, gevonden: ${skins.length}`);
  const skin = skins[0]!;
  const joints = skin.listJoints();
  const lookup = new Map(Object.entries(mapping).map(([source, target]) => [source.toLowerCase(), target]));

  const keep = joints.map((joint) => lookup.has(joint.getName().toLowerCase()));
  if (!keep.some(Boolean)) throw new Error('de rigmap herkent geen enkele bone van het skelet; controleer de botnamen in assets/src/rigmap.json');
  const targetNames = joints.flatMap((joint, i) => (keep[i] ? [lookup.get(joint.getName().toLowerCase())!] : []));
  const duplicate = targetNames.find((name, i) => targetNames.indexOf(name) !== i);
  if (duplicate) throw new Error(`twee bones krijgen dezelfde naam "${duplicate}" in de rigmap`);

  // Oude jointindex naar nieuwe index; gesnoeide joints wijzen naar hun dichtstbijzijnde behouden voorouder (-1 = geen).
  const newIndex: number[] = [];
  let next = 0;
  keep.forEach((k, i) => (newIndex[i] = k ? next++ : -1));
  const target = new Int32Array(joints.length);
  joints.forEach((joint, i) => {
    let node: Node | null = joint;
    let hit = -1;
    while (node) {
      const index = joints.indexOf(node);
      if (index >= 0 && keep[index]) {
        hit = newIndex[index]!;
        break;
      }
      node = node.getParentNode();
    }
    target[i] = hit;
  });

  // Gewichten: eerst alles herberekenen, pas daarna het document aanpassen (een fout laat het document intact).
  const rewrites: { j: Accessor; w: Accessor; outJ: number[][]; outW: number[][] }[] = [];
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const j = prim.getAttribute('JOINTS_0');
      const w = prim.getAttribute('WEIGHTS_0');
      if (!j || !w) continue;
      if (prim.getAttribute('JOINTS_1')) throw new Error('meer dan 4 invloeden per vertex (JOINTS_1) wordt niet ondersteund');
      const outJ: number[][] = [];
      const outW: number[][] = [];
      for (let v = 0; v < j.getCount(); v++) {
        const [nj, nw] = remapInfluences(j.getElement(v, [0, 0, 0, 0]), w.getElement(v, [0, 0, 0, 0]), target);
        outJ.push(nj);
        outW.push(nw);
      }
      rewrites.push({ j, w, outJ, outW });
    }
  }
  for (const { j, w, outJ, outW } of rewrites) {
    for (let v = 0; v < outJ.length; v++) {
      j.setElement(v, outJ[v]!);
      w.setElement(v, outW[v]!);
    }
  }

  // Inverse-bindmatrices van de behouden joints, in dezelfde volgorde.
  const oldIbm = skin.getInverseBindMatrices();
  const ibm = new Float32Array(next * 16);
  const row = new Array<number>(16).fill(0);
  joints.forEach((_, i) => {
    if (!keep[i]) return;
    if (oldIbm) ibm.set(oldIbm.getElement(i, row), newIndex[i]! * 16);
    else for (let d = 0; d < 4; d++) ibm[newIndex[i]! * 16 + d * 5] = 1;
  });
  const newIbm = document.createAccessor().setType('MAT4').setArray(ibm).setBuffer(oldIbm?.getBuffer() ?? root.listBuffers()[0] ?? document.createBuffer());
  for (const joint of joints) skin.removeJoint(joint);
  joints.forEach((joint, i) => {
    if (keep[i]) skin.addJoint(joint);
  });
  skin.setInverseBindMatrices(newIbm);
  oldIbm?.dispose();

  // Hernoemen, animatiekanalen van gesnoeide bones weg, en gesnoeide takken zonder behouden afstammelingen uit de scene.
  const prunedNodes = new Set(joints.filter((_, i) => !keep[i]));
  const prunedNames = [...prunedNodes].map((n) => n.getName());
  joints.forEach((joint, i) => {
    if (keep[i]) joint.setName(lookup.get(joint.getName().toLowerCase())!);
  });
  let channelsDropped = 0;
  for (const animation of root.listAnimations()) {
    for (const channel of animation.listChannels()) {
      const node = channel.getTargetNode();
      if (node && prunedNodes.has(node)) {
        const sampler = channel.getSampler();
        channel.dispose();
        if (sampler && sampler.listParents().every((p) => p.propertyType !== 'AnimationChannel')) sampler.dispose();
        channelsDropped++;
      }
    }
  }
  const hasKeptBelow = (node: Node): boolean => joints.some((joint, i) => keep[i] && isDescendant(joint, node));
  for (const node of prunedNodes) {
    if (hasKeptBelow(node)) continue;
    const subtree: Node[] = [];
    node.traverse((n) => subtree.push(n));
    for (const n of subtree.reverse()) n.dispose();
  }
  return { bonesBefore: joints.length, bonesAfter: next, pruned: prunedNames, channelsDropped };
}

function isDescendant(node: Node, ancestor: Node): boolean {
  for (let n: Node | null = node; n; n = n.getParentNode()) if (n === ancestor) return true;
  return false;
}
