// Delivered models (src/delivered.ts, assets/local/delivered.json) with synthetic GLB's in a temporary dir: no art of any
// kind in the repo. A "robot" of two boxes (one textured, one flat) in odd units and orientation, and a "bat" lying
// along +X, go through the config: rotation, real size, origin, team band, hover, anchors, budgets and the footprint advice.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAssets } from '../src/build.js';
import { buildDelivered, parseDelivered, type DeliveredConfig } from '../src/delivered.js';
import { createIO } from '../src/lods.js';
import { manifestSchema } from '../src/manifest.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'asset-cli-delivered-'));
  mkdirSync(join(root, 'delivered'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A box of the given size with its minimum corner at `at`, subdivided so that the simplifier has something to do. */
function box(
  document: Document,
  name: string,
  size: [number, number, number],
  at: [number, number, number],
  material: ReturnType<Document['createMaterial']>,
  cuts = 6,
): ReturnType<Document['createNode']> {
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const faces: [number[], number[], number[]][] = [
    [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, -1],
      [-1, 0, 0],
      [0, 1, 0],
    ],
    [
      [1, 0, 0],
      [0, 0, -1],
      [0, 1, 0],
    ],
    [
      [-1, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
    ],
    [
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, -1],
    ],
    [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
  ];
  for (const [n, u, v] of faces) {
    const base = positions.length / 3;
    for (let j = 0; j <= cuts; j++)
      for (let i = 0; i <= cuts; i++) {
        const a = (i / cuts) * 2 - 1;
        const b = (j / cuts) * 2 - 1;
        const p = [0, 1, 2].map(
          (k) => at[k]! + (size[k]! / 2) * (1 + n[k]! + a * u[k]! + b * v[k]!),
        );
        positions.push(...p);
        normals.push(...n);
        uvs.push(i / cuts, j / cuts);
      }
    for (let j = 0; j < cuts; j++)
      for (let i = 0; i < cuts; i++) {
        const k = base + j * (cuts + 1) + i;
        indices.push(k, k + 1, k + cuts + 2, k, k + cuts + 2, k + cuts + 1);
      }
  }
  const prim = document
    .createPrimitive()
    .setMaterial(material)
    .setAttribute(
      'POSITION',
      document
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(positions))
        .setBuffer(buffer),
    )
    .setAttribute(
      'NORMAL',
      document
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(normals))
        .setBuffer(buffer),
    )
    .setAttribute(
      'TEXCOORD_0',
      document.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer),
    )
    .setIndices(
      document
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint16Array(indices))
        .setBuffer(buffer),
    );
  return document.createNode(name).setMesh(document.createMesh(name).addPrimitive(prim));
}

async function writeSource(file: string, build: (document: Document) => void): Promise<void> {
  const document = new Document();
  document.createBuffer();
  build(document);
  await new NodeIO().write(join(root, file), document);
}

const png = (rgb: [number, number, number]): Promise<Uint8Array> =>
  sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } },
  })
    .png()
    .toBuffer()
    .then((b) => new Uint8Array(b));

/** A 1.0 x 0.5 x 2.0 body (long axis along y: lying "on its back") with a flat head box, node scale 2 and a 90 degree turn. */
async function writeRobot(): Promise<void> {
  const image = await png([200, 120, 40]);
  await writeSource('delivered/robot.glb', (document) => {
    const textured = document
      .createMaterial('Hull')
      .setBaseColorTexture(document.createTexture('hull').setImage(image).setMimeType('image/png'));
    const flat = document.createMaterial('Eye').setBaseColorFactor([0.1, 0.2, 0.9, 1]);
    const body = box(document, 'Body', [1, 2, 0.5], [-0.5, 0, -0.25], textured);
    const head = box(document, 'Head', [0.4, 0.4, 0.4], [-0.2, 2, -0.2], flat);
    const root = document
      .createNode('Root')
      .setScale([2, 2, 2])
      .setRotation([0, 0, 0, 1])
      .addChild(body)
      .addChild(head);
    document.createScene('s').addChild(root);
  });
}

const config = (assets: Record<string, unknown>): DeliveredConfig =>
  parseDelivered({
    version: 1,
    flatMaterials: { team_trim: { color: '#cccccc' } },
    assets,
  });

describe('delivered models', () => {
  it('turns a model to its real size, grounds it, adds the team band and keeps the budgets', async () => {
    await writeRobot();
    const result = await buildDelivered(
      config({
        test_robot: {
          file: 'delivered/robot.glb',
          kind: 'rigid-unit',
          fit: { axis: 'y', meters: 2 },
          lod0Triangles: 300,
          materials: { Eye: { name: 'lens_eye' } },
          extraParts: [
            { type: 'box', size: [0.5, 0.1, 0.5], position: [0, 1, 0], material: 'team_trim' },
          ],
        },
      }),
      root,
      'test.json',
    );
    expect(result.reports.flatMap((r) => r.errors)).toEqual([]);
    const entry = result.entries[0]!;
    expect(entry.kind).toBe('rigid-unit');
    expect(entry.teamMaterials).toEqual(['team_trim']);
    expect(entry.bounds.min[1]).toBeCloseTo(0, 3);
    // 2 * (2 + 0.4) = 4.8 source meters tall, fitted to 2 m.
    expect(entry.bounds.max[1]).toBeCloseTo(2, 2);
    expect(entry.lods.map((l) => l.triangles).every((t, i, all) => t <= (all[i - 1] ?? 1e9))).toBe(
      true,
    );
    expect(entry.lods[0]!.triangles).toBeLessThanOrEqual(300 + 20);
    const detail = result.details.get('test_robot')!;
    expect(detail.materials).toContain('team_trim');
    expect(detail.materials).toContain('lens_eye');
    expect(detail.materials.some((m) => m.startsWith('metal_hull_test_robot'))).toBe(true);
    manifestSchema.parse({ version: 1, assets: result.entries });
    const lod0 = await createIO().readBinary(result.outputs.get('test_robot/lod0.glb')!);
    const { min } = getBounds(lod0.getRoot().listScenes()[0]!);
    expect(min[1]).toBeCloseTo(0, 3);
  });

  it('bakes a hover height into a floating unit', async () => {
    await writeRobot();
    const result = await buildDelivered(
      config({
        test_drone: {
          file: 'delivered/robot.glb',
          kind: 'rigid-unit',
          scale: 0.1,
          hover: 1.2,
          lod0Triangles: 300,
          extraParts: [
            { type: 'box', size: [0.2, 0.05, 0.2], position: [0, 0.3, 0], material: 'team_trim' },
          ],
        },
      }),
      root,
      'test.json',
    );
    expect(result.reports.flatMap((r) => r.errors)).toEqual([]);
    const entry = result.entries[0]!;
    expect(entry.hover).toBe(1.2);
    expect(entry.bounds.min[1]).toBeCloseTo(1.2, 2);
  });

  it('puts a prop on its grip: long axis to +Z, origin at the offset from the handle end, only the chosen nodes', async () => {
    await writeSource('delivered/bat.glb', (document) => {
      const wood = document.createMaterial('Wood').setBaseColorFactor([0.5, 0.3, 0.1, 1]);
      // 10 units long along +X, fat end at +X.
      const bat = box(document, 'Bat', [10, 1, 1], [0, -0.5, -0.5], wood, 4);
      const other = box(document, 'Other', [10, 1, 1], [0, 5, -0.5], wood, 4);
      document.createScene('s').addChild(bat).addChild(other);
    });
    const result = await buildDelivered(
      config({
        test_club: {
          file: 'delivered/bat.glb',
          kind: 'prop',
          anchor: 'grip',
          include: ['Bat'],
          rotate: [0, -90, 0],
          fit: { axis: 'z', meters: 1 },
          align: { x: 'centre', y: 'centre', z: { fromMin: 0.2 } },
          surface: 'wood',
          lod0Triangles: 100,
        },
      }),
      root,
      'test.json',
    );
    expect(result.reports.flatMap((r) => r.errors)).toEqual([]);
    const { min, max } = result.entries[0]!.bounds;
    expect(max[2] - min[2]).toBeCloseTo(1, 3);
    expect(min[2]).toBeCloseTo(-0.2, 3);
    expect(max[2]).toBeCloseTo(0.8, 3);
    expect(max[1] - min[1]).toBeCloseTo(0.1, 3); // the other bat is not in it
    expect(result.entries[0]!.teamMask).toBe('none');
    expect(result.entries[0]!.teamMaterials).toBeUndefined();
  });

  it('keeps a building at its real size and advises the footprint it needs', async () => {
    await writeRobot();
    const result = await buildDelivered(
      config({
        test_tent: {
          file: 'delivered/robot.glb',
          kind: 'building',
          scale: 0.5,
          footprint: { w: 7, h: 5 },
          lod0Triangles: 300,
          extraParts: [
            { type: 'box', size: [0.3, 0.1, 0.1], position: [0, 1, 0], material: 'team_trim' },
          ],
        },
      }),
      root,
      'test.json',
    );
    const report = result.reports[0]!;
    expect(report.errors).toEqual([]);
    expect(report.warnings.join(' ')).toMatch(/footprint 7x5/);
    expect(result.details.get('test_tent')!.neededFootprint).toEqual({ w: 1, h: 1 });
    expect(result.entries[0]!.footprint).toEqual({ w: 7, h: 5 });
    expect(result.entries[0]!.bounds.max[0] - result.entries[0]!.bounds.min[0]).toBeLessThan(2);
  });

  it('rejects a unit without a team material, config mistakes and an unknown node selection', async () => {
    await writeRobot();
    const noTeam = await buildDelivered(
      config({
        test_robot: {
          file: 'delivered/robot.glb',
          kind: 'rigid-unit',
          scale: 0.5,
          lod0Triangles: 300,
        },
      }),
      root,
      'test.json',
    );
    expect(noTeam.reports[0]!.errors.join(' ')).toMatch(/team-materiaal/);
    expect(() =>
      config({ x: { file: 'a.glb', kind: 'prop', scale: 1, lod0Triangles: 10 } }),
    ).toThrow(/anchor/);
    expect(() => config({ x: { file: 'a.glb', kind: 'rigid-unit', lod0Triangles: 10 } })).toThrow(
      /scale en fit/,
    );
    const nothing = await buildDelivered(
      config({
        x: {
          file: 'delivered/robot.glb',
          kind: 'rigid-unit',
          scale: 1,
          include: ['Nope'],
          lod0Triangles: 10,
        },
      }),
      root,
      'test.json',
    );
    expect(nothing.reports[0]!.errors.join(' ')).toMatch(/geen meshes/);
  });

  // The brief forbade PBR until 23 October 2026 and the pipeline dropped every map at extraction. It now carries the
  // set that render reads: normal and metallic-roughness on the base colour's UV's, same size, nothing else.
  it('carries normal and metallic-roughness through, per material and through the atlas, and drops a map that does not line up', async () => {
    const base = await png([200, 120, 40]);
    const normal = await png([128, 128, 255]);
    const mr = await png([255, 200, 30]);
    const small = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 128, g: 128, b: 255 } },
    })
      .png()
      .toBuffer()
      .then((b) => new Uint8Array(b));
    await writeSource('delivered/pbr.glb', (document) => {
      const texture = (name: string, image: Uint8Array) =>
        document.createTexture(name).setImage(image).setMimeType('image/png');
      // Hull: the full set. Arm: a second diffuse, so the model goes through the atlas. Eye: a normal map of its own
      // size, which render cannot put on the layer of the diffuse.
      const hull = document
        .createMaterial('Hull')
        .setBaseColorTexture(texture('hull', base))
        .setNormalTexture(texture('hull_n', normal))
        .setMetallicRoughnessTexture(texture('hull_mr', mr));
      const arm = document
        .createMaterial('Arm')
        .setBaseColorTexture(texture('arm', mr))
        .setNormalTexture(texture('arm_n', normal));
      const eye = document
        .createMaterial('Eye')
        .setBaseColorTexture(texture('eye', base))
        .setNormalTexture(texture('eye_n', small));
      const scene = document.createScene('s');
      scene.addChild(box(document, 'Body', [1, 2, 0.5], [-0.5, 0, -0.25], hull));
      scene.addChild(box(document, 'Arm', [0.3, 0.6, 0.3], [0.6, 0.5, -0.15], arm));
      scene.addChild(box(document, 'Eye', [0.2, 0.2, 0.2], [-0.1, 2, -0.1], eye));
    });
    const asset = {
      file: 'delivered/pbr.glb',
      kind: 'rigid-unit',
      fit: { axis: 'y', meters: 2 },
      lod0Triangles: 600,
      extraParts: [
        { type: 'box', size: [0.5, 0.1, 0.5], position: [0, 1, 0], material: 'team_trim' },
      ],
    };
    const atlased = await buildDelivered(config({ test_pbr: asset }), root, 'test.json');
    expect(atlased.reports.flatMap((r) => r.errors)).toEqual([]);
    expect(atlased.entries[0]!.maps).toEqual(['normal', 'metallicRoughness']);
    const lod0 = await createIO().readBinary(atlased.outputs.get('test_pbr/lod0.glb')!);
    const merged = lod0
      .getRoot()
      .listMaterials()
      .find((m) => m.getBaseColorTexture())!;
    expect(merged.getNormalTexture()).not.toBeNull();
    expect(merged.getMetallicRoughnessTexture()).not.toBeNull();
    // The maps lie pixel for pixel on the diffuse atlas, so one uv remap serves all three.
    expect(merged.getNormalTexture()!.getSize()).toEqual(merged.getBaseColorTexture()!.getSize());
    // glTF multiplies the map by metallicFactor; 0 (what a flat material gets) would kill the metal channel.
    expect(merged.getMetallicFactor()).toBe(1);

    // Only the Hull: one diffuse, so no atlas, and the maps sit straight on the material.
    const single = await buildDelivered(
      config({ test_pbr_one: { ...asset, include: ['Body'] } }),
      root,
      'test.json',
    );
    expect(single.reports.flatMap((r) => r.errors)).toEqual([]);
    expect(single.entries[0]!.maps).toEqual(['normal', 'metallicRoughness']);
    expect(single.details.get('test_pbr_one')!.maps).toEqual(['normal', 'metallicRoughness']);

    // Only the Eye: its normal map is 4x4 next to an 8x8 diffuse, so nothing is emitted instead of a misaligned map.
    const dropped = await buildDelivered(
      config({ test_pbr_eye: { ...asset, include: ['Eye'] } }),
      root,
      'test.json',
    );
    expect(dropped.reports.flatMap((r) => r.errors)).toEqual([]);
    expect(dropped.entries[0]!.maps).toBeUndefined();
  });

  it('goes through the local pipeline: delivered/ is no asset of its own and the config is optional', async () => {
    await writeRobot();
    writeFileSync(join(root, 'rigmap.json'), JSON.stringify({ rigs: {}, assets: {} }));
    writeFileSync(
      join(root, 'delivered.json'),
      JSON.stringify({
        version: 1,
        flatMaterials: { team_trim: { color: '#cccccc' } },
        assets: {
          test_robot: {
            file: 'delivered/robot.glb',
            kind: 'rigid-unit',
            fit: { axis: 'y', meters: 2 },
            lod0Triangles: 300,
            extraParts: [
              { type: 'box', size: [0.5, 0.1, 0.5], position: [0, 1, 0], material: 'team_trim' },
            ],
          },
        },
      }),
    );
    const dist = join(root, 'dist-local');
    const built = await buildAssets({
      srcDir: root,
      distDir: dist,
      onlyConfigured: true,
      toktx: null,
    });
    expect(built.reports.flatMap((r) => r.errors)).toEqual([]);
    expect(built.manifest!.assets.map((a) => a.id)).toEqual(['test_robot']);
    expect(built.notices.join(' ')).not.toMatch(/robot\.glb/);
  });
});
