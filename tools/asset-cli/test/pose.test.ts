// poseSkinnedDocument bakes one moment of a clip into the vertices, so a still picture shows a character walking
// instead of standing in its bind pose.
import { NodeIO, type Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { poseSkinnedDocument } from '../src/pose.js';
import { makeHumanoid, makeProp } from './fixtures.js';

const io = new NodeIO();

/** Vervangt de (stilstaande) walk-clip door een draai van de Hips van 0 naar 90 graden om x in 1 seconde. */
function animateHips(doc: Document): void {
  const animation = doc
    .getRoot()
    .listAnimations()
    .find((a) => a.getName() === 'walk')!;
  const sampler = animation.listSamplers()[0]!;
  const half = Math.SQRT1_2;
  sampler.getInput()!.setArray(new Float32Array([0, 1]));
  sampler.getOutput()!.setArray(new Float32Array([0, 0, 0, 1, half, 0, 0, half]));
}

const positionsOf = (doc: Document): Float32Array =>
  doc
    .getRoot()
    .listMeshes()[0]!
    .listPrimitives()[0]!
    .getAttribute('POSITION')!
    .getArray() as Float32Array;

describe('poseSkinnedDocument', () => {
  it('zet de mesh in de pose van de clip en laat geen skin achter', async () => {
    const bytes = await makeHumanoid({ segments: 8, rings: 8 });
    const bind = positionsOf(await io.readBinary(bytes)).slice();

    const doc = await io.readBinary(bytes);
    animateHips(doc);
    poseSkinnedDocument(doc, 'walk', 1);
    const posed = positionsOf(doc);

    expect(doc.getRoot().listSkins()[0]!.listJoints().length).toBeGreaterThan(0);
    const node = doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === 'body')!;
    expect(node.getSkin()).toBeNull();
    const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    expect(prim.listSemantics()).not.toContain('JOINTS_0');
    expect(prim.listSemantics()).not.toContain('WEIGHTS_0');

    let moved = 0;
    for (let i = 0; i < bind.length; i++) if (Math.abs(bind[i]! - posed[i]!) > 1e-4) moved++;
    expect(moved).toBeGreaterThan(bind.length / 4);
  });

  it('is deterministisch, houdt de rustpose rechtop en meldt een onbekende clip of ontbrekende skin', async () => {
    const bytes = await makeHumanoid({ segments: 6, rings: 6 });
    const pose = async (phase: number): Promise<Float32Array> => {
      const doc = await io.readBinary(bytes);
      animateHips(doc);
      poseSkinnedDocument(doc, 'walk', phase);
      return positionsOf(doc).slice();
    };
    const rest = await pose(0);
    for (const [i, v] of (await pose(0)).entries()) expect(v).toBe(rest[i]);
    // De rustpose staat rechtop; met de heupen 90 graden gekanteld is hij dat niet meer.
    const height = (p: Float32Array): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 1; i < p.length; i += 3) {
        lo = Math.min(lo, p[i]!);
        hi = Math.max(hi, p[i]!);
      }
      return hi - lo;
    };
    expect(height(await pose(1))).toBeLessThan(height(rest) * 0.75);

    const other = await io.readBinary(bytes);
    expect(() => poseSkinnedDocument(other, 'sprint', 0)).toThrow(/sprint/);
    const prop = await io.readBinary(await makeProp());
    expect(() => poseSkinnedDocument(prop, 'walk', 0)).toThrow(/skin/);
  });
});
