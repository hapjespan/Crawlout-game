// The uv set of the procedural primitives (src/uvmap.ts) and the generated surface maps (src/surfaceTex.ts).
// No source art: everything here is generated, so the test can assert on the pixels.
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { makeBox, type Mesh } from '../src/geometry.js';
import {
  makeBoxUv,
  makeCylinderClean,
  makeCone,
  makePrism,
  makeSphere,
  makeTube,
} from '../src/shapes.js';
import { boxProjectUv, UV_METERS_PER_TILE, withUv } from '../src/uvmap.js';
import { SURFACE_KINDS, surfaceKindOfName, surfaceMaps } from '../src/surfaceTex.js';

/** Triangles with a world area but no uv area: those get no texture and no tangent frame. */
function degenerateUv(mesh: Mesh): number {
  const uvs = mesh.uvs;
  if (!uvs) return mesh.indices.length / 3;
  let bad = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => mesh.indices[i + k]!) as [number, number, number];
    const p = (v: number, k: number): number => mesh.positions[v * 3 + k]!;
    const e1 = [0, 1, 2].map((k) => p(b, k) - p(a, k)) as [number, number, number];
    const e2 = [0, 1, 2].map((k) => p(c, k) - p(a, k)) as [number, number, number];
    const world =
      Math.hypot(
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ) / 2;
    const u = (v: number, k: number): number => uvs[v * 2 + k]!;
    const area =
      Math.abs(
        (u(b, 0) - u(a, 0)) * (u(c, 1) - u(a, 1)) - (u(c, 0) - u(a, 0)) * (u(b, 1) - u(a, 1)),
      ) / 2;
    if (world > 1e-9 && area < 1e-12) bad++;
  }
  return bad;
}

/** Texels per metre of a mesh with a `texels` wide map on it; render holds buildings to 100..180. */
function texelDensity(mesh: Mesh, texels: number): number {
  let world = 0;
  let uv = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => mesh.indices[i + k]!) as [number, number, number];
    const p = (v: number, k: number): number => mesh.positions[v * 3 + k]!;
    const e1 = [0, 1, 2].map((k) => p(b, k) - p(a, k)) as [number, number, number];
    const e2 = [0, 1, 2].map((k) => p(c, k) - p(a, k)) as [number, number, number];
    world +=
      Math.hypot(
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ) / 2;
    const u = (v: number, k: number): number => mesh.uvs![v * 2 + k]!;
    uv +=
      Math.abs(
        (u(b, 0) - u(a, 0)) * (u(c, 1) - u(a, 1)) - (u(c, 0) - u(a, 0)) * (u(b, 1) - u(a, 1)),
      ) / 2;
  }
  return texels / Math.sqrt(world / uv);
}

describe('the uv set of the procedural primitives', () => {
  const shapes: [string, Mesh][] = [
    ['box', makeBoxUv([1.2, 2.4, 0.8])],
    ['cylinder', makeCylinderClean(0.5, 0.5, 2, 12, false)],
    ['frustum', makeCylinderClean(0.6, 0.2, 1.4, 10, false)],
    ['cone', makeCone(0.7, 1.5, 10, false)],
    [
      'prism x',
      withUv(
        makePrism(
          [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
          2,
          { axis: 'x' },
        ),
      ),
    ],
    [
      'prism z',
      withUv(
        makePrism(
          [
            [0, 0],
            [1, 0],
            [0.4, 1],
          ],
          1.5,
          { axis: 'z' },
        ),
      ),
    ],
    ['sphere', makeSphere(0.9, 12, 6, 'full')],
    ['dome', makeSphere(1.1, 12, 6, 'top')],
    [
      'tube',
      makeTube(
        [
          [0, 0, 0],
          [0, 1, 0],
          [0.6, 1.6, 0],
        ],
        0.08,
        6,
      ),
    ],
  ];

  it.each(shapes)('%s carries a uv for every vertex', (_label, mesh) => {
    expect(mesh.uvs).not.toBeNull();
    expect(mesh.uvs!.length).toBe((mesh.positions.length / 3) * 2);
    expect([...mesh.uvs!].every((v) => Number.isFinite(v))).toBe(true);
  });

  // A triangle whose uv collapses to a point samples one texel and has no tangent frame: the fragment would read as
  // flat colour under a normal map. That is exactly the state the whole procedural set was in.
  it.each(shapes)('%s has no triangle with a surface but no uv surface', (_label, mesh) => {
    expect(degenerateUv(mesh)).toBe(0);
  });

  it('maps one tile to UV_METERS_PER_TILE metres of surface, whatever the shape', () => {
    // A 256 px tile over 2 m is 128 texels/m; every shape has to land in render's DENSITY_BAND of 100..180, or
    // uvScaleForDensity rescales its uv and the panels and planks change size from one part to the next.
    for (const [label, mesh] of shapes) {
      expect(texelDensity(mesh, 256), label).toBeGreaterThanOrEqual(100);
      expect(texelDensity(mesh, 256), label).toBeLessThanOrEqual(180);
    }
    expect(UV_METERS_PER_TILE).toBe(2);
  });

  it('projects a box face on the two axes across its normal', () => {
    const box = boxProjectUv(makeBox([2, 2, 2]));
    const uvs = box.uvs!;
    // makeBox emits the top face first: its four corners span one tile each way (2 m over a 2 m tile).
    const u = [0, 1, 2, 3].map((i) => uvs[i * 2]!);
    const v = [0, 1, 2, 3].map((i) => uvs[i * 2 + 1]!);
    expect(Math.max(...u) - Math.min(...u)).toBeCloseTo(1, 6);
    expect(Math.max(...v) - Math.min(...v)).toBeCloseTo(1, 6);
  });

  it('leaves a mesh that brought its own uv alone', () => {
    const cylinder = makeCylinderClean(0.4, 0.4, 1, 8, false);
    expect(withUv(cylinder).uvs).toBe(cylinder.uvs);
  });
});

describe('the surface kind of a material name', () => {
  // The same ladder as render's surfaceKindOfMaterial; these are real names from assets/src.
  it.each([
    ['metal_vault_yellow', 'paintedMetal'],
    ['team_trim', 'paintedMetal'],
    ['scrap_metal_dark', 'paintedMetal'],
    ['rust_roof', 'rustMetal'],
    ['tyre_rubber', 'leather'],
    ['opening', 'leather'],
    ['skin_leather_green', 'leather'],
    ['canvas_tent', 'cloth'],
    ['sandbag_canvas', 'cloth'],
    ['concrete_ruin', 'concrete'],
    ['bone_stone', 'concrete'],
    ['roof_tar', 'roofing'],
    ['lens_amber', 'lens'],
    ['club_wood', 'wood'],
    ['wall_proxy', 'wood'],
  ])('%s is %s', (name, kind) => {
    expect(surfaceKindOfName(name)).toBe(kind);
  });
});

describe('the generated surface maps', () => {
  it('returns the identical bytes for the same kind and size (deterministic, and dedup can merge them)', () => {
    const a = surfaceMaps('paintedMetal', 64);
    const b = surfaceMaps('paintedMetal', 64);
    expect(Buffer.from(a.normal).equals(Buffer.from(b.normal))).toBe(true);
  });

  it.each(SURFACE_KINDS.map((k) => [k]))(
    'writes three readable %s maps of one size',
    async (kind) => {
      const maps = surfaceMaps(kind, 64);
      for (const png of [maps.base, maps.normal, maps.mr]) {
        const meta = await sharp(Buffer.from(png)).metadata();
        expect([meta.width, meta.height]).toEqual([64, 64]);
      }
    },
  );

  it('packs roughness in G and metalness in B, and separates metal from cloth', async () => {
    const read = async (kind: Parameters<typeof surfaceMaps>[0]) => {
      const { data } = await sharp(Buffer.from(surfaceMaps(kind, 64).mr))
        .raw()
        .toBuffer({
          resolveWithObject: true,
        });
      let rough = 0;
      let metal = 0;
      for (let i = 0; i < 64 * 64; i++) {
        rough += data[i * 3 + 1]! / 255;
        metal += data[i * 3 + 2]! / 255;
      }
      return { rough: rough / 4096, metal: metal / 4096 };
    };
    const steel = await read('paintedMetal');
    const canvas = await read('cloth');
    const glass = await read('lens');
    expect(steel.metal).toBeGreaterThan(canvas.metal + 0.15);
    expect(canvas.rough).toBeGreaterThan(steel.rough + 0.2);
    expect(glass.rough).toBeLessThan(steel.rough);
    expect(canvas.metal).toBeLessThan(0.01);
  });

  it('bends the normal where there is relief and leaves a lens flat', async () => {
    const tilt = async (kind: Parameters<typeof surfaceMaps>[0]) => {
      const { data } = await sharp(Buffer.from(surfaceMaps(kind, 64).normal))
        .raw()
        .toBuffer({
          resolveWithObject: true,
        });
      let sum = 0;
      for (let i = 0; i < 64 * 64; i++)
        sum += Math.hypot(data[i * 3]! / 255 - 0.5, data[i * 3 + 1]! / 255 - 0.5) * 2;
      return sum / 4096;
    };
    expect(await tilt('lens')).toBeLessThan(0.01);
    for (const kind of ['paintedMetal', 'rustMetal', 'wood', 'concrete', 'cloth'] as const)
      expect(await tilt(kind)).toBeGreaterThan(0.03);
  });
});
