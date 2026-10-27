// How badly does the skin deform a clip? An edge that is twice its bind length is a face stretched across two bones
// that moved apart, which is what "the power armour frame crumples" looks like from the inside: hollow struts whose
// two ends ended up on bones a long way apart in the skeleton.
//
// Reports, per clip, the worst and the 99.9th percentile of |edge| / |edge in bind pose| over every edge and every
// sampled frame, plus how many edges ever pass 1.5x. The percentile is the honest number: a handful of degenerate
// edges in the source will always produce a large maximum.
//
// Reads the gitignored assets/local like measure-bob (CRAWLOUT_LOCAL, CRAWLOUT_RIGGED). Not part of the build:
// `node --import tsx scripts/measure-stretch.ts <assetId> [--clip=build] [--every=4]`.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Document, Node } from '@gltf-transform/core';
import { readTracks, sampleTrack } from '../src/bake.js';
import { pruneBones } from '../src/bones.js';
import { loadRetargetSource } from '../src/conform.js';
import { extractMeshes, fitCharacter } from '../src/fit.js';
import { createIO } from '../src/lods.js';
import { ensureSmoothNormals } from '../src/normals.js';
import { parseRigmap } from '../src/rigmap.js';
import { retargetClips } from '../src/retarget.js';
import { compose, multiply, type Mat, type Pose } from '../src/math.js';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const LOCAL = process.env['CRAWLOUT_LOCAL'] ?? `${ROOT}/assets/local`;
const RIGGED = process.env['CRAWLOUT_RIGGED'] ?? `${LOCAL}/rigged`;
const rigmap = parseRigmap(JSON.parse(readFileSync(`${LOCAL}/rigmap.json`, 'utf8')));

const flag = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const wanted = flag('clip', 'build');
const every = Number(flag('every', '4'));

/** Unique edges of every skinned primitive, as index pairs into one shared vertex table. */
function collect(document: Document): {
  positions: Float64Array;
  joints: Int32Array;
  weights: Float32Array;
  edges: Int32Array;
} {
  const skin = document.getRoot().listSkins()[0]!;
  const px: number[] = [];
  const ji: number[] = [];
  const jw: number[] = [];
  const edges: number[] = [];
  const seen = new Set<string>();
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || node.getSkin() !== skin) continue;
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      const jointAttr = prim.getAttribute('JOINTS_0');
      const weightAttr = prim.getAttribute('WEIGHTS_0');
      const indices = prim.getIndices();
      if (!position || !jointAttr || !weightAttr || !indices) continue;
      const base = px.length / 3;
      const p = [0, 0, 0];
      const j = [0, 0, 0, 0];
      const w = [0, 0, 0, 0];
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, p);
        jointAttr.getElement(i, j);
        weightAttr.getElement(i, w);
        px.push(p[0]!, p[1]!, p[2]!);
        for (let k = 0; k < 4; k++) {
          ji.push(w[k]! > 0 ? j[k]! : 0);
          jw.push(w[k]! > 0 ? w[k]! : 0);
        }
      }
      for (let i = 0; i + 2 < indices.getCount(); i += 3) {
        const tri = [indices.getScalar(i), indices.getScalar(i + 1), indices.getScalar(i + 2)];
        for (let k = 0; k < 3; k++) {
          const a = base + tri[k]!;
          const b = base + tri[(k + 1) % 3]!;
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push(a, b);
        }
      }
    }
  }
  return {
    positions: Float64Array.from(px),
    joints: Int32Array.from(ji),
    weights: Float32Array.from(jw),
    edges: Int32Array.from(edges),
  };
}

const id = process.argv[2]!;
const entry = rigmap.assets[id]!;
const document: Document = await createIO().readBinary(
  new Uint8Array(readFileSync(`${RIGGED}/${id}.glb`)),
);
if (entry.meshes) await extractMeshes(document, entry.meshes);
ensureSmoothNormals(document);
if (entry.fit) fitCharacter(document, entry.fit);
if (entry.rig) pruneBones(document, rigmap.rigs[entry.rig]!.bones, rigmap.rigs[entry.rig]!.merge);
const r = entry.retarget!;
const source = await loadRetargetSource(
  resolve(LOCAL, r.from),
  resolve(LOCAL, r.rigmap),
  resolve(LOCAL, r.clipmap),
);
retargetClips(document, source, { ...(r.bones ? { bones: r.bones } : {}) });

const skin = document.getRoot().listSkins()[0]!;
const joints = skin.listJoints();
const ibm = skin.getInverseBindMatrices();
const inverseBind = joints.map((_, b) => {
  const m = new Float64Array(16);
  if (ibm) ibm.getElement(b, m as unknown as number[]);
  else for (let i = 0; i < 4; i++) m[i * 5] = 1;
  return m;
});
const { positions, joints: vj, weights: vw, edges } = collect(document);
const bind = new Float64Array(edges.length / 2);
for (let e = 0; e < bind.length; e++) {
  const a = edges[e * 2]! * 3;
  const b = edges[e * 2 + 1]! * 3;
  bind[e] = Math.hypot(
    positions[a]! - positions[b]!,
    positions[a + 1]! - positions[b + 1]!,
    positions[a + 2]! - positions[b + 2]!,
  );
}

const animation = document
  .getRoot()
  .listAnimations()
  .find((a) => a.getName() === wanted)!;
const tracks = readTracks(animation);
const times = [...(tracks[0]?.times ?? [])];
const posed = new Float64Array(positions.length);
const ratios: number[] = [];
let worst = 0;
const stretched = new Set<number>();
for (let f = 0; f < times.length; f += every) {
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
    const v = sampleTrack(track, times[f]!);
    if (track.path === 'translation') pose.t = [v[0]!, v[1]!, v[2]!];
    else if (track.path === 'rotation') pose.r = [v[0]!, v[1]!, v[2]!, v[3]!];
    else pose.s = [v[0]!, v[1]!, v[2]!];
  }
  const cache = new Map<Node, Mat>();
  const world = (node: Node): Mat => {
    let m = cache.get(node);
    if (!m) {
      const local = compose(
        overrides.get(node) ??
          ({
            t: [...node.getTranslation()],
            r: [...node.getRotation()],
            s: [...node.getScale()],
          } as Pose),
      );
      const parent = node.getParentNode();
      m = parent ? multiply(world(parent), local) : local;
      cache.set(node, m);
    }
    return m;
  };
  const skinMat = joints.map((joint, b) => multiply(world(joint), inverseBind[b]!));
  for (let v = 0; v < positions.length / 3; v++) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let k = 0; k < 4; k++) {
      const w = vw[v * 4 + k]!;
      if (w <= 0) continue;
      const m = skinMat[vj[v * 4 + k]!]!;
      const px = positions[v * 3]!;
      const py = positions[v * 3 + 1]!;
      const pz = positions[v * 3 + 2]!;
      x += w * (m[0]! * px + m[4]! * py + m[8]! * pz + m[12]!);
      y += w * (m[1]! * px + m[5]! * py + m[9]! * pz + m[13]!);
      z += w * (m[2]! * px + m[6]! * py + m[10]! * pz + m[14]!);
    }
    posed[v * 3] = x;
    posed[v * 3 + 1] = y;
    posed[v * 3 + 2] = z;
  }
  for (let e = 0; e < bind.length; e++) {
    const rest = bind[e]!;
    if (!(rest > 1e-6)) continue;
    const a = edges[e * 2]! * 3;
    const b = edges[e * 2 + 1]! * 3;
    const ratio =
      Math.hypot(posed[a]! - posed[b]!, posed[a + 1]! - posed[b + 1]!, posed[a + 2]! - posed[b + 2]!) /
      rest;
    ratios.push(ratio);
    if (ratio > worst) worst = ratio;
    if (ratio > 1.5) stretched.add(e);
  }
}
ratios.sort((a, b) => a - b);
const at = (q: number): number => ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * q))]!;
console.log(
  `${id} ${wanted}: ${bind.length} edges, ${Math.ceil(times.length / every)} frames` +
    `  p99.9 ${at(0.999).toFixed(2)}x  p99.99 ${at(0.9999).toFixed(2)}x  max ${worst.toFixed(2)}x` +
    `  edges ever over 1.5x: ${stretched.size} (${((stretched.size / bind.length) * 100).toFixed(2)}%)`,
);
