// Scratch diagnostic: how far does the geometry bound to a bone reach from that bone's joint, in bind pose?
// A boot's toe plate should sit within ~10 cm of the toe joint; anything further means the weight transfer
// hung the wrong part of the shell on the toe. Run with `node --import tsx scripts/measure-toe.ts <assetId>`.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Document, Node } from '@gltf-transform/core';
import { pruneBones } from '../src/bones.js';
import { extractMeshes, fitCharacter } from '../src/fit.js';
import { createIO } from '../src/lods.js';
import { ensureSmoothNormals } from '../src/normals.js';
import { parseRigmap } from '../src/rigmap.js';
import { compose, multiply, type Mat, type Pose } from '../src/math.js';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const LOCAL = process.env['CRAWLOUT_LOCAL'] ?? `${ROOT}/assets/local`;
const rigmap = parseRigmap(JSON.parse(readFileSync(`${LOCAL}/rigmap.json`, 'utf8')));

const FILES: Record<string, string> = {
  garde_body_clerk: `${LOCAL}/rigged/garde_body_clerk.glb`,
  garde_body_power_armor_heavy: `${LOCAL}/rigged/garde_body_power_armor_heavy.glb`,
  hero_warlord: `${LOCAL}/rigged/hero_warlord.glb`,
  raider_body_human: `${LOCAL}/rigged/raider_body_human.glb`,
};

const restWorld = (node: Node): Mat => {
  const local = compose({
    t: [...node.getTranslation()],
    r: [...node.getRotation()],
    s: [...node.getScale()],
  } as Pose);
  const parent = node.getParentNode();
  return parent ? multiply(restWorld(parent), local) : local;
};

for (const id of process.argv.slice(2)) {
  const entry = rigmap.assets[id]!;
  const document: Document = await createIO().readBinary(new Uint8Array(readFileSync(FILES[id]!)));
  if (entry.meshes) await extractMeshes(document, entry.meshes);
  ensureSmoothNormals(document);
  if (entry.fit) fitCharacter(document, entry.fit);
  if (entry.rig) pruneBones(document, rigmap.rigs[entry.rig]!.bones, rigmap.rigs[entry.rig]!.merge);

  const skin = document.getRoot().listSkins()[0]!;
  const joints = skin.listJoints();
  const stats = joints.map(() => ({ count: 0, maxDistance: 0, lowest: Infinity, far: 0 }));
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
        let top = 0;
        let topJoint = -1;
        for (let k = 0; k < 4; k++)
          if (w[k]! > top) {
            top = w[k]!;
            topJoint = j[k]!;
          }
        if (topJoint < 0) continue;
        const s = stats[topJoint]!;
        const origin = restWorld(joints[topJoint]!);
        const d = Math.hypot(p[0]! - origin[12]!, p[1]! - origin[13]!, p[2]! - origin[14]!);
        s.count++;
        if (d > s.maxDistance) s.maxDistance = d;
        if (d > 0.15) s.far++;
        if (p[1]! < s.lowest) s.lowest = p[1]!;
      }
    }
  }
  console.log(`\n=== ${id}`);
  joints.forEach((joint, b) => {
    const name = joint.getName();
    if (!/Toe|Foot|Leg/.test(name)) return;
    const s = stats[b]!;
    const origin = restWorld(joint);
    console.log(
      `${name.padEnd(16)} verts ${String(s.count).padStart(6)}  joint y ${(origin[13]! * 1000).toFixed(0).padStart(5)} mm` +
        `  furthest ${(s.maxDistance * 1000).toFixed(0).padStart(5)} mm  beyond 150 mm: ${String(s.far).padStart(5)} (${((s.far / Math.max(1, s.count)) * 100).toFixed(0).padStart(3)}%)  lowest bind y ${(s.lowest * 1000).toFixed(0).padStart(6)} mm`,
    );
  });
}
