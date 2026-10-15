// The hard-surface shapes of the robot generator (src/shapes.ts) and the repeat and mirror expansion (src/partExpand.ts):
// winding against the normals, closed volumes, triangle counts, determinism.
import { describe, expect, it } from 'vitest';
import { makeBox, triangleCount, type Mesh, type Vec3 } from '../src/geometry.js';
import { expandParts } from '../src/partExpand.js';
import {
  makeBevelBox,
  makeBoxOpen,
  makeCone,
  makeCorrugated,
  makeCylinderClean,
  makePrism,
  makeSphere,
  makeTrack,
  makeTube,
  triangulate,
} from '../src/shapes.js';
import type { VariantPart } from '../src/variants.js';

function vertex(mesh: Mesh, i: number): Vec3 {
  return [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
}

/** Every triangle's geometric normal agrees with the normals stored on its vertices (counter-clockwise from outside). */
function windingErrors(mesh: Mesh): number {
  let wrong = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [ia, ib, ic] = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
    const [a, b, c] = [vertex(mesh, ia), vertex(mesh, ib), vertex(mesh, ic)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ];
    if (Math.hypot(...(n as [number, number, number])) < 1e-12) continue; // a degenerate sliver
    let dot = 0;
    for (const i of [ia, ib, ic])
      dot +=
        n[0]! * mesh.normals[i * 3]! +
        n[1]! * mesh.normals[i * 3 + 1]! +
        n[2]! * mesh.normals[i * 3 + 2]!;
    if (dot <= 0) wrong++;
  }
  return wrong;
}

/** Signed volume of a closed mesh (positive when the winding points outward). */
function volume(mesh: Mesh): number {
  let sum = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = vertex(mesh, mesh.indices[t]!);
    const b = vertex(mesh, mesh.indices[t + 1]!);
    const c = vertex(mesh, mesh.indices[t + 2]!);
    sum +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return sum;
}

function bounds(mesh: Mesh): { min: Vec3; max: Vec3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length / 3; i++) {
    const p = vertex(mesh, i);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, p[k]!);
      max[k] = Math.max(max[k]!, p[k]!);
    }
  }
  return { min, max };
}

describe('triangulate', () => {
  it('cuts a concave polygon into n-2 triangles that cover its area', () => {
    const l = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 3],
      [0, 3],
    ] as const;
    const tris = triangulate(l);
    expect(tris).toHaveLength(4);
    let area = 0;
    for (const [a, b, c] of tris) {
      const [p, q, r] = [l[a]!, l[b]!, l[c]!];
      area += ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
    }
    expect(area).toBeCloseTo(6, 9); // 4 x 1 plus 1 x 2
  });
});

describe('shapes', () => {
  it('makes a bevel box of 44 triangles with the volume of the box minus the chamfers', () => {
    const mesh = makeBevelBox([2, 1, 3], 0.1);
    expect(triangleCount(mesh)).toBe(44);
    expect(windingErrors(mesh)).toBe(0);
    expect(volume(mesh)).toBeGreaterThan(5.8);
    expect(volume(mesh)).toBeLessThan(6);
    const { min, max } = bounds(mesh);
    expect(min).toEqual([-1, 0, -1.5].map(Math.fround));
    expect(max).toEqual([1, 1, 1.5].map(Math.fround));
  });

  it('drops the bottom of an open box', () => {
    const open = makeBoxOpen([1, 2, 3]);
    expect(triangleCount(open)).toBe(10);
    expect(windingErrors(open)).toBe(0);
    expect(
      Math.min(...Array.from(open.indices, (i) => open.positions[i * 3 + 1]!)),
    ).toBeGreaterThan(-1e-9);
    expect(open.indices.every((i) => open.normals[i * 3 + 1]! > -0.5)).toBe(true); // no face looks down
    expect(triangleCount(makeBox([1, 1, 1]))).toBe(12);
    expect(windingErrors(makeBox([1, 1, 1]))).toBe(0);
  });

  it('winds a cylinder and cone outward', () => {
    for (const [r, rt] of [
      [1, 1],
      [0.95, 0.6],
      [0.3, 0.5],
    ] as const) {
      const cylinder = makeCylinderClean(r, rt, 0.6, 12, false);
      expect(windingErrors(cylinder)).toBe(0);
      expect(volume(cylinder)).toBeGreaterThan(0);
      expect(triangleCount(cylinder)).toBe(12 * 4);
      expect(triangleCount(makeCylinderClean(r, rt, 0.6, 12, true))).toBe(12 * 3);
    }
    const cone = makeCone(0.5, 1, 10, false);
    expect(windingErrors(cone)).toBe(0);
    expect(triangleCount(cone)).toBe(20);
    expect(volume(cone)).toBeCloseTo((Math.PI * 0.25 * 1) / 3, 1);
    expect(triangleCount(makeCone(0.5, 1, 10, true))).toBe(10);
    expect(windingErrors(makeCone(0.5, 1, 10, true))).toBe(0);
  });

  for (const axis of ['x', 'y', 'z'] as const)
    it(`extrudes a profile along ${axis} with outward winding and the right volume`, () => {
      const profile = [
        [-1, 0],
        [1, 0],
        [0, 2],
      ] as const; // a triangle of area 2
      const mesh = makePrism(profile, 3, { axis });
      expect(windingErrors(mesh)).toBe(0);
      expect(volume(mesh)).toBeCloseTo(6, 5);
      const { min, max } = bounds(mesh);
      const centred =
        axis === 'y' ? [min[1], max[1]] : axis === 'x' ? [min[0], max[0]] : [min[2], max[2]];
      expect(centred).toEqual(axis === 'y' ? [0, 3] : [-1.5, 1.5]);
    });

  it('tapers a prism and keeps it closed', () => {
    const mesh = makePrism(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
      2,
      { axis: 'y', taper: [0.5, 0.5] },
    );
    expect(windingErrors(mesh)).toBe(0);
    expect(volume(mesh)).toBeCloseTo((2 / 3) * (4 + 1 + Math.sqrt(4 * 1)), 5); // frustum: h/3 (A1 + A2 + sqrt(A1 A2))
  });

  it('builds a toothed track that stands on y = 0, is 2r high and closed', () => {
    const track = makeTrack({
      length: 2.6,
      radius: 0.45,
      width: 0.8,
      teeth: 14,
      toothHeight: 0.06,
      arcSegments: 4,
    });
    expect(windingErrors(track)).toBe(0);
    expect(volume(track)).toBeGreaterThan(0);
    const { min, max } = bounds(track);
    expect(min[1]).toBeCloseTo(0, 5);
    expect(max[1]).toBeCloseTo(0.9, 5);
    expect(min[0]).toBeCloseTo(-0.4, 5);
    expect(max[0]).toBeCloseTo(0.4, 5);
    expect(max[2]).toBeCloseTo(1.75, 1);
    const smooth = makeTrack({
      length: 2.6,
      radius: 0.45,
      width: 0.8,
      teeth: 0,
      toothHeight: 0,
      arcSegments: 4,
    });
    expect(triangleCount(smooth)).toBeLessThan(triangleCount(track));
  });

  it('builds a corrugated strip of four triangles per period, facing +z', () => {
    const sheet = makeCorrugated(6, 3, 0.5, 0.1);
    expect(triangleCount(sheet)).toBe(4 * 12);
    expect(windingErrors(sheet)).toBe(0);
    const { min, max } = bounds(sheet);
    expect([min[0], max[0], min[1], max[1], min[2], max[2]]).toEqual(
      [-3, 3, 0, 3, 0, 0.1].map(Math.fround),
    );
  });

  it('sweeps a tube along a bent path, closed at both ends', () => {
    const tube = makeTube(
      [
        [0, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
        [1, 1, 1],
      ],
      0.05,
      6,
    );
    expect(windingErrors(tube)).toBe(0);
    expect(triangleCount(tube)).toBe(3 * 12 + 2 * 6);
    expect(volume(tube)).toBeGreaterThan(0);
  });

  it('makes a sphere and a dome with outward winding', () => {
    const sphere = makeSphere(1, 12, 4, 'full');
    expect(windingErrors(sphere)).toBe(0);
    expect(volume(sphere)).toBeGreaterThan(3.5);
    expect(volume(sphere)).toBeLessThan((4 / 3) * Math.PI);
    const dome = makeSphere(1, 12, 3, 'top');
    expect(windingErrors(dome)).toBe(0);
    expect(bounds(dome).min[1]).toBeCloseTo(0, 5);
    expect(triangleCount(dome)).toBe(12 + 2 * 12 * 2);
  });

  it('is deterministic', () => {
    const a = makeTrack({
      length: 2,
      radius: 0.5,
      width: 1,
      teeth: 10,
      toothHeight: 0.05,
      arcSegments: 4,
    });
    const b = makeTrack({
      length: 2,
      radius: 0.5,
      width: 1,
      teeth: 10,
      toothHeight: 0.05,
      arcSegments: 4,
    });
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });
});

describe('expandParts', () => {
  const box: VariantPart = { type: 'box', size: [1, 1, 1], material: 'metal', position: [1, 0, 0] };

  it('repeats along the step and mirrors every copy in x', () => {
    const parts = expandParts([
      { ...box, repeat: { count: 3, step: [0, 0, 2] }, mirror: true, rotation: [10, 20, 30] },
    ]);
    expect(parts).toHaveLength(6);
    expect(parts.map((p) => p.position)).toEqual([
      [1, 0, 0],
      [-1, 0, 0],
      [1, 0, 2],
      [-1, 0, 2],
      [1, 0, 4],
      [-1, 0, 4],
    ]);
    expect(parts[1]!.rotation).toEqual([10, -20, -30]);
    expect(parts.every((p) => p.repeat === undefined && p.mirror === undefined)).toBe(true);
  });

  it('does not mirror a part on x = 0 and flips an asymmetric profile and the ends of a track', () => {
    expect(expandParts([{ ...box, position: [0, 0, 0], mirror: true }])).toHaveLength(1);
    const wedge: VariantPart = {
      type: 'prism',
      profile: [
        [0, 0],
        [2, 0],
        [0, 1],
      ],
      height: 1,
      material: 'metal',
      position: [1, 0, 0],
      mirror: true,
    };
    const [, flipped] = expandParts([wedge]);
    expect(flipped).toMatchObject({
      profile: [
        [-0, 0],
        [-2, 0],
        [-0, 1],
      ],
      position: [-1, 0, 0],
    });
    const track: VariantPart = {
      type: 'track',
      length: 2,
      radius: 0.5,
      width: 1,
      teeth: 0,
      toothHeight: 0,
      arcSegments: 4,
      caps: 'end',
      material: 'rubber',
      position: [1, 0, 0],
      mirror: true,
    };
    expect(expandParts([track])[1]).toMatchObject({ caps: 'start' });
  });
});
