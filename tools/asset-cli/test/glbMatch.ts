// Comparing a fresh build against the committed assets/dist used to be a byte-for-byte check. That silently assumed
// the build is bit-identical on every platform, and it is not: the shape generators lean on Math.sin, Math.cos and
// Math.pow, whose last bit differs between the macOS and glibc libm. The first real CI run (PR #1, 21 October) caught
// 5 of 132 assets that way — not one broken shape, just the handful whose values happened to land on a rounding
// boundary. See docs/overdracht-2026-10-22.md.
//
// What the check is actually for is unchanged: assets/dist is the build of the fragments, so nobody hand-edited a .glb
// and nobody forgot to rebuild. That survives a tolerance on the float data. Integer data (indices, joints) and the
// whole glTF structure are still compared exactly, so a real difference — a missing primitive, a changed material, a
// different vertex count, an edited index — still fails.
import { expect } from 'vitest';
import { type Document } from '@gltf-transform/core';
import { createIO } from '../src/lods.js';

/** One ULP of a float32 near 1 is about 1.2e-7; a few of those covers a libm difference and nothing more. */
const FLOAT_EPSILON = 1e-5;

// The same IO the build uses: the LODs are meshopt-compressed, so a bare NodeIO cannot read them.
const io = createIO();

interface AccessorData {
  name: string;
  type: string;
  componentType: number;
  normalized: boolean;
  count: number;
  values: number[];
}

function accessorsOf(doc: Document): AccessorData[] {
  return doc
    .getRoot()
    .listAccessors()
    .map((a) => ({
      name: a.getName(),
      type: a.getType(),
      componentType: a.getComponentType(),
      normalized: a.getNormalized(),
      count: a.getCount(),
      values: Array.from(a.getArray() ?? []),
    }));
}

/** Everything about the file except the raw numbers: a changed material, mesh or primitive must still fail. */
function structureOf(doc: Document): unknown {
  const root = doc.getRoot();
  return {
    materials: root
      .listMaterials()
      .map((m) => ({ name: m.getName(), alphaMode: m.getAlphaMode() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    nodes: root
      .listNodes()
      .map((n) => n.getName())
      .sort(),
    meshes: root
      .listMeshes()
      .map((m) => ({
        name: m.getName(),
        primitives: m.listPrimitives().map((p) => ({
          mode: p.getMode(),
          semantics: p.listSemantics().slice().sort(),
          material: p.getMaterial()?.getName() ?? null,
        })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    animations: root
      .listAnimations()
      .map((a) => a.getName())
      .sort(),
  };
}

/** Float accessors (positions, normals, weights, keyframe times) tolerate a libm-sized difference; the rest must not. */
function isFloat(componentType: number): boolean {
  return componentType === 5126; // GL_FLOAT
}

/**
 * Asserts that a freshly built .glb is the same asset as the committed one. `label` names the file in the failure.
 */
export async function expectGlbMatches(
  fresh: Uint8Array,
  committed: Uint8Array,
  label: string,
): Promise<void> {
  const a = await io.readBinary(fresh);
  const b = await io.readBinary(committed);

  expect(structureOf(a), `${label}: glTF structure`).toEqual(structureOf(b));

  const fa = accessorsOf(a);
  const fb = accessorsOf(b);
  expect(fa.length, `${label}: accessor count`).toBe(fb.length);

  for (let i = 0; i < fa.length; i++) {
    const x = fa[i]!;
    const y = fb[i]!;
    const where = `${label}: accessor ${i}${x.name ? ` (${x.name})` : ''}`;
    expect({ ...x, values: null }, `${where} header`).toEqual({ ...y, values: null });

    if (!isFloat(x.componentType)) {
      expect(x.values, `${where} integer data`).toEqual(y.values);
      continue;
    }
    for (let k = 0; k < x.values.length; k++) {
      const dx = x.values[k]!;
      const dy = y.values[k]!;
      if (dx === dy) continue;
      // Relative for large magnitudes, absolute near zero.
      const scale = Math.max(1, Math.abs(dx), Math.abs(dy));
      expect(
        Math.abs(dx - dy) / scale,
        `${where} element ${k}: ${dx} vs ${dy}`,
      ).toBeLessThanOrEqual(FLOAT_EPSILON);
    }
  }
}
