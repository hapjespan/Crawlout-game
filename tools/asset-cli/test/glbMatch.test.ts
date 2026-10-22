// Proves the tolerant comparator is not vacuous: it must still fail on the differences the byte-for-byte check used to
// catch (edited geometry, a different asset, a changed structure), while letting a libm-sized float difference pass.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createIO } from '../src/lods.js';
import { expectGlbMatches } from './glbMatch.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const dist = (path: string): Uint8Array => readFileSync(join(repo, 'assets/dist', path));
const io = createIO();

/** Rebuilds a .glb with every position nudged by `delta` meters, the way an edited model would differ. */
async function nudgePositions(glb: Uint8Array, delta: number): Promise<Uint8Array> {
  const doc = await io.readBinary(glb);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const arr = pos.getArray()!;
      const copy = arr.slice();
      for (let i = 0; i < copy.length; i++) copy[i] = copy[i]! + delta;
      pos.setArray(copy);
    }
  }
  return io.writeBinary(doc);
}

describe('expectGlbMatches', () => {
  const asset = 'survival_behemoth/lod0.glb';

  it('passes for a file against itself', async () => {
    await expectGlbMatches(dist(asset), dist(asset), asset);
  });

  it('fails when the geometry really moved', async () => {
    // 1 mm is far below anything a modeller would call a change, and still thousands of times a libm difference.
    const moved = await nudgePositions(dist(asset), 0.001);
    await expect(expectGlbMatches(moved, dist(asset), asset)).rejects.toThrow();
  });

  it('tolerates a difference the size of float rounding', async () => {
    const jittered = await nudgePositions(dist(asset), 1e-9);
    await expectGlbMatches(jittered, dist(asset), asset);
  });

  it('fails when it is a different asset altogether', async () => {
    await expect(
      expectGlbMatches(dist('garde_body_vertibird/lod0.glb'), dist(asset), asset),
    ).rejects.toThrow();
  });
});
