// Retargeten: clips van een bronskelet (bijvoorbeeld de Quaternius-UAL na de rigmap, met Mixamo-namen) overzetten op
// een ander skelet met andere rustpose en proporties. Beide documenten moeten in hetzelfde assenstelsel staan
// (meters, +Y omhoog, gezicht naar +Z, transformaties toegepast), wat de conform-stap (rigmap, fit) garandeert.
//
// Methode, per doelbone j met bronbone s (koppeling op naam, of via `bones`):
//   1. Rotatie relatief aan de rustpose. Het verschil van s ten opzichte van zijn rustpose, uitgedrukt in de wereld:
//      D_s(t) = Q_s(t) * Q_s,rust^-1. Voor een volledig gekoppelde keten is dit precies de lokale delta
//      (Q_s,rust,lokaal^-1 * Q_s(t),lokaal) omgerekend naar de rustpose van het doel; de wereldvorm laat bovendien
//      overgeslagen bones (de UAL heeft Neck en Spine1, een eenvoudig doel niet) netjes meetellen.
//   2. Rustpose-uitlijning A_j: de kortste rotatie die de botrichting van het doel in rust (naar zijn enige gekoppelde
//      kind) op de botrichting van de bron in rust legt. Zo komt een T-pose-clip goed op een A-pose of een model met
//      hangende armen. Bones met geen of meer kinderen erven A van hun ouder; de root heeft A = identiteit.
//   3. Doel in de wereld: Q_j(t) = D_s(t) * A_j * Q_j,rust; lokaal = Q_ouder(t)^-1 * Q_j(t).
//   4. Root-translatie (Hips): het verschil met de rustpositie in de wereld, geschaald met beenlengte doel / bron.
// Doelbones zonder bron houden hun lokale rustpose. Het resultaat zijn gewone glTF-clips (LINEAR, `fps` keyframes per
// seconde), die daarna als elke andere clip gebakken worden.
import type { Document, Node } from '@gltf-transform/core';
import { readTracks, sampleTrack } from './bake.js';
import { stripMixamoPrefix } from './inspect.js';
import {
  compose,
  invertAffine,
  multiply,
  quatFromTo,
  quatInvert,
  quatMultiply,
  rotationOf,
  sub3,
  transformPoint,
  type Mat,
  type Pose,
  type Quat,
  type Vec3,
} from './math.js';

export interface RetargetOptions {
  /** Doelbone naar bronbone (namen zonder Mixamo-prefix), voor bones die anders heten; standaard dezelfde naam. */
  bones?: Readonly<Record<string, string>>;
  /** Keyframes per seconde van de nieuwe clips; standaard 30 (de bake-fps). */
  fps?: number;
  /** Rustposes uitlijnen (stap 2); standaard aan. */
  alignRest?: boolean;
  /** Naam van de root-bone die translatie krijgt; standaard Hips. */
  root?: string;
  /** Alleen deze bronclips (namen); standaard alle. */
  clips?: readonly string[];
}

export interface RetargetInfo {
  /** Doelbone naar bronbone, voor de gekoppelde bones. */
  mapping: Record<string, string>;
  /** Doelbones zonder bron (houden hun rustpose). */
  unmapped: string[];
  /** Bronbones die geen doel hebben (hun rotatie telt alleen mee via hun kinderen). */
  unusedSource: string[];
  /** Schaal van de root-translatie (beenlengte doel / bron). */
  translationScale: number;
  clips: { name: string; durationSeconds: number; keyframes: number }[];
}

const nameOf = (node: Node): string => stripMixamoPrefix(node.getName());

function restPose(node: Node): Pose {
  return {
    t: [...node.getTranslation()] as Vec3,
    r: [...node.getRotation()] as Quat,
    s: [...node.getScale()] as Vec3,
  };
}

/** Wereldmatrices van alle nodes voor een set lokale poses (ontbrekende nodes op hun rustpose). */
function worldMatrices(overrides: ReadonlyMap<Node, Pose>): (node: Node) => Mat {
  const cache = new Map<Node, Mat>();
  const world = (node: Node): Mat => {
    let m = cache.get(node);
    if (!m) {
      const local = compose(overrides.get(node) ?? restPose(node));
      const parent = node.getParentNode();
      m = parent ? multiply(world(parent), local) : local;
      cache.set(node, m);
    }
    return m;
  };
  return world;
}

const position = (m: Mat): Vec3 => [m[12]!, m[13]!, m[14]!];

function legLength(byName: ReadonlyMap<string, Node>, world: (n: Node) => Mat): number | null {
  let total = 0;
  let sides = 0;
  for (const side of ['Left', 'Right']) {
    const chain = ['UpLeg', 'Leg', 'Foot'].map((b) => byName.get(`${side}${b}`));
    if (chain.some((n) => !n)) continue;
    const p = chain.map((n) => position(world(n!)));
    total += Math.hypot(...sub3(p[1]!, p[0]!)) + Math.hypot(...sub3(p[2]!, p[1]!));
    sides++;
  }
  return sides > 0 ? total / sides : null;
}

function depth(node: Node): number {
  let d = 0;
  for (let n = node.getParentNode(); n; n = n.getParentNode()) d++;
  return d;
}

/** Zet de clips van `source` over op het skelet van `target` en voegt ze als nieuwe animaties aan `target` toe. */
export function retargetClips(
  target: Document,
  source: Document,
  options: RetargetOptions = {},
): RetargetInfo {
  const fps = options.fps ?? 30;
  const rootName = options.root ?? 'Hips';
  const targetSkin = target.getRoot().listSkins()[0];
  const sourceSkin = source.getRoot().listSkins()[0];
  if (!targetSkin || !sourceSkin) throw new Error('retargeten vraagt een skin in bron en doel');
  const targetJoints = [...targetSkin.listJoints()].sort((a, b) => depth(a) - depth(b));
  const sourceByName = new Map(sourceSkin.listJoints().map((j) => [nameOf(j), j]));
  const targetByName = new Map(targetJoints.map((j) => [nameOf(j), j]));
  const targetSet = new Set(targetJoints);

  const sourceOf = new Map<Node, Node>();
  const mapping: Record<string, string> = {};
  const unmapped: string[] = [];
  for (const joint of targetJoints) {
    const wanted = options.bones?.[nameOf(joint)] ?? nameOf(joint);
    const src = sourceByName.get(wanted);
    if (src) {
      sourceOf.set(joint, src);
      mapping[nameOf(joint)] = wanted;
    } else unmapped.push(nameOf(joint));
  }
  if (!sourceOf.size) throw new Error('geen enkele doelbone heeft een bronbone met dezelfde naam');
  const used = new Set(sourceOf.values());
  const unusedSource = [...sourceByName.values()].filter((n) => !used.has(n)).map(nameOf);

  const sourceRest = worldMatrices(new Map());
  const targetRest = worldMatrices(new Map());
  const rotationOfMatrix = (m: Mat): Quat => rotationOf(m).q;
  // Rustrotaties in de wereld liggen vast; één keer berekenen in plaats van per frame.
  const sourceRestInverse = new Map(
    [...sourceOf.values()].map((src) => [src, quatInvert(rotationOfMatrix(sourceRest(src)))]),
  );
  const targetRestRotation = new Map(
    targetJoints.map((joint) => [joint, rotationOfMatrix(targetRest(joint))]),
  );

  // Rustpose-uitlijning per doelbone.
  const jointParent = (j: Node): Node | null => {
    for (let n = j.getParentNode(); n; n = n.getParentNode()) if (targetSet.has(n)) return n;
    return null;
  };
  const align = new Map<Node, Quat>();
  for (const joint of targetJoints) {
    const parent = jointParent(joint);
    const inherited = (parent && align.get(parent)) || ([0, 0, 0, 1] as Quat);
    const src = sourceOf.get(joint);
    const children = targetJoints.filter((c) => jointParent(c) === joint && sourceOf.has(c));
    if (
      options.alignRest === false ||
      !src ||
      nameOf(joint) === rootName ||
      children.length !== 1
    ) {
      align.set(joint, nameOf(joint) === rootName ? [0, 0, 0, 1] : inherited);
      continue;
    }
    const child = children[0]!;
    const dirT = sub3(position(targetRest(child)), position(targetRest(joint)));
    const dirS = sub3(position(sourceRest(sourceOf.get(child)!)), position(sourceRest(src)));
    align.set(joint, quatFromTo(dirT, dirS));
  }

  const legT = legLength(targetByName, targetRest);
  const legS = legLength(sourceByName, sourceRest);
  const translationScale = legT && legS ? legT / legS : 1;
  const rootJoint = targetByName.get(rootName);
  const rootSource = rootJoint ? sourceOf.get(rootJoint) : undefined;

  const clips: RetargetInfo['clips'] = [];
  const buffer = target.getRoot().listBuffers()[0] ?? target.createBuffer();
  for (const animation of source.getRoot().listAnimations()) {
    if (options.clips && !options.clips.includes(animation.getName())) continue;
    const tracks = readTracks(animation);
    let duration = 0;
    for (const track of tracks)
      duration = Math.max(duration, track.times[track.times.length - 1] ?? 0);
    if (!(duration > 0)) continue;
    const count = Math.max(2, Math.round(duration * fps) + 1);
    const times = Array.from({ length: count }, (_, k) => (k === count - 1 ? duration : k / fps));
    const rotations = new Map<Node, number[]>();
    const rootTranslations: number[] = [];

    for (const time of times) {
      const overrides = new Map<Node, Pose>();
      for (const track of tracks) {
        let pose = overrides.get(track.node);
        if (!pose) {
          pose = restPose(track.node);
          overrides.set(track.node, pose);
        }
        const v = sampleTrack(track, time);
        if (track.path === 'translation') pose.t = [v[0]!, v[1]!, v[2]!];
        else if (track.path === 'rotation') pose.r = [v[0]!, v[1]!, v[2]!, v[3]!];
        else pose.s = [v[0]!, v[1]!, v[2]!];
      }
      const sourceNow = worldMatrices(overrides);

      // Doel van boven naar beneden: wereldrotaties van ouders eerst.
      const worldRot = new Map<Node, Quat>();
      const rotOf = (node: Node | null): Quat => {
        if (!node) return [0, 0, 0, 1];
        const known = worldRot.get(node);
        if (known) return known;
        // Geen joint (of nog niet berekend): rustpose onder zijn ouder.
        const q = quatMultiply(rotOf(node.getParentNode()), node.getRotation());
        worldRot.set(node, q);
        return q;
      };
      for (const joint of targetJoints) {
        const parentQ = rotOf(joint.getParentNode());
        const src = sourceOf.get(joint);
        if (!src) {
          worldRot.set(joint, quatMultiply(parentQ, joint.getRotation()));
          continue;
        }
        const delta = quatMultiply(rotationOfMatrix(sourceNow(src)), sourceRestInverse.get(src)!);
        const world = quatMultiply(
          quatMultiply(delta, align.get(joint)!),
          targetRestRotation.get(joint)!,
        );
        worldRot.set(joint, world);
        let local = quatMultiply(quatInvert(parentQ), world);
        const list = rotations.get(joint) ?? [];
        const prev = list.length >= 4 ? list.slice(-4) : null;
        if (
          prev &&
          prev[0]! * local[0] + prev[1]! * local[1] + prev[2]! * local[2] + prev[3]! * local[3] < 0
        )
          local = [-local[0], -local[1], -local[2], -local[3]];
        list.push(...local);
        rotations.set(joint, list);
      }
      if (rootJoint && rootSource) {
        const delta = sub3(position(sourceNow(rootSource)), position(sourceRest(rootSource)));
        const restPos = position(targetRest(rootJoint));
        const worldPos: Vec3 = [
          restPos[0] + delta[0] * translationScale,
          restPos[1] + delta[1] * translationScale,
          restPos[2] + delta[2] * translationScale,
        ];
        const parent = rootJoint.getParentNode();
        const local = parent
          ? transformPoint(invertAffine(targetRest(parent)), worldPos)
          : worldPos;
        rootTranslations.push(...local);
      }
    }

    const out = target.createAnimation(animation.getName());
    const input = target
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Float32Array(times))
      .setBuffer(buffer);
    const channel = (node: Node, path: 'rotation' | 'translation', values: number[]): void => {
      const sampler = target
        .createAnimationSampler()
        .setInput(input)
        .setInterpolation('LINEAR')
        .setOutput(
          target
            .createAccessor()
            .setType(path === 'rotation' ? 'VEC4' : 'VEC3')
            .setArray(new Float32Array(values))
            .setBuffer(buffer),
        );
      out
        .addSampler(sampler)
        .addChannel(
          target
            .createAnimationChannel()
            .setTargetNode(node)
            .setTargetPath(path)
            .setSampler(sampler),
        );
    };
    for (const [joint, values] of rotations) channel(joint, 'rotation', values);
    if (rootJoint && rootTranslations.length > 0)
      channel(rootJoint, 'translation', rootTranslations);
    clips.push({ name: animation.getName(), durationSeconds: duration, keyframes: count });
  }
  return { mapping, unmapped, unusedSource, translationScale, clips };
}
