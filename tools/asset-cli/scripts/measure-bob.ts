// How much does a retargeted character move up and down, with and without the step-5 ground constraint?
//
// Definitions, kept identical to the ones CHANGELOG 0.17.0 reports ("lopen ging van -5 tot +34 mm (39 mm op en
// neer) naar -9 tot +11 mm (20 mm)"), so the numbers stay comparable across rounds:
//   lowestMin   - the lowest skinned vertex y over the whole clip. The hover height; negative means sinking.
//   lowestRange - max minus min of that same per-frame lowest y. This is what the project calls "bob".
// Those two watch the contact surface, not the body. The ground constraint lifts the root, which moves the body
// without moving the contact surface, so two more are needed to see what a rigid lift costs:
//   rootRange / headRange - max minus min of the Hips and Head world y, the body's own vertical travel.
//   rootStep              - the largest change in Hips y between two neighbouring frames: a smooth 130 mm sweep
//                           over a cycle and a 130 mm jump between two frames score the same on rootRange.
//   liftMax / liftStep    - the lift the constraint adds, and the largest change in that lift between two frames.
//
// Reads the gitignored assets/local; from a worktree point CRAWLOUT_LOCAL at the main checkout. Not part of the
// build: `node --import tsx scripts/measure-bob.ts [assetId...] [--lod] [--dump=<clip>] [--bone=<clip>]`.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Document, Node } from '@gltf-transform/core';
import { readTracks, sampleTrack } from '../src/bake.js';
import { pruneBones } from '../src/bones.js';
import { loadRetargetSource } from '../src/conform.js';
import { extractMeshes, fitCharacter } from '../src/fit.js';
import { createGroundSampler } from '../src/ground.js';
import { createIO, simplifyToTarget } from '../src/lods.js';
import { ensureSmoothNormals } from '../src/normals.js';
import { parseRigmap } from '../src/rigmap.js';
import { retargetClips } from '../src/retarget.js';
import { compose, multiply, type Mat, type Pose } from '../src/math.js';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
// assets/local is gitignored, so a worktree reads it from the main checkout: CRAWLOUT_LOCAL points there.
const LOCAL = process.env['CRAWLOUT_LOCAL'] ?? `${ROOT}/assets/local`;
// A re-rigged set can be measured without overwriting the shipped one: CRAWLOUT_RIGGED names the folder to read
// the bound characters from. Everything else (rigmap, fit, clips) stays identical, so the numbers stay comparable.
const RIGGED = process.env['CRAWLOUT_RIGGED'] ?? `${LOCAL}/rigged`;

const rigmap = parseRigmap(JSON.parse(readFileSync(`${LOCAL}/rigmap.json`, 'utf8')));

interface Sample {
  /** Lowest skinned vertex y per frame, in metres. */
  lowest: number[];
  /** Root (Hips) world y per frame, in metres. */
  rootY: number[];
  /** Head bone world y per frame, in metres. */
  headY: number[];
  loop: boolean;
}

/** Conform the character exactly as `conformDocument` does up to the retarget step. */
async function prepare(file: string, assetId: string): Promise<Document> {
  const document = await createIO().readBinary(new Uint8Array(readFileSync(file)));
  const entry = rigmap.assets[assetId];
  if (!entry) throw new Error(`no rigmap entry for ${assetId}`);
  if (entry.meshes) await extractMeshes(document, entry.meshes);
  ensureSmoothNormals(document);
  if (entry.fit) fitCharacter(document, entry.fit);
  if (entry.rig) {
    const rig = rigmap.rigs[entry.rig];
    if (!rig) throw new Error(`rig ${entry.rig} missing`);
    pruneBones(document, rig.bones, rig.merge);
  }
  return document;
}

function worldOf(overrides: ReadonlyMap<Node, Pose>): (node: Node) => Mat {
  const cache = new Map<Node, Mat>();
  const world = (node: Node): Mat => {
    let m = cache.get(node);
    if (!m) {
      const local =
        overrides.get(node) ??
        ({
          t: [...node.getTranslation()],
          r: [...node.getRotation()],
          s: [...node.getScale()],
        } as Pose);
      const parent = node.getParentNode();
      m = parent ? multiply(world(parent), compose(local)) : compose(local);
      cache.set(node, m);
    }
    return m;
  };
  return world;
}

/** Per-frame lowest skinned y, root y and head y of every clip in `document`, on the clip's own keyframe times. */
function sampleClips(document: Document, boneClip?: string): Map<string, Sample> {
  const skin = document.getRoot().listSkins()[0]!;
  const joints = skin.listJoints();
  const byName = new Map(joints.map((j) => [j.getName().replace(/^mixamorig:?/i, ''), j]));
  const root = byName.get('Hips')!;
  const head = byName.get('Head') ?? root;
  const sampler = createGroundSampler(document, skin, root)!;
  const out = new Map<string, Sample>();
  for (const animation of document.getRoot().listAnimations()) {
    const tracks = readTracks(animation);
    const times = [...(tracks[0]?.times ?? [])];
    const lowest: number[] = [];
    const rootY: number[] = [];
    const headY: number[] = [];
    for (const time of times) {
      const overrides = new Map<Node, Pose>();
      for (const track of tracks) {
        let pose = overrides.get(track.node);
        if (!pose) {
          pose = {
            t: [...track.node.getTranslation()],
            r: [...track.node.getRotation()],
            s: [...track.node.getScale()],
          } as Pose;
          overrides.set(track.node, pose);
        }
        const v = sampleTrack(track, time);
        if (track.path === 'translation') pose.t = [v[0]!, v[1]!, v[2]!];
        else if (track.path === 'rotation') pose.r = [v[0]!, v[1]!, v[2]!, v[3]!];
        else pose.s = [v[0]!, v[1]!, v[2]!];
      }
      const world = worldOf(overrides);
      lowest.push(sampler.lowestY(joints.map((j) => world(j))));
      rootY.push(world(root)[13]!);
      headY.push(world(head)[13]!);
      if (boneClip === animation.getName()) {
        const d = deepestVertex(document, world);
        const ankle = byName.get(d.joint.includes('Left') ? 'LeftFoot' : 'RightFoot');
        console.log(
          `  f${String(lowest.length - 1).padStart(3)} lowest ${String(mm(d.y)).padStart(8)} mm  bone ${d.joint.padEnd(16)} w=${d.weight.toFixed(2)}` +
            `  ankle y ${String(ankle ? mm(world(ankle)[13]!) : 0).padStart(7)}`,
        );
      }
    }
    out.set(animation.getName(), { lowest, rootY, headY, loop: animation.getName() !== 'death' });
  }
  return out;
}

/** Brute-force skinning for one frame: which vertex is lowest, and which joint dominates it. */
function deepestVertex(
  document: Document,
  world: (node: Node) => Mat,
): { y: number; joint: string; weight: number } {
  const skin = document.getRoot().listSkins()[0]!;
  const joints = skin.listJoints();
  const ibmAccessor = skin.getInverseBindMatrices();
  const skinMat = joints.map((joint, b) => {
    const inverse = new Float64Array(16);
    if (ibmAccessor) ibmAccessor.getElement(b, inverse as unknown as number[]);
    else for (let i = 0; i < 4; i++) inverse[i * 5] = 1;
    return multiply(world(joint), inverse);
  });
  let best = Infinity;
  let bestJoint = 0;
  let bestWeight = 0;
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || node.getSkin() !== skin) continue;
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      const jointAttr = prim.getAttribute('JOINTS_0');
      const weightAttr = prim.getAttribute('WEIGHTS_0');
      if (!position || !jointAttr || !weightAttr) continue;
      const p = [0, 0, 0];
      const j = [0, 0, 0, 0];
      const w = [0, 0, 0, 0];
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, p);
        jointAttr.getElement(i, j);
        weightAttr.getElement(i, w);
        let y = 0;
        let top = 0;
        let topJoint = 0;
        for (let k = 0; k < 4; k++) {
          if (!(w[k]! > 0)) continue;
          const m = skinMat[j[k]!]!;
          y += w[k]! * (m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]! + m[13]!);
          if (w[k]! > top) {
            top = w[k]!;
            topJoint = j[k]!;
          }
        }
        if (top > 0 && y < best) {
          best = y;
          bestJoint = topJoint;
          bestWeight = top;
        }
      }
    }
  }
  return { y: best, joint: joints[bestJoint]!.getName(), weight: bestWeight };
}

const mm = (v: number): number => Math.round(v * 1e4) / 10;
const range = (a: readonly number[]): number => Math.max(...a) - Math.min(...a);
/** Largest step between neighbouring frames; looping clips also compare the last frame with the first. */
function maxStep(a: readonly number[], loop: boolean): number {
  let worst = 0;
  for (let i = 1; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - a[i - 1]!));
  // The exported clip repeats frame 0 as its last keyframe, so the wrap is frame n-2 -> frame 0.
  if (loop && a.length > 2) worst = Math.max(worst, Math.abs(a[0]! - a[a.length - 2]!));
  return worst;
}

const CHARACTERS: { id: string; file: string }[] = [
  { id: 'garde_body_clerk', file: `${RIGGED}/garde_body_clerk.glb` },
  { id: 'garde_body_power_armor_heavy', file: `${RIGGED}/garde_body_power_armor_heavy.glb` },
  { id: 'hero_warlord', file: `${RIGGED}/hero_warlord.glb` },
  { id: 'raider_body_human', file: `${RIGGED}/raider_body_human.glb` },
];
const CLIPS = ['idle', 'walk', 'run', 'build', 'death'];

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
for (const character of CHARACTERS) {
  if (only.length > 0 && !only.includes(character.id)) continue;
  const entry = rigmap.assets[character.id]!;
  const r = entry.retarget!;
  const rows: Record<string, Record<string, number>> = {};
  const lifts = new Map<string, number[]>();
  const curves = new Map<string, number[]>();
  for (const ground of [false, true]) {
    const document = await prepare(character.file, character.id);
    const source = await loadRetargetSource(
      resolve(LOCAL, r.from),
      resolve(LOCAL, r.rigmap),
      resolve(LOCAL, r.clipmap),
    );
    // --lift=<mm> overrules the default root-lift ceiling, --no-relief drops step 5a, so one run can price both.
    const lift = process.argv.find((a) => a.startsWith('--lift='))?.slice(7);
    const slope = process.argv.find((a) => a.startsWith('--slope='))?.slice(8);
    retargetClips(document, source, {
      ...(r.bones ? { bones: r.bones } : {}),
      ground,
      ...(lift === undefined ? {} : { maxLift: Number(lift) / 1000 }),
      ...(slope === undefined ? {} : { liftSlope: Number(slope) / 1000 }),
      ...(process.argv.includes('--no-relief') ? { ankleRelief: false } : {}),
    });
    // --lod: measure on the reduced LOD0 the game actually draws, not on the full-resolution source mesh.
    if (process.argv.includes('--lod') && entry.lod0Triangles !== undefined)
      await simplifyToTarget(document, entry.lod0Triangles);
    const boneClip = ground
      ? undefined
      : process.argv.find((a) => a.startsWith('--bone='))?.slice(7);
    for (const [name, s] of sampleClips(document, boneClip)) {
      if (!CLIPS.includes(name)) continue;
      const key = ground ? 'na' : 'voor';
      rows[name] ??= {};
      rows[name][`lowestRange_${key}`] = mm(range(s.lowest));
      rows[name][`rootRange_${key}`] = mm(range(s.rootY));
      rows[name][`headRange_${key}`] = mm(range(s.headY));
      rows[name][`rootStep_${key}`] = mm(maxStep(s.rootY, s.loop));
      rows[name][`lowestMin_${key}`] = mm(Math.min(...s.lowest));
      const existing = lifts.get(name);
      if (existing) {
        curves.set(name, s.rootY);
        const lift = s.rootY.map((y, i) => y - existing[i]!);
        rows[name]!['liftMax'] = mm(Math.max(...lift));
        rows[name]!['liftStep'] = mm(maxStep(lift, s.loop));
      } else lifts.set(name, s.rootY);
    }
  }
  const dump = process.argv.find((a) => a.startsWith('--dump='))?.slice(7);
  if (dump) {
    const before = lifts.get(dump);
    const after = curves.get(dump);
    if (before && after) {
      console.log(`\n--- ${character.id} ${dump}: frame, rootY voor, rootY na, lift (mm)`);
      before.forEach((y, i) => {
        const na = after[i]!;
        console.log(
          `${String(i).padStart(3)} ${String(mm(y)).padStart(8)} ${String(mm(na)).padStart(8)} ${String(mm(na - y)).padStart(8)}`,
        );
      });
    }
  }
  console.log(`\n=== ${character.id}`);
  for (const clip of CLIPS) {
    const row = rows[clip];
    if (!row) continue;
    console.log(
      `${clip.padEnd(6)} lowestRange ${String(row['lowestRange_voor']).padStart(7)} -> ${String(row['lowestRange_na']).padStart(7)}` +
        ` | rootRange ${String(row['rootRange_voor']).padStart(7)} -> ${String(row['rootRange_na']).padStart(7)}` +
        ` | headRange ${String(row['headRange_voor']).padStart(7)} -> ${String(row['headRange_na']).padStart(7)}` +
        ` | rootStep ${String(row['rootStep_voor']).padStart(6)} -> ${String(row['rootStep_na']).padStart(6)}` +
        ` | liftMax ${String(row['liftMax']).padStart(7)} liftStep ${String(row['liftStep']).padStart(6)}` +
        ` | lowestMin ${String(row['lowestMin_voor']).padStart(7)} -> ${String(row['lowestMin_na']).padStart(6)}`,
    );
  }
}
