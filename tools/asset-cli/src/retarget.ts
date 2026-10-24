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
//   5. Grondbeperking, in drie trappen, want grondcontact is een eigenschap van het oppervlak om de botten en niet
//      van de botten zelf. (a) Een voet die onder het grondvlak staat draait om zijn enkel omhoog (`footRelief.ts`).
//      (b) Staat er daarna nog iets anders dan een voet onder, dan gaat de root dat frame omhoog (`ground.ts`).
//      (c) Blijft er alleen voet over, dan gaat de root langs een hellingbegrensde curve (`liftCurve.ts`).
// Doelbones zonder bron houden hun lokale rustpose. Het resultaat zijn gewone glTF-clips (LINEAR, `fps` keyframes per
// seconde), die daarna als elke andere clip gebakken worden.
import type { Document, Node } from '@gltf-transform/core';
import { readTracks, sampleTrack } from './bake.js';
import { createAnkleRelief } from './footRelief.js';
import { createGroundSampler } from './ground.js';
import { DEFAULT_SLOPE, isLoop, rateLimited } from './liftCurve.js';
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
  /** Grondbeperking (stap 5); standaard aan. Uit voor iets dat hoort te zweven. */
  ground?: boolean;
  /** Grondvlak in meters; standaard 0. */
  groundY?: number;
  /** Plafond op de root-lift per frame in meters; standaard 0,5. Vangt een losse vertex onder de kaart af. */
  maxLift?: number;
  /** Enkelverlichting (stap 5a); standaard aan. Uit laat alleen de root-lift over, zoals voor 0.22.0. */
  ankleRelief?: boolean;
  /** Grootste verandering van de lift tussen twee frames, in meters; standaard `DEFAULT_SLOPE` (2 mm). */
  liftSlope?: number;
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
  clips: {
    name: string;
    durationSeconds: number;
    keyframes: number;
    /** Diepste doordringing vóór de grondbeperking, in mm; 0 als de clip al boven de grond bleef. */
    penetrationMm?: number;
    /** Aandeel frames dat omhoog moest, 0 tot 1. */
    liftedFraction?: number;
    /** Grootste enkelverlichting (stap 5a) in de clip, in graden; 0 als geen voet omhoog hoefde. */
    ankleReliefDegrees?: number;
  }[];
  /** Vertices die de grondbeperking bewaakt; afwezig als er niets te meten viel (skelet zonder mesh). */
  groundVertices?: number;
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

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

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

  // Grondbeperking: alleen zinvol met een root om aan te tillen en een mesh om te meten.
  const groundY = options.groundY ?? 0;
  const maxLift = options.maxLift ?? 0.5;
  const slope = options.liftSlope ?? DEFAULT_SLOPE;
  const sampler =
    options.ground === false || !rootJoint
      ? null
      : createGroundSampler(target, targetSkin, rootJoint);
  const relief =
    !sampler || options.ankleRelief === false
      ? null
      : createAnkleRelief(target, targetSkin, targetByName, worldMatrices);
  // Alles buiten de voeten. Staat dát onder de grond (de knielende scheen van `build`), dan hoort het lichaam
  // inderdaad omhoog en mag de lift het frame volgen; een voet alleen mag het lichaam niet meetrekken.
  const feet = new Set(
    ['LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase']
      .map((name) => targetByName.get(name))
      .filter((node): node is Node => node !== undefined),
  );
  const bodySampler =
    !sampler || !rootJoint || feet.size === 0
      ? null
      : createGroundSampler(target, targetSkin, rootJoint, feet);
  const skinJoints = targetSkin.listJoints();

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
    const rootWorld: Vec3[] = [];
    /** Wat er na de body-lift nog aan voet onder de grond zit; stap 5b maakt er een berijdbare curve van. */
    const needed: number[] = [];
    /** Lift voor alles wat geen voet is; die mag het frame wél volgen. */
    const bodyLift: number[] = [];
    let toLocal: ((world: Vec3) => Vec3) | null = null;
    let penetration = 0;
    let liftedFrames = 0;
    let relieved = 0;
    // De enkelverlichting draait een bot nadat zijn keyframe al geschreven is. Dit zet de nieuwe waarde terug op de
    // plek van dit frame, met dezelfde tekenkeuze als de hoofdlus, zodat de LINEAR-interpolatie niet omklapt.
    const rewrite = (bone: Node, value: Quat | undefined): void => {
      const list = rotations.get(bone);
      if (!value || !list || list.length < 4) return;
      let q = value;
      const previous = list.length - 8;
      if (
        previous >= 0 &&
        list[previous]! * q[0] +
          list[previous + 1]! * q[1] +
          list[previous + 2]! * q[2] +
          list[previous + 3]! * q[3] <
          0
      )
        q = [-q[0], -q[1], -q[2], -q[3]];
      for (let i = 0; i < 4; i++) list[list.length - 4 + i] = q[i]!;
    };

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
      const targetPose = new Map<Node, Pose>();
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
        const rest = restPose(joint);
        targetPose.set(joint, { t: rest.t, r: local, s: rest.s });
      }
      if (rootJoint) {
        const restPos = position(targetRest(rootJoint));
        const delta = rootSource
          ? sub3(position(sourceNow(rootSource)), position(sourceRest(rootSource)))
          : ([0, 0, 0] as Vec3);
        const worldPos: Vec3 = [
          restPos[0] + delta[0] * translationScale,
          restPos[1] + delta[1] * translationScale,
          restPos[2] + delta[2] * translationScale,
        ];
        const parent = rootJoint.getParentNode();
        const local = (world: Vec3): Vec3 =>
          parent ? transformPoint(invertAffine(targetRest(parent)), world) : world;

        // Stap 5. De root optillen is een starre verschuiving van alles eronder, dus de laagste vertex schuift
        // precies even ver mee: één meting per frame is genoeg, er is geen iteratie nodig.
        if (sampler) {
          const rootRest = restPose(rootJoint);
          targetPose.set(rootJoint, {
            t: local(worldPos),
            r: targetPose.get(rootJoint)?.r ?? rootRest.r,
            s: rootRest.s,
          });
          // Stap 5a: eerst de enkels, dan pas het hele lichaam. Wat de verlichting draait moet ook in de clip komen.
          if (relief) {
            relieved = Math.max(relieved, relief.settle(targetPose, groundY));
            for (const bone of relief.bones) rewrite(bone, targetPose.get(bone)?.r);
          }
          const targetNow = worldMatrices(targetPose);
          const world = skinJoints.map((joint) => targetNow(joint));
          const lowest = sampler.lowestY(world);
          const deep = groundY - lowest;
          if (deep > 0) {
            penetration = Math.max(penetration, deep);
            liftedFrames++;
          }
          // De body-lift is een starre verschuiving, dus het laagste punt schuift er precies mee op. Staat er iets
          // anders dan een voet onder de grond, dan beweegt het lichaam toch al en gaat de hele doordringing in één
          // keer mee; alleen een frame waarin louter een voet eronder zit wacht op de hellingbegrenzing van 5b.
          const body = bodySampler
            ? clamp(groundY - bodySampler.lowestY(world), 0, maxLift)
            : 0;
          bodyLift.push(body > 0 ? clamp(deep, 0, maxLift) : 0);
          needed.push(body > 0 ? 0 : clamp(deep, 0, maxLift));
        }
        rootWorld.push(worldPos);
        toLocal ??= local;
      }
    }
    // Stap 5b. De lift gaat niet frame voor frame omhoog maar langs een hellingbegrensde omhullende: een piek van één
    // frame wordt door zijn buren meebetaald, zodat de heup niet springt en beide passen evenveel krijgen.
    if (toLocal) {
      // Raakt alleen een voet de grond, dan is dit een looppas en moet het lichaam er rustig overheen; raakt ook de
      // rest het (knielen, vallen), dan is het een actie op de grond en hoort de lift het frame gewoon te volgen.
      const grounded = bodyLift.some((value) => value > 0);
      const lift = grounded
        ? needed.map((value, i) => value + (bodyLift[i] ?? 0))
        : rateLimited(needed, slope, isLoop(rotations.values()));
      rootWorld.forEach((p, i) => {
        p[1] += lift[i] ?? 0;
      });
    }
    // Een translatiekanaal hoort er alleen te komen als de bron er een had of als de grond eraan getrokken heeft;
    // anders houdt de root zijn rustpose, zoals voorheen.
    if (toLocal && (rootSource || penetration > 0))
      for (const p of rootWorld) rootTranslations.push(...toLocal(p));

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
    clips.push({
      name: animation.getName(),
      durationSeconds: duration,
      keyframes: count,
      ...(sampler
        ? {
            penetrationMm: Math.round(penetration * 1e4) / 10,
            liftedFraction: Math.round((liftedFrames / count) * 1000) / 1000,
            ...(relief ? { ankleReliefDegrees: Math.round(relieved * 10) / 10 } : {}),
          }
        : {}),
    });
  }
  return {
    mapping,
    unmapped,
    unusedSource,
    translationScale,
    clips,
    ...(sampler ? { groundVertices: sampler.vertexCount } : {}),
  };
}
