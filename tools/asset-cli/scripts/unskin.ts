// Bakes a skinned source GLB into a static one in its glTF rest pose (joint world * inverse bind), for
// tools/blender/rig-from-donor.py. Blender's importer does not evaluate a foreign skin that way: a Sketchfab rip whose
// inverse bind matrices disagree with its node hierarchy comes in lying down or exploded, and the donor rig is then
// fitted to the wrong shape. Statues that carry a skin go through here first.
//   npx -y pnpm@9 --filter @crawlout/asset-cli exec tsx scripts/unskin.ts <in.glb> <out.glb>
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { createIO } from '../src/lods.js';
import { poseSkinnedDocument } from '../src/pose.js';

const [src, out] = process.argv
  .slice(2)
  .map((p) => resolve(process.env.INIT_CWD ?? process.cwd(), p));
if (!src || !out) throw new Error('usage: unskin.ts <in.glb> <out.glb>');
await MeshoptDecoder.ready;
const io = createIO();
const doc = await io.readBinary(readFileSync(src));
while (
  doc
    .getRoot()
    .listSkins()
    .some((s) =>
      doc
        .getRoot()
        .listNodes()
        .some((n) => n.getSkin() === s),
    )
) {
  poseSkinnedDocument(doc, null, 0);
  const done = doc.getRoot().listSkins()[0]!;
  if (
    !doc
      .getRoot()
      .listNodes()
      .some((n) => n.getSkin() === done)
  )
    done.dispose();
}
for (const a of doc.getRoot().listAnimations()) a.dispose();
const b = getBounds(doc.getRoot().listScenes()[0]!);
console.log(
  `rest pose bounds ${b.min.map((v) => v.toFixed(2))} .. ${b.max.map((v) => v.toFixed(2))}`,
);
writeFileSync(out, await io.writeBinary(doc));
